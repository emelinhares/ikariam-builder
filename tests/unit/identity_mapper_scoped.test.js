import { StateManager } from '../../modules/StateManager.js';
import { DataCollector } from '../../modules/DataCollector.js';

function createAudit() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createStateEvents() {
  return {
    E: {
      DC_HEADER_DATA: 'dc:headerData',
      DC_MODEL_REFRESH: 'dc:modelRefresh',
      DC_SCREEN_DATA: 'dc:screenData',
      DC_FLEET_MOVEMENTS: 'dc:fleetMovements',
      DC_TOWNHALL_DATA: 'dc:townhallData',
      QUEUE_TASK_STARTED: 'queue:taskStarted',
      QUEUE_TASK_DONE: 'queue:taskDone',
      QUEUE_TASK_FAILED: 'queue:taskFailed',
      STATE_CITY_UPDATED: 'state:cityUpdated',
      STATE_RESEARCH: 'state:researchUpdated',
      STATE_READY: 'state:ready',
      STATE_ALL_FRESH: 'state:allCitiesFresh',
    },
    on: vi.fn(),
    emit: vi.fn(),
  };
}

function createDcEvents() {
  return {
    E: {
      DC_HEADER_DATA: 'dc:headerData',
      DC_SCREEN_DATA: 'dc:screenData',
      DC_FLEET_MOVEMENTS: 'dc:fleetMovements',
      DC_TOWNHALL_DATA: 'dc:townhallData',
      DC_MODEL_REFRESH: 'dc:modelRefresh',
    },
    emit: vi.fn(),
  };
}

describe('Scope D identity mapper (city-island)', () => {
  beforeEach(() => {
    localStorage.clear();
    delete globalThis.__ERP;
  });

  test('StateManager registra, resolve e restaura mapeamento cityId<->islandId', () => {
    const events = createStateEvents();
    const audit = createAudit();

    const state = new StateManager({ events, audit, config: {} });
    const changed = state.registerCityIslandMapping({ cityId: 101, islandId: 77 });

    expect(changed).toBe(true);
    expect(state.resolveCityIdByIslandId(77)).toBe(101);
    expect(state.resolveIslandIdByCityId(101)).toBe(77);

    const persisted = JSON.parse(localStorage.getItem('erp_state_city_island_map_v1'));
    expect(persisted).toEqual([{ cityId: 101, islandId: 77 }]);

    const restored = new StateManager({ events, audit, config: {} });
    expect(restored.resolveCityIdByIslandId(77)).toBe(101);
    expect(restored.resolveIslandIdByCityId(101)).toBe(77);
  });

  test('StateManager expõe snapshot híbrido de prereqs com freshness/context/token', () => {
    const events = createStateEvents();
    const audit = createAudit();
    const state = new StateManager({ events, audit, config: {} });

    state.cities.set(101, {
      id: 101,
      name: 'A',
      fetchedAt: Date.now() - 45_000,
      underConstruction: -1,
      lockedPositions: new Set(),
      economy: {},
      resources: {},
      production: {},
      workers: {},
      tavern: {},
      buildings: [],
    });
    state.setActiveCityId(101);

    const snap = state.getHybridPrereqSnapshot(101, { token: 'abc123' });
    expect(snap.contextLock.locked).toBe(true);
    expect(snap.tokenSnapshot.present).toBe(true);
    expect(snap.routeConfidence).toBe('HIGH');
    expect(snap.freshness.stale).toBe(false);
    expect(snap.dataProvenance).toEqual(['endpoint', 'html-response']);
  });

  test('DataCollector deduplica candidate cityId em contexto de ilha via mapper do StateManager', () => {
    const events = createDcEvents();
    const audit = createAudit();
    const state = {
      resolveCityIdByIslandId: vi.fn(() => 101),
      registerCityIslandMapping: vi.fn(),
    };
    globalThis.__ERP = { state };

    const dc = new DataCollector({ events, audit });

    dc._onGlobalData(
      {
        headerData: {},
        backgroundData: {
          id: 999,
          position: [{ building: 'townHall', level: 1 }],
        },
      },
      '/index.php?view=resource&currentIslandId=77&backgroundView=island&ajax=1'
    );

    expect(state.resolveCityIdByIslandId).toHaveBeenCalledWith(77);
    expect(state.registerCityIslandMapping).toHaveBeenCalledWith({ cityId: 101, islandId: 77 });

    expect(events.emit).toHaveBeenCalledWith(events.E.DC_SCREEN_DATA, expect.objectContaining({
      cityId: 101,
      screenData: expect.objectContaining({ islandId: 77 }),
    }));
  });

  test('DataCollector mantém fluxo compatível quando IDs estão parciais/ausentes', () => {
    const events = createDcEvents();
    const audit = createAudit();
    globalThis.__ERP = {
      state: {
        resolveCityIdByIslandId: vi.fn(() => null),
        registerCityIslandMapping: vi.fn(),
      },
    };

    const dc = new DataCollector({ events, audit });

    expect(() => {
      dc._onGlobalData(
        {
          headerData: {},
          backgroundData: { position: [{ building: 'townHall', level: 1 }] },
        },
        '/index.php?view=city&backgroundView=city&ajax=1'
      );
    }).not.toThrow();

    expect(events.emit).toHaveBeenCalledWith(events.E.DC_SCREEN_DATA, expect.objectContaining({
      cityId: null,
    }));
  });
});

