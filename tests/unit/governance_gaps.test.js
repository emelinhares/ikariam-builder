import { CTO } from '../../modules/CTO.js';
import { CSO } from '../../modules/CSO.js';
import { MnA } from '../../modules/MnA.js';
import { COO } from '../../modules/COO.js';
import { getWarehouseSafe } from '../../data/effects.js';

describe('Governance and business-rule gaps', () => {
  test('CTO only queues research for operational academy city', () => {
    const events = {
      E: { CTO_RESEARCH_START: 'cto:researchStarted' },
      on: vi.fn(),
      emit: vi.fn(),
    };
    const audit = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const queue = { getPending: vi.fn(() => []), add: vi.fn() };
    const cities = [
      { id: 1, name: 'A', workers: { scientists: 8 }, buildings: [] },
      { id: 2, name: 'B', workers: { scientists: 6 }, buildings: [{ building: 'academy', level: 3 }] },
      { id: 3, name: 'C', workers: { scientists: 12 }, buildings: [{ building: 'academy', level: 4 }] },
    ];
    const state = {
      research: { investigated: new Set() },
      getAllCities: vi.fn(() => cities),
      getConfidence: vi.fn((cityId) => (cityId === 3 ? 'LOW' : 'HIGH')),
    };

    const cto = new CTO({ events, audit, config: { get: vi.fn() }, state, queue });
    cto._checkAndQueue();

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][0].cityId).toBe(2);
  });

  test('CSO uses highest warehouse level (not sum) to compute risk', () => {
    const events = {
      E: { CSO_CAPITAL_RISK: 'cso:capitalAtRisk' },
      on: vi.fn(),
      emit: vi.fn(),
    };
    const audit = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const levelA = 6;
    const levelB = 5;
    const safeMax = getWarehouseSafe(Math.max(levelA, levelB));
    const safeSum = getWarehouseSafe(levelA + levelB);
    const wood = Math.max(0, safeSum - 1);

    const state = {
      getAllCities: vi.fn(() => [
        {
          id: 10,
          name: 'Capital',
          buildings: [
            { building: 'warehouse', level: levelA },
            { building: 'warehouse', level: levelB },
          ],
          resources: { wood, wine: 0, marble: 0, glass: 0, sulfur: 0 },
        },
      ]),
    };

    const threshold = Math.max(1, Math.floor((wood - safeMax) / 2));
    const cso = new CSO({
      events,
      audit,
      config: { get: vi.fn(() => threshold) },
      state,
      queue: {},
    });

    cso.replan();

    expect(wood - safeMax).toBeGreaterThan(threshold);
    expect(events.emit).toHaveBeenCalledWith(events.E.CSO_CAPITAL_RISK, expect.objectContaining({ cityId: 10 }));
  });

  test('MnA bootstrap-first queues palaceColony build for new corrupted city', () => {
    const events = { E: {}, on: vi.fn(), emit: vi.fn() };
    const audit = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const city = {
      id: 77,
      name: 'Nova',
      economy: { corruption: 0.12 },
      buildings: [{ building: 'palaceColony', level: 1, position: 9 }],
    };
    const queue = {
      getPending: vi.fn(() => [
        { id: 'b1', type: 'BUILD', payload: { building: 'townHall' } },
      ]),
      add: vi.fn(),
      cancel: vi.fn(),
    };
    const state = {
      getCity: vi.fn(() => city),
      getConfidence: vi.fn(() => 'HIGH'),
    };

    const mna = new MnA({ events, audit, config: { get: vi.fn() }, state, queue, storage: {} });
    mna._handleNewCity(77);

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][0]).toMatchObject({
      type: 'BUILD',
      cityId: 77,
      reasonCode: 'MNA_BOOTSTRAP_PALACECOLONY',
      payload: expect.objectContaining({ building: 'palaceColony', position: 9 }),
    });
    expect(queue.cancel).toHaveBeenCalledWith('b1');
  });

  test('COO minimum-stock idempotency checks pending transport by destination globally', () => {
    const events = { E: {}, on: vi.fn(), emit: vi.fn() };
    const audit = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const dest = {
      id: 101,
      name: 'Dest',
      islandId: 11,
      maxResources: 1000,
      resources: { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 },
      production: { wineSpendings: 0 },
      buildings: [],
    };
    const src = {
      id: 202,
      name: 'Src',
      islandId: 22,
      maxResources: 1000,
      resources: { wood: 800, wine: 0, marble: 0, glass: 0, sulfur: 0 },
      production: { wineSpendings: 0 },
      buildings: [],
    };

    const pendingToDest = {
      id: 'tr1',
      type: 'TRANSPORT',
      cityId: 202,
      status: 'pending',
      payload: { fromCityId: 202, toCityId: 101, cargo: { wood: 250 } },
    };

    const queue = {
      getPending: vi.fn((cityId) => {
        if (cityId) return [pendingToDest].filter(t => t.cityId === cityId);
        return [pendingToDest];
      }),
      add: vi.fn(),
    };

    const state = {
      fleetMovements: [],
      getAllCities: vi.fn(() => [dest, src]),
      getInTransit: vi.fn(() => ({})),
      getConfidence: vi.fn(() => 'HIGH'),
      getCity: vi.fn((id) => (id === 101 ? dest : src)),
    };

    const coo = new COO({
      events,
      audit,
      config: { get: vi.fn((k) => (k === 'minStockFraction' ? 0.2 : 0)) },
      state,
      queue,
      client: {},
      storage: {},
    });

    coo._checkMinimumStocks();
    expect(queue.add).not.toHaveBeenCalled();
  });
});

