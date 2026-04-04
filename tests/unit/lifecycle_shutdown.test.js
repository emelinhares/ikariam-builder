import { Lifecycle } from '../../modules/Lifecycle.js';
import { DataCollector } from '../../modules/DataCollector.js';
import { StateManager } from '../../modules/StateManager.js';
import { HR } from '../../modules/HR.js';
import { COO } from '../../modules/COO.js';
import { CFO } from '../../modules/CFO.js';
import { Planner } from '../../modules/Planner.js';
import { TaskQueue } from '../../modules/TaskQueue.js';

function createAudit() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createEventsStub(extraE = {}) {
  return {
    E: {
      DC_HEADER_DATA: 'dc:header',
      DC_MODEL_REFRESH: 'dc:model',
      DC_SCREEN_DATA: 'dc:screen',
      DC_FLEET_MOVEMENTS: 'dc:fleet',
      DC_TOWNHALL_DATA: 'dc:townhall',
      QUEUE_TASK_STARTED: 'queue:started',
      QUEUE_TASK_DONE: 'queue:done',
      QUEUE_TASK_FAILED: 'queue:failed',
      STATE_ALL_FRESH: 'state:fresh',
      HR_WINE_EMERGENCY: 'hr:wineEmergency',
      HR_WINE_ADJUSTED: 'hr:wineAdjusted',
      QUEUE_TASK_ADDED: 'queue:added',
      ...extraE,
    },
    on: vi.fn(() => vi.fn()),
    emit: vi.fn(),
  };
}

describe('Lifecycle + shutdown coverage', () => {
  test('Lifecycle executes shutdown in reverse registration order', () => {
    const order = [];
    const lifecycle = new Lifecycle({ audit: createAudit() });

    lifecycle.register('A', { shutdown: () => order.push('A') });
    lifecycle.register('B', { shutdown: () => order.push('B') });
    lifecycle.register('C', { shutdown: () => order.push('C') });

    lifecycle.shutdown('beforeunload');
    expect(order).toEqual(['C', 'B', 'A']);
  });

  test('target modules unsubscribe listeners on shutdown', () => {
    const events = createEventsStub();
    const audit = createAudit();
    const config = { get: vi.fn(() => 0), set: vi.fn(async () => {}) };
    const state = {
      isProbing: vi.fn(() => false),
      getActiveCityId: vi.fn(() => 1),
      getConfidence: vi.fn(() => 'HIGH'),
      getCity: vi.fn(() => ({ id: 1, name: 'A', resources: { wine: 0 }, economy: {}, tavern: {}, workers: {}, buildings: [] })),
      getAllCities: vi.fn(() => []),
      getInTransit: vi.fn(() => ({})),
      fleetMovements: [],
    };
    const queue = {
      hasPendingType: vi.fn(() => false),
      getPending: vi.fn(() => []),
      add: vi.fn(),
    };
    const client = {};
    const storage = { get: vi.fn(async () => null), set: vi.fn(async () => {}) };

    const modules = [
      new StateManager({ events, audit, config }),
      new HR({ events, audit, config, state, queue }),
      new COO({ events, audit, config, state, queue, client, storage }),
      new CFO({ events, audit, config, state, queue }),
      new Planner({
        events,
        audit,
        config,
        state,
        queue: { getPending: vi.fn(() => []), getHistory: vi.fn(() => []) },
        hr: { replan: vi.fn() },
        cfo: { replan: vi.fn() },
        coo: { replan: vi.fn() },
        cto: { replan: vi.fn() },
        cso: { replan: vi.fn() },
        mna: { replan: vi.fn(async () => {}) },
      }),
    ];

    modules.forEach((m) => m.init());

    const unsubs = events.on.mock.results
      .map((r) => r.value)
      .filter((fn) => typeof fn === 'function');
    expect(unsubs.length).toBeGreaterThan(0);

    modules.forEach((m) => m.shutdown());
    unsubs.forEach((fn) => expect(fn).toHaveBeenCalledTimes(1));
  });

  test('DataCollector and TaskQueue clear timers/loop on shutdown', async () => {
    vi.useFakeTimers();

    const dc = new DataCollector({ events: createEventsStub(), audit: createAudit() });
    dc._persistLog = vi.fn();
    dc._schedulePersist();
    dc.shutdown();
    await vi.advanceTimersByTimeAsync(1000);
    expect(dc._persistLog).not.toHaveBeenCalled();

    const queue = new TaskQueue({
      events: createEventsStub(),
      audit: createAudit(),
      config: { get: vi.fn((k) => (k === 'operationMode' ? 'FULL-AUTO' : 1000)), set: vi.fn(async () => {}) },
      state: { isProbing: vi.fn(() => false), getCity: vi.fn(() => null), getActiveCityId: vi.fn(() => 1), fleetMovements: [] },
      client: {},
      storage: { get: vi.fn(async () => null), set: vi.fn(async () => {}) },
    });

    queue._tickTimer = setTimeout(() => {}, 5000);
    queue.shutdown();
    expect(queue._stopped).toBe(true);
    expect(queue._tickTimer).toBeNull();

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    queue._tick();
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

