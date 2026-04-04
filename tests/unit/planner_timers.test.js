import { Planner } from '../../modules/Planner.js';

function createPlannerHarness(overrides = {}) {
  const listeners = new Map();
  const events = {
    E: {
      STATE_ALL_FRESH: 'state:allFresh',
      QUEUE_TASK_DONE: 'queue:taskDone',
      QUEUE_TASK_FAILED: 'queue:taskFailed',
      HR_WINE_EMERGENCY: 'hr:wineEmergency',
      HR_WINE_ADJUSTED: 'hr:wineAdjusted',
      PLANNER_CYCLE_START: 'planner:cycleStart',
      PLANNER_CYCLE_DONE: 'planner:cycleDone',
    },
    on: vi.fn((evt, cb) => listeners.set(evt, cb)),
    emit: vi.fn(),
    _listeners: listeners,
  };

  const audit = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const configMap = {
    wineEmergencyHours: 4,
    ...overrides.config,
  };
  const config = {
    get: vi.fn((k) => configMap[k]),
  };

  const city = {
    id: 101,
    name: 'A',
    production: { wineSpendings: 10 },
    tavern: { wineLevel: 1 },
    underConstruction: -1,
    buildings: [],
  };

  const state = {
    getCity: vi.fn(() => city),
    getAllCities: vi.fn(() => []),
    fleetMovements: [],
    ...overrides.state,
  };

  const noop = { replan: vi.fn(async () => {}) };

  const planner = new Planner({
    events,
    audit,
    config,
    state,
    queue: { getPending: vi.fn(() => []), getHistory: vi.fn(() => []) },
    hr: noop,
    cfo: noop,
    coo: noop,
    cto: noop,
    cso: noop,
    mna: noop,
    ...overrides.deps,
  });

  return { planner, audit, state, events };
}

describe('Planner timers race handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('adaptive timer collision re-schedules for WAKE_MIN_INTERVAL instead of dropping', async () => {
    const { planner } = createPlannerHarness();
    planner.runCycle = vi.fn(async () => {});

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    planner._running = true;
    planner._scheduleAdaptiveWakeup({
      cities: new Map([[101, { wineHours: 6 }]]),
    });

    await vi.runOnlyPendingTimersAsync();

    expect(planner.runCycle).not.toHaveBeenCalled();
    expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 120_000)).toBe(true);

    planner._running = false;
    await vi.advanceTimersByTimeAsync(120_000);

    expect(planner.runCycle).toHaveBeenCalledTimes(1);
  });

  test('reactive timer collision re-schedules for WAKE_MIN_INTERVAL instead of dropping', async () => {
    const { planner } = createPlannerHarness();
    planner.runCycle = vi.fn(async () => {});

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    planner._running = true;
    planner._scheduleReactiveCycle('BUILD', 'DONE');

    await vi.advanceTimersByTimeAsync(10_000);

    expect(planner.runCycle).not.toHaveBeenCalled();
    expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 120_000)).toBe(true);

    planner._running = false;
    await vi.advanceTimersByTimeAsync(120_000);

    expect(planner.runCycle).toHaveBeenCalledTimes(1);
  });

  test('shutdown clears adaptive and reactive timers', async () => {
    const { planner } = createPlannerHarness();
    planner.runCycle = vi.fn(async () => {});

    planner._scheduleAdaptiveWakeup({
      cities: new Map([[101, { wineHours: 6 }]]),
    });
    planner._scheduleReactiveCycle('WINE_ADJUST', 'DONE');

    expect(planner._adaptiveTimer).toBeTruthy();
    expect(planner._reactiveTimer).toBeTruthy();

    planner.shutdown();

    expect(planner._adaptiveTimer).toBeNull();
    expect(planner._reactiveTimer).toBeNull();

    await vi.runAllTimersAsync();
    expect(planner.runCycle).not.toHaveBeenCalled();
  });
});

