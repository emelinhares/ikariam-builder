import { TaskQueue, TASK_PHASE } from '../../modules/TaskQueue.js';

function createQueueHarness(overrides = {}) {
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
    getCity: vi.fn(() => null),
    fleetMovements: [],
    ...overrides.state,
  };

  const client = {
    acquireSession: vi.fn(async (fn) => fn()),
    probeCityData: vi.fn(async () => {}),
    fetchMilitaryAdvisor: vi.fn(async () => {}),
    ...overrides.client,
  };

  const storage = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
  };

  const queue = new TaskQueue({
    events,
    audit,
    config,
    state,
    client,
    storage,
    transportIntentRegistry: overrides.transportIntentRegistry ?? null,
  });
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

  test('TRANSPORT dedup considera from/to/cargo/purpose e evita apenas equivalentes logísticos', () => {
    const { queue } = createQueueHarness();

    const base = {
      type: 'TRANSPORT',
      cityId: 101,
      priority: 10,
      scheduledFor: Date.now(),
      payload: {
        fromCityId: 101,
        toCityId: 202,
        toIslandId: 77,
        cargo: { wood: 500 },
        boats: 1,
        jitBuild: true,
        logisticPurpose: 'jitBuild',
      },
    };

    const t1 = queue.add(base);
    const tDup = queue.add({ ...base, priority: 1 });
    const tDifferentPurpose = queue.add({
      ...base,
      payload: {
        ...base.payload,
        jitBuild: false,
        minStock: true,
        logisticPurpose: 'minStock',
      },
    });
    const tDifferentRoute = queue.add({
      ...base,
      payload: {
        ...base.payload,
        fromCityId: 303,
        cargo: { wood: 500 },
      },
      cityId: 303,
    });

    expect(tDup.id).toBe(t1.id);
    expect(tDifferentPurpose.id).not.toBe(t1.id);
    expect(tDifferentRoute.id).not.toBe(t1.id);
    expect(queue.getPending()).toHaveLength(3);
  });

  test('TRANSPORT usa registry para intentId estável', () => {
    const registry = {
      setState: vi.fn(),
      setQueue: vi.fn(),
      reconcileEquivalent: vi.fn(() => ({ shouldSkipEnqueue: false })),
      ensureFromTaskData: vi.fn((taskData) => {
        taskData.payload.intentId = 'tp:jitBuild|f:101|t:202|r:wood|b:500';
      }),
    };
    const { queue } = createQueueHarness({ transportIntentRegistry: registry });

    const task = queue.add({
      type: 'TRANSPORT',
      cityId: 101,
      priority: 10,
      scheduledFor: Date.now(),
      payload: {
        fromCityId: 101,
        toCityId: 202,
        toIslandId: 77,
        cargo: { wood: 500 },
        boats: 1,
        jitBuild: true,
      },
    });

    expect(task.payload.intentId).toBe('tp:jitBuild|f:101|t:202|r:wood|b:500');
    expect(registry.ensureFromTaskData).toHaveBeenCalledTimes(1);
  });

  test('TRANSPORT é reconciliado e não entra na fila quando já iniciado', () => {
    const registry = {
      setState: vi.fn(),
      setQueue: vi.fn(),
      reconcileEquivalent: vi.fn(() => ({
        intentId: 'tp:jitBuild|f:101|t:202|r:wood|b:500',
        status: 'CONFIRMED_LOADING',
        evidence: ['fleetMovement=loading'],
        shouldSkipEnqueue: true,
      })),
      ensureFromTaskData: vi.fn(),
    };
    const { queue } = createQueueHarness({ transportIntentRegistry: registry });

    const task = queue.add({
      type: 'TRANSPORT',
      cityId: 101,
      priority: 10,
      scheduledFor: Date.now(),
      payload: {
        fromCityId: 101,
        toCityId: 202,
        toIslandId: 77,
        cargo: { wood: 500 },
        boats: 1,
        jitBuild: true,
      },
    });

    expect(task.status).toBe('reconciled');
    expect(queue.getPending()).toHaveLength(0);
    expect(registry.ensureFromTaskData).not.toHaveBeenCalled();
  });

  test('getTransportReservations expõe locks por destino/recurso/finalidade em tasks ativas', () => {
    const { queue } = createQueueHarness();
    const now = Date.now();

    queue._queue = [
      {
        id: 'r1',
        type: 'TRANSPORT',
        cityId: 101,
        phase: TASK_PHASE.LOGISTICA,
        status: 'pending',
        attempts: 0,
        maxAttempts: 2,
        priority: 1,
        scheduledFor: now,
        payload: {
          fromCityId: 101,
          toCityId: 202,
          cargo: { wood: 500 },
          jitBuild: true,
          logisticPurpose: 'jitBuild',
        },
      },
      {
        id: 'r2',
        type: 'TRANSPORT',
        cityId: 303,
        phase: TASK_PHASE.LOGISTICA,
        status: 'blocked',
        attempts: 1,
        maxAttempts: 2,
        priority: 1,
        scheduledFor: now,
        payload: {
          fromCityId: 303,
          toCityId: 202,
          cargo: { wood: 250, marble: 100 },
          minStock: true,
          logisticPurpose: 'minStock',
        },
      },
      {
        id: 'ignore-done',
        type: 'TRANSPORT',
        cityId: 303,
        phase: TASK_PHASE.LOGISTICA,
        status: 'done',
        attempts: 1,
        maxAttempts: 2,
        priority: 1,
        scheduledFor: now,
        payload: {
          fromCityId: 303,
          toCityId: 202,
          cargo: { wood: 999 },
          minStock: true,
          logisticPurpose: 'minStock',
        },
      },
    ];

    const reservations = queue.getTransportReservations();

    expect(reservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: 'r1', toCityId: 202, resource: 'wood', purpose: 'jitBuild', amount: 500, status: 'pending' }),
      expect.objectContaining({ taskId: 'r2', toCityId: 202, resource: 'wood', purpose: 'minStock', amount: 250, status: 'blocked' }),
      expect.objectContaining({ taskId: 'r2', toCityId: 202, resource: 'marble', purpose: 'minStock', amount: 100, status: 'blocked' }),
    ]));
    expect(reservations.some((r) => r.taskId === 'ignore-done')).toBe(false);
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
    const movements = [];
    const { queue, events, client } = createQueueHarness({
      client: {
        acquireSession: vi.fn(async (fn) => fn()),
        fetchMilitaryAdvisor: vi.fn(async () => {
          movements.push({
            isOwn: true,
            isReturn: false,
            originCityId: 101,
            targetCityId: 202,
          });
        }),
      },
      state: {
        isProbing: vi.fn(() => false),
        fleetMovements: movements,
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

  test('durante probing, task urgente de sustento pode executar sem reschedule', async () => {
    const { queue, state, client } = createQueueHarness({
      state: { isProbing: vi.fn(() => true) },
      client: { acquireSession: vi.fn(async (fn) => fn()) },
    });

    queue._runGuards = vi.fn(async () => {});
    queue._dispatch = vi.fn(async () => ({}));
    queue._postValidateTaskOutcome = vi.fn(async (task, { executionStartedAt }) => queue._createTaskOutcome(task, {
      executionStartedAt,
      outcomeClass: 'success',
      reasonCode: 'TEST_SUCCESS',
      evidence: ['forced=success'],
      nextStep: 'none',
    }));
    const rescheduleSpy = vi.spyOn(queue, '_reschedule');

    const task = {
      id: 'wine-urgent',
      type: 'WINE_ADJUST',
      cityId: 101,
      phase: TASK_PHASE.SUSTENTO,
      priority: 0,
      status: 'pending',
      attempts: 0,
      maxAttempts: 2,
      createdAt: Date.now(),
      scheduledFor: Date.now(),
      payload: { wineLevel: 0, wineEmergency: true },
    };

    await queue._execute(task);

    expect(state.isProbing).toHaveBeenCalled();
    expect(client.acquireSession).toHaveBeenCalledTimes(1);
    expect(rescheduleSpy).not.toHaveBeenCalled();
  });

  test('falha task quando SLA por tipo é excedido', async () => {
    const { queue, events } = createQueueHarness();
    queue._runGuards = vi.fn(async () => {});
    queue._dispatch = vi.fn(async () => ({}));

    const task = {
      id: 'build-timeout',
      type: 'BUILD',
      cityId: 101,
      phase: TASK_PHASE.CONSTRUCAO,
      priority: 10,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      createdAt: Date.now() - (9 * 60 * 60 * 1000), // > timeout BUILD default (8h)
      scheduledFor: Date.now(),
      payload: { position: 1 },
    };

    await queue._execute(task);

    expect(task.status).toBe('failed');
    expect(task.terminalReasonCode).toBe('TASK_SLA_TIMEOUT');
    expect(queue._dispatch).not.toHaveBeenCalled();
    const failedEvt = events.emit.mock.calls.find(([evt]) => evt === events.E.QUEUE_TASK_FAILED);
    expect(failedEvt).toBeTruthy();
  });
});

