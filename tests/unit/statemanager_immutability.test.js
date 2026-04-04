import { StateManager } from '../../modules/StateManager.js';
import { PlannerCityContext } from '../../modules/Planner.js';

function createAudit() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createEvents() {
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
      STATE_RESEARCH: 'state:research',
      STATE_READY: 'state:ready',
      STATE_ALL_FRESH: 'state:allFresh',
    },
    on: vi.fn(),
    emit: vi.fn(),
  };
}

describe('StateManager immutability guardrails', () => {
  test('getCity returns shallow copy while getCityRef returns live reference', () => {
    const state = new StateManager({ events: createEvents(), audit: createAudit(), config: {} });
    const city = state._createEmptyCityState(101, { name: 'Alpha' });
    city.resources.wood = 120;
    state.cities.set(101, city);

    const copy = state.getCity(101);
    const ref = state.getCityRef(101);

    expect(copy).not.toBe(ref);
    expect(copy).toEqual(expect.objectContaining({ id: 101, name: 'Alpha' }));

    copy.name = 'MutatedCopy';
    expect(state.getCityRef(101).name).toBe('Alpha');

    // Shallow copy intentionally preserves nested references for hot-read compatibility.
    copy.resources.wood = 333;
    expect(state.getCityRef(101).resources.wood).toBe(333);
  });

  test('city _version increments when state handlers mutate the city', () => {
    const state = new StateManager({ events: createEvents(), audit: createAudit(), config: {} });
    state.setActiveCityId(101);
    state.cities.set(101, state._createEmptyCityState(101, { name: 'Alpha' }));

    expect(state.getCityRef(101)._version).toBe(0);

    state._onHeaderData({
      cityId: 101,
      headerData: {
        currentResources: { resource: 100, '1': 40 },
        maxResources: { resource: 1000 },
      },
    });
    expect(state.getCityRef(101)._version).toBe(1);

    state._onScreenData({
      cityId: 101,
      screenData: {
        position: [{ building: 'townHall', level: 5, completed: null, isBusy: false }],
      },
    });
    expect(state.getCityRef(101)._version).toBe(2);

    state._onTownhallData({
      cityId: 101,
      params: {
        occupiedSpace: 200,
        maxInhabitants: 400,
      },
    });
    expect(state.getCityRef(101)._version).toBe(3);
  });
});

describe('PlannerCityContext explicit mutators', () => {
  test('uses explicit setters for planner state flags', () => {
    const ctx = new PlannerCityContext({
      hasCriticalSupply: true,
      buildBlocked: false,
      buildApprovedBy: null,
      wineEmergencyHandled: false,
      wineBootstrapNeeded: false,
    });

    ctx.markBuildBlocked();
    ctx.markWineHandled({ wineBootstrapNeeded: true });
    ctx.setBuildApprovedBy('CFO');

    expect(ctx.buildBlocked).toBe(true);
    expect(ctx.wineEmergencyHandled).toBe(true);
    expect(ctx.wineBootstrapNeeded).toBe(true);
    expect(ctx.buildApprovedBy).toBe('CFO');
  });
});
