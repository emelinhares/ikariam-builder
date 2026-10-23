import { HealthCheckRunner } from '../../modules/HealthCheckRunner.js';

function createEventBus() {
  const listeners = new Map();
  return {
    E: {
      HEALTHCHECK_UPDATED: 'healthcheck:updated',
      QUEUE_TASK_STARTED: 'queue:taskStarted',
      QUEUE_TASK_DONE: 'queue:taskDone',
      QUEUE_TASK_FAILED: 'queue:taskFailed',
      QUEUE_TASK_OUTCOME: 'queue:taskOutcome',
    },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => listeners.get(event)?.delete(handler);
    },
    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const h of set) h(payload);
    },
  };
}

function createHarness({ scenarioFactories } = {}) {
  const events = createEventBus();
  const state = {
    getAllCities: vi.fn(() => [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }]),
    getActiveCityId: vi.fn(() => 1),
  };
  const queue = {
    add: vi.fn((task) => ({ ...task, id: 'task-1' })),
    getPending: vi.fn(() => []),
    getHistory: vi.fn(() => []),
    getTaskById: vi.fn(() => null),
    getActive: vi.fn(() => []),
    cancel: vi.fn(),
    allowManualHealthCheckTask: vi.fn(() => true),
    revokeManualHealthCheckTask: vi.fn(),
  };
  const audit = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const config = { get: vi.fn((key) => (key === 'healthCheckCooldownMs' ? 1000 : undefined)) };
  const storage = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
  };
  const client = {
    donateIslandResource: vi.fn(async () => ({})),
  };

  const runner = new HealthCheckRunner({
    events,
    state,
    queue,
    audit,
    config,
    storage,
    client,
    scenarioFactories,
  });

  return { runner, events, state, queue, audit, config, storage, client };
}

async function waitUntilDone(runner, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const st = runner.getState();
    if (st.status !== 'running') return st;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('timeout waiting healthcheck run to finish');
}

