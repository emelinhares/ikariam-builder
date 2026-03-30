import { TaskQueue, TASK_PHASE } from '../../modules/TaskQueue.js';

function createQueueHarness(overrides = {}) {
  const events = {
    E: {
      QUEUE_TASK_ADDED: 'queue:taskAdded',
      QUEUE_TASK_STARTED: 'queue:taskStarted',
      QUEUE_TASK_DONE: 'queue:taskDone',
      QUEUE_TASK_FAILED: 'queue:taskFailed',
      QUEUE_TASK_CANCELLED: 'queue:taskCancelled',
      QUEUE_MODE_CHANGED: 'queue:modeChanged',
      HYBRID_PATH_DECIDED: 'hybrid:path_decided',
      HYBRID_ATTEMPT_OUTCOME: 'hybrid:attempt_outcome',
    },
    emit: vi.fn(),
  };

  const audit = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const configData = {
    operationMode: 'FULL-AUTO',
    noiseFrequencyMin: 8,
    noiseFrequencyMax: 15,
    transportMinLoadFactor: 0.9,
    guardConsumesAttempt: true,
    ...overrides.config,
  };
  const config = {
    get: vi.fn((key) => configData[key]),
    set: vi.fn(async () => {}),
  };

  const state = {
    isProbing: vi.fn(() => false),
    getAllCities: vi.fn(() => []),
    ...overrides.state,
  };

  const client = {
    acquireSession: vi.fn(async (fn) => fn()),
    ...overrides.client,
  };

  const storage = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
  };

  const queue = new TaskQueue({ events, audit, config, state, client, storage });
  return { queue, events, audit, config, state, client, storage };
}

