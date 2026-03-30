import { UIBridge } from '../../modules/UIBridge.js';

function createEvents() {
  const handlers = new Map();
  return {
    E: {
      STATE_CITY_UPDATED: 'state:cityUpdated',
      STATE_ALL_FRESH: 'state:allCitiesFresh',
      QUEUE_TASK_ADDED: 'queue:taskAdded',
      QUEUE_TASK_DONE: 'queue:taskDone',
      QUEUE_TASK_FAILED: 'queue:taskFailed',
      QUEUE_MODE_CHANGED: 'queue:modeChanged',
      AUDIT_ENTRY_ADDED: 'audit:entry:added',
      AUDIT_ERROR_ADDED: 'audit:error:added',
      HEALTHCHECK_UPDATED: 'healthcheck:updated',
      HR_WINE_EMERGENCY: 'hr:wineEmergency',
      CSO_CAPITAL_RISK: 'cso:capitalAtRisk',
      QUEUE_BLOCKED: 'queue:blocked',
      QUEUE_TASK_STARTED: 'queue:taskStarted',
      UI_ALERT_RESOLVED: 'ui:alert:resolved',
      UI_COMMAND: 'ui:command',
      UI_STATE_UPDATED: 'ui:state:updated',
      UI_ALERT_ADDED: 'ui:alert:added',
      HYBRID_PATH_DECIDED: 'hybrid:path_decided',
      HYBRID_ATTEMPT_OUTCOME: 'hybrid:attempt_outcome',
    },
    on: vi.fn((ev, cb) => {
      const arr = handlers.get(ev) ?? [];
      arr.push(cb);
      handlers.set(ev, arr);
      return () => {};
    }),
    emit: vi.fn((ev, payload) => {
      const arr = handlers.get(ev) ?? [];
      for (const cb of arr) cb(payload);
    }),
  };
}

describe('UIBridge hybrid projection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('projeta path/outcome/blocker no nextAction e na fila', () => {
    const events = createEvents();
    const pending = {
      id: 't1',
      type: 'TRANSPORT',
      cityId: 101,
      status: 'pending',
      priority: 1,
      scheduledFor: Date.now() + 1000,
      confidence: 'HIGH',
      reason: 'test',
      module: 'COO',
    };

    const state = {
      getAllCities: vi.fn(() => [{
        id: 101,
        name: 'Alpha',
        tradegood: 1,
        islandId: 7,
        fetchedAt: Date.now(),
        isCapital: true,
        resources: { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 },
        maxResources: 1000,
        economy: { goldPerHour: 0, corruption: 0 },
        freeTransporters: 0,
      }]),
      getCity: vi.fn((id) => id === 101 ? { name: 'Alpha' } : null),
      getActiveCityId: vi.fn(() => 101),
      getConfidence: vi.fn(() => 'HIGH'),
      getUnderConstruction: vi.fn(() => -1),
      lastFullRefresh: Date.now(),
      _ready: true,
      fleetMovements: [],
    };
    const queue = {
      getPending: vi.fn(() => [pending]),
      getHistory: vi.fn(() => []),
      setMode: vi.fn(async () => {}),
      cancel: vi.fn(() => true),
    };
    const audit = {
      getEntries: vi.fn(() => []),
      getErrorEntries: vi.fn(() => []),
      getErrorStats: vi.fn(() => ({ total: 0, byModule: {}, lastTs: null })),
      getHybridStats: vi.fn(() => ({ pathDecided: 1, attemptOutcome: 1 })),
      warn: vi.fn(),
    };
    const config = { get: vi.fn((k) => k === 'operationMode' ? 'FULL-AUTO' : null) };
    const dc = { setRecMode: vi.fn() };

    const bridge = new UIBridge({ events, state, queue, audit, config, dc, healthCheck: null });
    bridge.init();

    events.emit(events.E.HYBRID_PATH_DECIDED, {
      taskId: 't1',
      decision: { pathDecision: 'endpoint' },
    });
    events.emit(events.E.HYBRID_ATTEMPT_OUTCOME, {
      taskId: 't1',
      outcome: { pathUsed: 'endpoint', outcomeClass: 'guard-reschedule', reasonCode: 'HYBRID_INCONCLUSIVE_TRANSPORT' },
    });

    vi.advanceTimersByTime(150);

    const uiStateCalls = events.emit.mock.calls.filter(([ev]) => ev === events.E.UI_STATE_UPDATED);
    const uiState = uiStateCalls.at(-1)?.[1];

    expect(uiState.nextAction.hybrid.pathUsed).toBe('endpoint');
    expect(uiState.nextAction.hybrid.outcomeClass).toBe('guard-reschedule');
    expect(uiState.nextAction.hybrid.blockerCode).toBe('HYBRID_INCONCLUSIVE_TRANSPORT');
    expect(uiState.queue.pending[0].hybrid.attemptOutcome.reasonCode).toBe('HYBRID_INCONCLUSIVE_TRANSPORT');
    expect(uiState.errorTelemetry.hybrid).toEqual({ pathDecided: 1, attemptOutcome: 1 });
  });
});