describe('HealthCheckRunner', () => {
  test('aguarda a coleta de cidades antes de iniciar', () => {
    const { runner, state, queue } = createHarness();
    state.isProbing = () => true;
    expect(runner.start({ suite: 'full' })).toEqual(expect.objectContaining({ ok: false, code: 'STATE_PROBING' }));
    expect(queue.add).not.toHaveBeenCalled();
  });
  test('executa suíte custom e gera relatório final', async () => {
    const { runner, storage } = createHarness({
      scenarioFactories: [
        () => ({
          id: 'ok',
          title: 'Scenario OK',
          group: 'core',
          critical: true,
          run: async () => ({ status: 'passed', evidence: ['ok=true'] }),
        }),
        () => ({
          id: 'fail',
          title: 'Scenario FAIL',
          group: 'core',
          critical: false,
          run: async () => ({ status: 'failed', error: 'boom', evidence: ['ok=false'] }),
        }),
      ],
    });

    await runner.init();
    const startRes = runner.start({ suite: 'full' });
    expect(startRes.ok).toBe(true);

    const finalState = await waitUntilDone(runner);
    expect(finalState.status).toBe('failed');
    expect(finalState.metrics.passed).toBe(1);
    expect(finalState.metrics.failed).toBe(1);
    expect(finalState.report).toBeTruthy();
    expect(storage.set).toHaveBeenCalled();
  });

  test('exporta relatório JSON e MD', async () => {
    const { runner } = createHarness({
      scenarioFactories: [
        () => ({
          id: 'ok',
          title: 'Scenario OK',
          group: 'core',
          critical: true,
          run: async () => ({ status: 'passed', evidence: ['ok=true'] }),
        }),
      ],
    });

    await runner.init();

    const prevCreate = globalThis.URL.createObjectURL;
    const prevRevoke = globalThis.URL.revokeObjectURL;
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:test');
    globalThis.URL.revokeObjectURL = vi.fn();

    try {
      runner.start({ suite: 'full' });
      await waitUntilDone(runner);

      const exp = runner.exportReport({ format: 'both' });
      expect(exp.ok).toBe(true);
      expect(exp.files).toHaveLength(2);
      expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
    } finally {
      globalThis.URL.createObjectURL = prevCreate;
      globalThis.URL.revokeObjectURL = prevRevoke;
    }
  });

  test('classifica guard reschedule como blocked (não timeout cego)', async () => {
    const { runner, events, queue } = createHarness();
    await runner.init();

    const taskState = {
      id: 'task-guard',
      status: 'in-flight',
      attempts: 0,
      maxAttempts: 1,
      scheduledFor: Date.now(),
    };

    queue.add.mockImplementation((task) => ({ ...task, id: taskState.id }));
    queue.getTaskById.mockImplementation(() => ({ ...taskState }));

    const p = runner._addTaskAndWait(
      { type: 'BUILD', cityId: 1, payload: {} },
      { timeoutMs: 1500, pollIntervalMs: 20, guardRescheduleGraceMs: 30 }
    );

    events.emit(events.E.QUEUE_TASK_STARTED, { task: { id: taskState.id } });

    await new Promise(r => setTimeout(r, 80));
    taskState.status = 'pending';
    taskState.scheduledFor = Date.now() + 5_000;

    const result = await p;
    expect(result.status).toBe('blocked');
    expect(result.error).toContain('Guard reagendou task');
    expect(result.evidence).toEqual(expect.arrayContaining([
      `taskAdded=${taskState.id}`,
      `taskStarted=${taskState.id}`,
      `taskRescheduled=${taskState.id}`,
    ]));
    expect(result.evidence.some(e => e.startsWith('nextScheduledFor='))).toBe(true);
    expect(result.evidence.some(e => e.startsWith('attempts='))).toBe(true);
  });

  test('cancela tasks deixadas por execução anterior antes de iniciar', async () => {
    const { runner, queue } = createHarness();
    await runner.init();

    const restos = [
      { id: 'resto-1', module: 'HEALTHCHECK' },
      { id: 'resto-2', module: 'HEALTHCHECK' },
      { id: 'do-hr',   module: 'HR' },        // de outro módulo: não é nosso para cancelar
    ];
    queue.getActive.mockReturnValue(restos);

    const cancelados = runner._cancelarTasksDeExecucaoAnterior();

    expect(cancelados).toBe(2);
    expect(queue.cancel).toHaveBeenCalledWith('resto-1');
    expect(queue.cancel).toHaveBeenCalledWith('resto-2');
    expect(queue.cancel).not.toHaveBeenCalledWith('do-hr');
  });

  test('em timeout real inclui snapshot da task nas evidências e status timeout', async () => {
    const { runner, events, queue } = createHarness();
    await runner.init();

    const taskState = {
      id: 'task-timeout',
      status: 'in-flight',
      attempts: 0,
      maxAttempts: 1,
      scheduledFor: Date.now() + 500,
    };

    queue.add.mockImplementation((task) => ({ ...task, id: taskState.id }));
    queue.getTaskById.mockImplementation(() => ({ ...taskState }));

    // Timers falsos: com timers reais e orçamento de 120ms a suíte inteira em
    // paralelo pode atrasar o evento além do timeout e inverter o reasonCode.
    vi.useFakeTimers();
    let result;
    try {
      const p = runner._addTaskAndWait(
        { type: 'TRANSPORT', cityId: 1, payload: {} },
        { timeoutMs: 120, pollIntervalMs: 20 }
      );

      events.emit(events.E.QUEUE_TASK_STARTED, { task: { id: taskState.id } });

      await vi.advanceTimersByTimeAsync(200);
      result = await p;
    } finally {
      vi.useRealTimers();
    }
    expect(result.status).toBe('timeout');
    expect(result.reasonCode).toBe('NO_CONFIRMATION');
    expect(result.error).toContain('sem confirmação');
    expect(result.evidence).toEqual(expect.arrayContaining(['dispatch=started-unconfirmed']));
    expect(result.evidence.some(e => e.startsWith('taskStatusAtTimeout='))).toBe(true);
    expect(result.evidence.some(e => e.startsWith('scheduledForAtTimeout='))).toBe(true);
    expect(result.evidence.some(e => e.startsWith('attempts='))).toBe(true);
    expect(result.evidence.some(e => e.startsWith('skippedTicks='))).toBe(true);
    expect(result.evidence.some(e => e.startsWith('watchdogResets='))).toBe(true);
    expect(result.evidence.some(e => e.startsWith('msUntilStarted='))).toBe(true);
  });

  test('task que nunca foi despachada é distinguida de task sem confirmação', async () => {
    const { runner, queue } = createHarness();
    await runner.init();

    // Mesma espera, mas QUEUE_TASK_STARTED nunca é emitido: a fila não elegeu
    // a task. É uma falha de natureza diferente de "executou e não confirmou".
    const taskState = {
      id: 'task-nunca-despachada',
      status: 'pending',
      attempts: 0,
      maxAttempts: 1,
      skippedTicks: 137,
      scheduledFor: Date.now() - 1_000,
    };

    queue.add.mockImplementation((task) => ({ ...task, id: taskState.id }));
    queue.getTaskById.mockImplementation(() => ({ ...taskState }));

    vi.useFakeTimers();
    let result;
    try {
      const p = runner._addTaskAndWait(
        { type: 'TRANSPORT', cityId: 1, payload: {} },
        { timeoutMs: 120, pollIntervalMs: 20 }
      );
      await vi.advanceTimersByTimeAsync(200);
      result = await p;
    } finally {
      vi.useRealTimers();
    }

    expect(result.status).toBe('timeout');
    expect(result.reasonCode).toBe('NEVER_DISPATCHED');
    expect(result.error).toContain('nunca foi despachada');
    expect(result.evidence).toEqual(expect.arrayContaining([
      'dispatch=never',
      'skippedTicks=137',
    ]));
    // sem despacho não há o que medir até o início
    expect(result.evidence.some(e => e.startsWith('msUntilStarted='))).toBe(false);
  });
});

