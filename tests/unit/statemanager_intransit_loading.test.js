import { StateManager } from '../../modules/StateManager.js';

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
      STATE_RESEARCH: 'state:researchUpdated',
      STATE_READY: 'state:ready',
      STATE_ALL_FRESH: 'state:allCitiesFresh',
    },
    on: vi.fn(),
    emit: vi.fn(),
  };
}

function createAudit() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('StateManager getInTransit', () => {
  test('conta movimento em loading/A carregar como cobertura comprometida', () => {
    const state = new StateManager({ events: createEvents(), audit: createAudit(), config: {} });
    state.fleetMovements = [
      {
        isOwn: true,
        isReturn: false,
        targetCityId: 101,
        cargo: { wood: 400 },
        state: 'loading',
        progressPct: 0,
      },
      {
        isOwn: true,
        isReturn: false,
        targetCityId: 101,
        cargo: { marble: 100 },
        state: 'A carregar',
        progressPct: 0,
      },
    ];

    const inTransit = state.getInTransit(101);
    expect(inTransit.wood).toBe(400);
    expect(inTransit.marble).toBe(100);
  });

  test('ignora retorno ou frota não-própria', () => {
    const state = new StateManager({ events: createEvents(), audit: createAudit(), config: {} });
    state.fleetMovements = [
      { isOwn: true, isReturn: true, targetCityId: 101, cargo: { wood: 999 }, state: 'loading' },
      { isOwn: false, isReturn: false, targetCityId: 101, cargo: { wood: 888 }, state: 'loading' },
      { isOwn: true, isReturn: false, targetCityId: 101, cargo: { wood: 111 }, state: 'sailing' },
    ];

    const inTransit = state.getInTransit(101);
    expect(inTransit.wood).toBe(111);
  });
});

