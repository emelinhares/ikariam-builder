import { TaskQueue } from '../../modules/TaskQueue.js';

function createHarness() {
  const events = {
    E: {
      QUEUE_TASK_ADDED: 'queue:taskAdded',
      QUEUE_TASK_STARTED: 'queue:taskStarted',
      QUEUE_TASK_DONE: 'queue:taskDone',
      QUEUE_TASK_FAILED: 'queue:taskFailed',
      QUEUE_TASK_OUTCOME: 'queue:taskOutcome',
      QUEUE_TASK_CANCELLED: 'queue:taskCancelled',
      QUEUE_MODE_CHANGED: 'queue:modeChanged',
      HYBRID_PATH_DECIDED: 'hybrid:path_decided',
      HYBRID_ATTEMPT_OUTCOME: 'hybrid:attempt_outcome',
    },
    emit: vi.fn(),
  };

  const audit = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const config = {
    get: vi.fn((key) => ({
      operationMode: 'FULL-AUTO',
      taskQueueTickFocusMs: 1_000,
      taskQueueTickBackgroundMs: 5_000,
    }[key])),
    set: vi.fn(async () => {}),
  };

  const state = {
    isProbing: vi.fn(() => false),
    getActiveCityId: vi.fn(() => 101),
    getCity: vi.fn(() => null),
  };

  const client = { acquireSession: vi.fn(async (fn) => fn()) };
  const storage = { get: vi.fn(async () => null), set: vi.fn(async () => {}) };

  const queue = new TaskQueue({ events, audit, config, state, client, storage });
  queue._persist = vi.fn();
  queue._execute = vi.fn(async () => {});

  return { queue, events, audit, config };
}

function makeTask(over = {}) {
  return {
    id: 't1',
    type: 'TRANSPORT',
    cityId: 101,
    status: 'pending',
    phase: 2,
    priority: 0,
    attempts: 0,
    maxAttempts: 3,
    createdAt: Date.now(),
    scheduledFor: Date.now() - 1_000,
    payload: {},
    ...over,
  };
}

// roda um tick sem deixar o setTimeout recursivo vazar para o próximo teste
function tickOnce(queue) {
  queue._tick();
  clearTimeout(queue._tickTimer);
}

describe('TaskQueue — health check em MANUAL', () => {
  test('despacha apenas a task autorizada da suíte', () => {
    const { queue, config } = createHarness();
    config.get.mockImplementation((key) => ({
      operationMode: 'MANUAL',
      taskQueueTickFocusMs: 1_000,
    }[key]));
    const ordinary = makeTask({ id: 'ordinary', phase: 1 });
    const staleHealthCheck = makeTask({ id: 'stale', module: 'HEALTHCHECK', phase: 1 });
    const authorized = makeTask({ id: 'authorized', module: 'HEALTHCHECK', phase: 2 });
    queue._queue = [ordinary, staleHealthCheck, authorized];

    expect(queue.allowManualHealthCheckTask('ordinary')).toBe(false);
    expect(queue.allowManualHealthCheckTask('authorized')).toBe(true);
    tickOnce(queue);

    expect(queue._execute).toHaveBeenCalledWith(authorized);
    expect(ordinary.status).toBe('pending');
    expect(staleHealthCheck.status).toBe('pending');
  });

  test('task comum pendente não preempta health check autorizado', async () => {
    const { queue, config, events, audit } = createHarness();
    config.get.mockImplementation((key) => ({ operationMode: 'MANUAL' }[key]));
    const ordinary = makeTask({ id: 'ordinary', type: 'WINE_ADJUST', phase: 1 });
    const healthCheck = makeTask({ id: 'health', type: 'BUILD', module: 'HEALTHCHECK', phase: 3, status: 'in-flight' });
    queue._queue = [ordinary, healthCheck];
    queue.allowManualHealthCheckTask('health');
    queue._executing = true;
    queue._execute = TaskQueue.prototype._execute.bind(queue);
    queue._hasTaskTimedOut = () => false;
    queue._captureHybridPathDecision = () => ({ pathDecision: 'endpoint' });
    queue._captureValidationBaseline = () => null;
    queue._probeBeforeRedispatch = async () => { throw new Error('probe interrompido no teste'); };

    await queue._execute(healthCheck);

    expect(events.emit).toHaveBeenCalledWith(events.E.QUEUE_TASK_STARTED, { task: healthCheck });
    expect(audit.debug.mock.calls.some(([, message]) => message?.includes('Preempção:'))).toBe(false);
  });
});

