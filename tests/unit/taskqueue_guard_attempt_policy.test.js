import { TaskQueue } from '../../modules/TaskQueue.js';
import { GameError } from '../../modules/GameClient.js';

function createHarness({ guardConsumesAttempt = true } = {}) {
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

  const config = {
    get: vi.fn((key) => {
      const map = {
        operationMode: 'FULL-AUTO',
        guardConsumesAttempt,
      };
      return map[key];
    }),
    set: vi.fn(async () => {}),
  };

  const state = {
    isProbing: vi.fn(() => false),
  };

  const client = {
    acquireSession: vi.fn(async (fn) => fn()),
  };

  const storage = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
  };

  const queue = new TaskQueue({ events, audit, config, state, client, storage });
  queue._runGuards = vi.fn(async () => {
    throw new GameError('GUARD', 'precondição');
  });
  queue._dispatch = vi.fn(async () => {});
  queue._reschedule = vi.fn((task) => {
    task.status = 'pending';
  });

  return { queue, events };
}

describe('TaskQueue guard attempt policy', () => {
  test('guard consome attempt quando guardConsumesAttempt=true', async () => {
    const { queue } = createHarness({ guardConsumesAttempt: true });
    const task = {
      id: 't1',
      type: 'BUILD',
      cityId: 101,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      scheduledFor: Date.now(),
      payload: { position: 1 },
    };

    await queue._execute(task);
    expect(task.attempts).toBe(1);
    expect(task.guardAttempts ?? 0).toBe(0);
  });

  test('guard não consome attempt quando guardConsumesAttempt=false', async () => {
    const { queue } = createHarness({ guardConsumesAttempt: false });
    const task = {
      id: 't2',
      type: 'BUILD',
      cityId: 101,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      scheduledFor: Date.now(),
      payload: { position: 1 },
    };

    await queue._execute(task);
    expect(task.attempts).toBe(0);
    expect(task.guardAttempts).toBe(1);
  });

  test('guard inconclusivo propaga reasonCode híbrido para blocker', async () => {
    const { queue } = createHarness({ guardConsumesAttempt: false });
    queue._runGuards = vi.fn(async () => {
      throw new GameError('GUARD', 'inconclusivo', { code: 'HYBRID_INCONCLUSIVE_TRANSPORT' });
    });

    const task = {
      id: 't3',
      type: 'TRANSPORT',
      cityId: 101,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      scheduledFor: Date.now(),
      payload: { fromCityId: 101, toCityId: 202, toIslandId: 99, cargo: { wood: 500 }, boats: 1 },
    };

    await queue._execute(task);
    expect(task.lastBlockerCode).toBe('HYBRID_INCONCLUSIVE_TRANSPORT');
    expect(task.lastAttemptOutcome?.reasonCode).toBe('HYBRID_INCONCLUSIVE_TRANSPORT');
  });
});

