import { TaskQueue } from '../../modules/TaskQueue.js';

function createHarness({
  savedQueue = null,
  city = null,
  client: clientOverrides = {},
  state: stateOverrides = {},
} = {}) {
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
    getCity: vi.fn((id) => (city && Number(city.id) === Number(id) ? city : null)),
    ...stateOverrides,
  };

  const client = {
    acquireSession: vi.fn(async (fn) => fn()),
    probeCityData: vi.fn(async () => {}),
    upgradeBuilding: vi.fn(async () => ({ ok: true })),
    ...clientOverrides,
  };

  const storage = {
    get: vi.fn(async (key) => {
      if (key === 'taskQueue') return savedQueue;
      if (key === 'taskQueueDone') return null;
      return null;
    }),
    set: vi.fn(async () => {}),
  };

  const queue = new TaskQueue({ events, audit, config, state, client, storage });
  queue._tick = vi.fn();

  return { queue, events, audit, state, client, storage };
}

describe('TaskQueue zombie recovery + idempotency', () => {
  test('init recovers zombies with stagger + exponential backoff by attempts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const now = Date.now();

    const savedQueue = [
      {
        id: 'z1',
        type: 'TRANSPORT',
        cityId: 101,
        status: 'in-flight',
        attempts: 0,
        maxAttempts: 3,
        phase: 2,
        priority: 1,
        scheduledFor: now - 1000,
        payload: { fromCityId: 101, toCityId: 202, toIslandId: 7, cargo: { wood: 500 }, boats: 1 },
      },
      {
        id: 'z2',
        type: 'TRANSPORT',
        cityId: 101,
        status: 'in-flight',
        attempts: 2,
        maxAttempts: 3,
        phase: 2,
        priority: 1,
        scheduledFor: now - 2000,
        payload: { fromCityId: 101, toCityId: 203, toIslandId: 7, cargo: { marble: 500 }, boats: 1 },
      },
    ];

    const { queue } = createHarness({ savedQueue });
    await queue.init();

    const active = queue.getActive();
    expect(active).toHaveLength(2);

    const z1 = active.find((t) => t.id === 'z1');
    const z2 = active.find((t) => t.id === 'z2');
    expect(z1.status).toBe('pending');
    expect(z2.status).toBe('pending');

    // z1: 5s + (idx=0 * 15s)
    expect(z1.scheduledFor).toBe(now + 5_000);
    // z2: (5s * 2^2 = 20s) + (idx=1 * 15s) => 35s
    expect(z2.scheduledFor).toBe(now + 35_000);
    expect(z1.recoveredFromZombie).toBe(true);
    expect(z2.recoveredFromZombie).toBe(true);

    vi.useRealTimers();
  });

  test('recent BUILD redispatch probes and resolves as success without dispatch when already under construction', async () => {
    const city = {
      id: 101,
      name: 'Polis',
      underConstruction: -1,
      buildings: [{ position: 3, level: 5, isUpgrading: false }],
      tavern: { wineLevel: 0 },
      workers: { scientists: 0 },
      lockedPositions: new Set(),
    };

    const { queue, client } = createHarness({
      city,
      client: {
        probeCityData: vi.fn(async () => {
          city.underConstruction = 3;
          city.buildings[0].isUpgrading = true;
        }),
      },
    });

    queue._runGuards = vi.fn(async () => {});
    queue._dispatch = vi.fn(async () => ({ ok: true }));

    const task = {
      id: 'b-reprobe',
      type: 'BUILD',
      cityId: 101,
      status: 'pending',
      attempts: 1,
      maxAttempts: 3,
      scheduledFor: Date.now(),
      lastDispatchedAt: Date.now() - 60_000,
      payload: { position: 3 },
    };
    queue._queue = [task];

    await queue._execute(task);

    expect(client.probeCityData).toHaveBeenCalledTimes(1);
    expect(queue._dispatch).not.toHaveBeenCalled();
    expect(task.status).toBe('done');
    expect(task.lastOutcome?.reasonCode).toBe('BUILD_ALREADY_UNDER_CONSTRUCTION_IDEMPOTENT');
  });

  test('BUILD dispatch is idempotent when same slot is already under construction', async () => {
    const city = {
      id: 101,
      name: 'Polis',
      underConstruction: 7,
      buildings: [{ position: 7, level: 12, isUpgrading: true }],
      tavern: { wineLevel: 0 },
      workers: { scientists: 0 },
      lockedPositions: new Set(),
    };

    const { queue, client } = createHarness({ city });

    const result = await queue._dispatch({
      id: 'b-idem',
      type: 'BUILD',
      cityId: 101,
      payload: {
        position: 7,
        buildingView: 'townHall',
        currentLevel: 12,
      },
    });

    expect(result?.idempotent).toBe(true);
    expect(result?.reasonCode).toBe('BUILD_ALREADY_UNDER_CONSTRUCTION_IDEMPOTENT');
    expect(client.upgradeBuilding).not.toHaveBeenCalled();
  });
});