describe('TaskQueue — watchdog com teto', () => {
  test('reagenda nas primeiras vezes e falha a task ao esgotar o teto', () => {
    const { queue, audit, events } = createHarness();
    const task = makeTask({ status: 'in-flight' });
    queue._queue = [task];

    const travado = () => {
      queue._executing = true;
      queue._executingStartedAt = Date.now() - (TaskQueue.WATCHDOG_TIMEOUT_MS + 1_000);
      task.status = 'in-flight'; // o redespacho real devolve a task para execução
    };

    // resets 1 e 2: reagenda, task continua viva
    for (let i = 1; i < TaskQueue.MAX_WATCHDOG_RESETS; i++) {
      travado();
      tickOnce(queue);
      expect(task.watchdogResets).toBe(i);
      expect(task.status).toBe('pending');
      expect(task.lastBlockerCode).toBe('WATCHDOG_RESET');
      expect(queue._queue).toContain(task);
    }

    // reset final: desiste
    travado();
    tickOnce(queue);

    expect(task.watchdogResets).toBe(TaskQueue.MAX_WATCHDOG_RESETS);
    expect(task.status).toBe('failed');
    expect(task.terminalReasonCode).toBe('WATCHDOG_EXHAUSTED');
    expect(queue._queue).not.toContain(task);
    expect(events.emit).toHaveBeenCalledWith(
      events.E.QUEUE_TASK_FAILED,
      expect.objectContaining({ fatal: true }),
    );
    expect(audit.error).toHaveBeenCalledWith(
      'TaskQueue',
      expect.stringContaining('desistindo'),
    );
  });
});

describe('TaskQueue — starvation', () => {
  test('conta e registra a task pronta que é preterida tick após tick', () => {
    const { queue, audit } = createHarness();
    const sustento = makeTask({ id: 'sustento', type: 'WINE_ADJUST', phase: 1 });
    const logistica = makeTask({ id: 'logistica', type: 'TRANSPORT', phase: 2 });
    queue._queue = [sustento, logistica];

    // A de fase 1 vence sempre e volta para pending — exatamente o padrão que
    // deixa a de fase 2 esperando para sempre.
    for (let i = 0; i < TaskQueue.STARVATION_TICKS; i++) {
      queue._executing = false;
      sustento.status = 'pending';
      sustento.scheduledFor = Date.now() - 1_000;
      tickOnce(queue);
    }

    expect(logistica.skippedTicks).toBe(TaskQueue.STARVATION_TICKS);
    expect(sustento.skippedTicks).toBe(0);
    expect(audit.warn).toHaveBeenCalledWith(
      'TaskQueue',
      expect.stringContaining('Starvation'),
      expect.objectContaining({ skippedTicks: TaskQueue.STARVATION_TICKS }),
    );
  });

  test('não acusa starvation quando a fila não tem concorrência', () => {
    const { queue, audit } = createHarness();
    const unica = makeTask({ id: 'unica' });
    queue._queue = [unica];

    for (let i = 0; i < TaskQueue.STARVATION_TICKS; i++) {
      queue._executing = false;
      unica.status = 'pending';
      unica.scheduledFor = Date.now() - 1_000;
      tickOnce(queue);
    }

    expect(unica.skippedTicks).toBe(0);
    expect(audit.warn).not.toHaveBeenCalledWith(
      'TaskQueue',
      expect.stringContaining('Starvation'),
      expect.anything(),
    );
  });
});
