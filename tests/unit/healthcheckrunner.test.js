import { HealthCheckRunner } from '../../modules/HealthCheckRunner.js';

function createEventBus() {
  const listeners = new Map();
  return {
    E: {
      HEALTHCHECK_UPDATED: 'healthcheck:updated',
      QUEUE_TASK_STARTED: 'queue:taskStarted',
      QUEUE_TASK_DONE: 'queue:taskDone',
      QUEUE_TASK_FAILED: 'queue:taskFailed',
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

  test('falha rápido quando task de healthcheck é reagendada por guard após iniciar', async () => {
    const { runner, events, queue } = createHarness();
    await runner.init();

    const taskState = {
      id: 'task-guard',
      status: 'in-flight',
      attempts: 0,
      maxAttempts: 1,
      scheduledFor: Date.now(),
    };

    queue.add.mockReturnValue({ id: taskState.id });
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
    expect(result.status).toBe('failed');
    expect(result.error).toContain('Guard reagendou task');
    expect(result.evidence).toEqual(expect.arrayContaining([
      `taskAdded=${taskState.id}`,
      `taskStarted=${taskState.id}`,
      `taskRescheduled=${taskState.id}`,
    ]));
    expect(result.evidence.some(e => e.startsWith('nextScheduledFor='))).toBe(true);
    expect(result.evidence.some(e => e.startsWith('attempts='))).toBe(true);
  });

  test('em timeout real inclui snapshot da task nas evidências', async () => {
    const { runner, events, queue } = createHarness();
    await runner.init();

    const taskState = {
      id: 'task-timeout',
      status: 'in-flight',
      attempts: 0,
      maxAttempts: 1,
      scheduledFor: Date.now() + 500,
    };

    queue.add.mockReturnValue({ id: taskState.id });
    queue.getTaskById.mockImplementation(() => ({ ...taskState }));

    const p = runner._addTaskAndWait(
      { type: 'TRANSPORT', cityId: 1, payload: {} },
      { timeoutMs: 120, pollIntervalMs: 20 }
    );

    events.emit(events.E.QUEUE_TASK_STARTED, { task: { id: taskState.id } });

    const result = await p;
    expect(result.status).toBe('failed');
    expect(result.error).toContain(`Timeout aguardando conclusão da task ${taskState.id}`);
    expect(result.evidence.some(e => e.startsWith('taskStatusAtTimeout='))).toBe(true);
    expect(result.evidence.some(e => e.startsWith('scheduledForAtTimeout='))).toBe(true);
    expect(result.evidence.some(e => e.startsWith('attempts='))).toBe(true);
  });
});

