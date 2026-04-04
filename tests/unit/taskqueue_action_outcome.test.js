import { TaskQueue } from '../../modules/TaskQueue.js';
import { GameError } from '../../modules/GameClient.js';

function createHarness({ city, fleetMovements = [], client: clientOverrides = {} } = {}) {
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

  const config = {
    get: vi.fn((key) => {
      const map = {
        operationMode: 'FULL-AUTO',
        guardConsumesAttempt: true,
        transportMinLoadFactor: 0.9,
      };
      return map[key];
    }),
    set: vi.fn(async () => {}),
  };

  const state = {
    isProbing: vi.fn(() => false),
    getActiveCityId: vi.fn(() => city?.id ?? 101),
    getCity: vi.fn(() => city),
    fleetMovements,
  };

  const client = {
    acquireSession: vi.fn(async (fn) => fn()),
    probeCityData: vi.fn(async () => {}),
    fetchMilitaryAdvisor: vi.fn(async () => {}),
    ...clientOverrides,
  };

  const storage = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
  };

  const queue = new TaskQueue({ events, audit, config, state, client, storage });
  queue._runGuards = vi.fn(async () => {});
  queue._dispatch = vi.fn(async () => ({ tokenRotated: true }));

  return { queue, events, state, client };
}

describe('TaskQueue action outcomes', () => {
  test('BUILD success only when post-state confirms construction evidence', async () => {
    const city = {
      id: 101,
      underConstruction: -1,
      buildings: [{ position: 3, level: 5, isUpgrading: false }],
      tavern: { wineLevel: 0 },
      workers: { scientists: 10 },
    };
    const { queue } = createHarness({
      city,
      client: {
        probeCityData: vi.fn(async () => {
          city.underConstruction = 3;
          city.buildings[0].isUpgrading = true;
        }),
      },
    });

    const task = {
      id: 'b1',
      type: 'BUILD',
      cityId: 101,
      status: 'pending',
      attempts: 0,
      maxAttempts: 2,
      scheduledFor: Date.now(),
      payload: { position: 3 },
    };
    queue._queue = [task];

    await queue._execute(task);

    expect(task.lastOutcome?.outcomeClass).toBe('success');
    expect(task.lastOutcome?.reasonCode).toBe('BUILD_STATE_CONFIRMED');
    expect(task.status).toBe('done');
  });

  test('TRANSPORT success only when post-state confirms movement in transit', async () => {
    const movements = [];
    const city = { id: 101, underConstruction: -1, buildings: [], tavern: { wineLevel: 0 }, workers: { scientists: 3 } };
    const { queue } = createHarness({
      city,
      fleetMovements: movements,
      client: {
        fetchMilitaryAdvisor: vi.fn(async () => {
          movements.push({
            isOwn: true,
            isReturn: false,
            originCityId: 101,
            targetCityId: 202,
          });
        }),
      },
    });

    const task = {
      id: 't1',
      type: 'TRANSPORT',
      cityId: 101,
      status: 'pending',
      attempts: 0,
      maxAttempts: 2,
      scheduledFor: Date.now(),
      payload: { fromCityId: 101, toCityId: 202, toIslandId: 99, cargo: { wood: 500 }, boats: 1 },
    };
    queue._queue = [task];

    await queue._execute(task);

    expect(task.lastOutcome?.outcomeClass).toBe('success');
    expect(task.lastOutcome?.reasonCode).toBe('TRANSPORT_MOVEMENT_CONFIRMED');
    expect(task.status).toBe('done');
  });

  test('WINE_ADJUST success only when real wine level changes', async () => {
    const city = {
      id: 101,
      underConstruction: -1,
      buildings: [],
      tavern: { wineLevel: 2 },
      workers: { scientists: 10 },
    };
    const { queue } = createHarness({
      city,
      client: {
        probeCityData: vi.fn(async () => {
          city.tavern.wineLevel = 3;
        }),
      },
    });

    const task = {
      id: 'w1',
      type: 'WINE_ADJUST',
      cityId: 101,
      status: 'pending',
      attempts: 0,
      maxAttempts: 2,
      scheduledFor: Date.now(),
      payload: { wineLevel: 3 },
    };
    queue._queue = [task];

    await queue._execute(task);

    expect(task.lastOutcome?.outcomeClass).toBe('success');
    expect(task.lastOutcome?.reasonCode).toBe('WINE_LEVEL_CHANGED_WITH_TOKEN_ROTATION');
    expect(task.status).toBe('done');
  });

  test('WORKER_REALLOC success only when real scientists allocation changes', async () => {
    const city = {
      id: 101,
      underConstruction: -1,
      buildings: [],
      tavern: { wineLevel: 0 },
      workers: { scientists: 12 },
    };
    const { queue } = createHarness({
      city,
      client: {
        probeCityData: vi.fn(async () => {
          city.workers.scientists = 16;
        }),
      },
    });

    const task = {
      id: 'r1',
      type: 'WORKER_REALLOC',
      cityId: 101,
      status: 'pending',
      attempts: 0,
      maxAttempts: 2,
      scheduledFor: Date.now(),
      payload: { position: 1, scientists: 16 },
    };
    queue._queue = [task];

    await queue._execute(task);

    expect(task.lastOutcome?.outcomeClass).toBe('success');
    expect(task.lastOutcome?.reasonCode).toBe('WORKER_ALLOCATION_CHANGED_WITH_TOKEN_ROTATION');
    expect(task.status).toBe('done');
  });

  test('post-validation inconclusive reschedules critical task', async () => {
    const city = {
      id: 101,
      underConstruction: -1,
      buildings: [],
      tavern: { wineLevel: 4 },
      workers: { scientists: 5 },
    };
    const { queue } = createHarness({ city });

    const task = {
      id: 'inc1',
      type: 'WINE_ADJUST',
      cityId: 101,
      status: 'pending',
      attempts: 0,
      maxAttempts: 2,
      scheduledFor: Date.now(),
      payload: { wineLevel: 4 },
    };
    queue._queue = [task];

    await queue._execute(task);

    expect(task.lastOutcome?.outcomeClass).toBe('inconclusive');
    expect(task.lastOutcome?.reasonCode).toBe('WINE_LEVEL_UNCHANGED');
    expect(task.status).toBe('pending');
    expect(task.attempts).toBe(1);
  });

  test('post-validation deterministic refusal fails WINE_ADJUST immediately (no retry loop)', async () => {
    const city = {
      id: 101,
      underConstruction: -1,
      buildings: [],
      tavern: { wineLevel: 1 },
      workers: { scientists: 5 },
    };
    const { queue, client } = createHarness({ city });
    queue._dispatch = vi.fn(async () => ({
      tokenRotated: false,
      deterministicRefusal: true,
      refusalReasonCode: 'SERVER_REFUSED_INSUFFICIENT_RESOURCES',
      refusalMessage: 'Recursos insuficientes',
    }));

    const task = {
      id: 'inc2',
      type: 'WINE_ADJUST',
      cityId: 101,
      status: 'pending',
      attempts: 0,
      maxAttempts: 5,
      scheduledFor: Date.now(),
      payload: { wineLevel: 2 },
    };
    queue._queue = [task];

    await queue._execute(task);

    expect(task.lastOutcome?.outcomeClass).toBe('failed');
    expect(task.lastOutcome?.reasonCode).toBe('SERVER_REFUSED_INSUFFICIENT_RESOURCES');
    expect(task.status).toBe('failed');
    expect(task.attempts).toBe(1);
    expect(client.probeCityData).not.toHaveBeenCalled();
  });

  test('guard_reschedule outcome is emitted and normalized', async () => {
    const city = { id: 101, underConstruction: -1, buildings: [], tavern: { wineLevel: 0 }, workers: { scientists: 0 } };
    const { queue } = createHarness({ city });
    queue._runGuards = vi.fn(async () => {
      throw new GameError('GUARD', 'blocked by guard', { code: 'GUARD_TEST_RESCHEDULE' });
    });

    const task = {
      id: 'g1',
      type: 'TRANSPORT',
      cityId: 101,
      status: 'pending',
      attempts: 0,
      maxAttempts: 2,
      scheduledFor: Date.now(),
      payload: { fromCityId: 101, toCityId: 202, toIslandId: 9, cargo: { wood: 500 }, boats: 1 },
    };

    await queue._execute(task);

    expect(task.lastOutcome?.outcomeClass).toBe('guard_reschedule');
    expect(task.lastOutcome?.reasonCode).toBe('GUARD_TEST_RESCHEDULE');
  });

  test('guard_cancel outcome is emitted and normalized', async () => {
    const city = { id: 101, underConstruction: -1, buildings: [], tavern: { wineLevel: 0 }, workers: { scientists: 0 } };
    const { queue } = createHarness({ city });
    queue._runGuards = vi.fn(async () => {
      throw new GameError('GUARD_CANCEL', 'cancelled by guard', { code: 'GUARD_TEST_CANCEL' });
    });

    const task = {
      id: 'g2',
      type: 'BUILD',
      cityId: 101,
      status: 'pending',
      attempts: 0,
      maxAttempts: 2,
      scheduledFor: Date.now(),
      payload: { position: 2 },
    };

    await queue._execute(task);

    expect(task.lastOutcome?.outcomeClass).toBe('guard_cancel');
    expect(task.lastOutcome?.reasonCode).toBe('GUARD_TEST_CANCEL');
    expect(task.attempts).toBe(0);
  });
});