describe('TaskQueue orchestration', () => {
  test('deduplica mesma task na mesma fase, mas permite fases distintas', () => {
    const { queue } = createQueueHarness();

    const t1 = queue.add({
      type: 'TRANSPORT',
      cityId: 101,
      payload: { wineEmergency: false },
      priority: 10,
      scheduledFor: Date.now(),
    });

    const tDup = queue.add({
      type: 'TRANSPORT',
      cityId: 101,
      payload: { wineEmergency: false },
      priority: 1,
      scheduledFor: Date.now(),
    });

    const t2 = queue.add({
      type: 'TRANSPORT',
      cityId: 101,
      payload: { wineEmergency: true },
      priority: 1,
      scheduledFor: Date.now(),
    });

    expect(tDup.id).toBe(t1.id);
    expect(t1.phase).toBe(TASK_PHASE.LOGISTICA);
    expect(t2.phase).toBe(TASK_PHASE.SUSTENTO);
    expect(queue.getPending()).toHaveLength(2);
  });

  test('tick seleciona task mais urgente por fase e prioridade', () => {
    const { queue } = createQueueHarness();
    const now = Date.now();

    const lowUrgency = {
      id: 'a',
      type: 'BUILD',
      cityId: 1,
      phase: TASK_PHASE.CONSTRUCAO,
      priority: 1,
      status: 'pending',
      attempts: 0,
      maxAttempts: 1,
      scheduledFor: now,
      payload: {},
    };
    const highPhaseLowPriority = {
      id: 'b',
      type: 'TRANSPORT',
      cityId: 1,
      phase: TASK_PHASE.SUSTENTO,
      priority: 99,
      status: 'pending',
      attempts: 0,
      maxAttempts: 1,
      scheduledFor: now,
      payload: {},
    };
    const highPhaseHighPriority = {
      id: 'c',
      type: 'WINE_ADJUST',
      cityId: 1,
      phase: TASK_PHASE.SUSTENTO,
      priority: 1,
      status: 'pending',
      attempts: 0,
      maxAttempts: 1,
      scheduledFor: now,
      payload: {},
    };

    queue._queue = [lowUrgency, highPhaseLowPriority, highPhaseHighPriority];

    const executeSpy = vi.spyOn(queue, '_execute').mockResolvedValue(undefined);
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0);

    queue._tick();

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith(highPhaseHighPriority);

    timeoutSpy.mockRestore();
  });

  test('preempção: _execute cede quando existe task pronta em fase mais urgente', async () => {
    const { queue, client } = createQueueHarness();
    const now = Date.now();

    const taskToYield = {
      id: 'build-1',
      type: 'BUILD',
      cityId: 101,
      phase: TASK_PHASE.CONSTRUCAO,
      priority: 1,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      scheduledFor: now,
      payload: {},
    };

    const moreUrgent = {
      id: 'wine-1',
      type: 'WINE_ADJUST',
      cityId: 202,
      phase: TASK_PHASE.SUSTENTO,
      priority: 99,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      scheduledFor: now,
      payload: {},
    };

    queue._queue = [taskToYield, moreUrgent];

    await queue._execute(taskToYield);

    expect(taskToYield.status).toBe('pending');
    expect(client.acquireSession).not.toHaveBeenCalled();
    expect(queue._executing).toBe(false);
  });

  test('Scope D: BUILD respeita precedência e agenda para +1s após completesAt ativo', () => {
    const completesAtS = Math.floor(Date.now() / 1000) + 180;
    const { queue } = createQueueHarness({
      state: {
        getCity: vi.fn(() => ({
          id: 101,
          underConstruction: 2,
          buildings: [
            { position: 0, building: 'warehouse', completed: null },
            { position: 1, building: 'townHall', completed: null },
            { position: 2, building: 'academy', completed: completesAtS },
          ],
        })),
      },
    });

    const task = queue.add({
      type: 'BUILD',
      cityId: 101,
      payload: { building: 'townHall', position: 3, cost: { wood: 1000 }, toLevel: 2 },
      priority: 10,
      scheduledFor: Date.now(),
      reason: 'test build',
    });

    expect(task.scheduledFor).toBe(completesAtS * 1000 + 1000);
    expect(task.reasonCode).toBe('BUILD_PRECEDENCE_ACTIVE_BUILD');
    expect(task.evidence.join(' | ')).toMatch(/activeBuildCompletesAt=/);
  });

  test('Scope D: repriorização urgente move BUILD pendente para waiting_resources com evidência', () => {
    const { queue } = createQueueHarness();

    const normalBuild = queue.add({
      type: 'BUILD',
      cityId: 101,
      payload: { building: 'townHall', position: 3, cost: { wood: 1000 }, toLevel: 2, roi: 2.1 },
      priority: 20,
      scheduledFor: Date.now(),
      reason: 'normal build',
    });

    expect(normalBuild.status).toBe('pending');

    queue.add({
      type: 'WINE_ADJUST',
      cityId: 202,
      payload: { wineLevel: 0, wineEmergency: true },
      priority: 0,
      scheduledFor: Date.now(),
      reason: 'wine emergency',
    });

    expect(normalBuild.status).toBe('waiting_resources');
    expect(normalBuild.reasonCode).toBe('REPRIORITIZED_BY_URGENT_TASK');
    expect(normalBuild.evidence.join(' | ')).toMatch(/statusTransition=PENDING->WAITING_RESOURCES/);
  });

  test('emite eventos híbridos de path decision e outcome em execução bem-sucedida', async () => {
    const { queue, events, client } = createQueueHarness({
      client: {
        acquireSession: vi.fn(async (fn) => fn()),
      },
      state: {
        isProbing: vi.fn(() => false),
      },
    });

    queue._runGuards = vi.fn(async () => {});
    queue._dispatch = vi.fn(async () => ({
      hybridOutcome: {
        attemptId: 'gc_1',
        actionType: 'TRANSPORT',
        pathUsed: 'endpoint',
        outcomeClass: 'success',
        nextStep: 'task_complete',
        responseSignals: ['fleetMoveList_or_feedback10'],
      },
    }));

    const task = {
      id: 'h1',
      type: 'TRANSPORT',
      cityId: 101,
      phase: TASK_PHASE.LOGISTICA,
      priority: 1,
      status: 'pending',
      attempts: 0,
      maxAttempts: 2,
      scheduledFor: Date.now(),
      payload: { fromCityId: 101, toCityId: 202, toIslandId: 99, cargo: { wood: 500 }, boats: 1 },
    };

    queue._queue = [task];
    await queue._execute(task);

    expect(client.acquireSession).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith(events.E.HYBRID_PATH_DECIDED, expect.objectContaining({
      taskId: 'h1',
      actionType: 'TRANSPORT',
    }));
    expect(events.emit).toHaveBeenCalledWith(events.E.HYBRID_ATTEMPT_OUTCOME, expect.objectContaining({
      taskId: 'h1',
      outcome: expect.objectContaining({
        outcomeClass: 'success',
        pathUsed: 'endpoint',
      }),
    }));
  });
});

