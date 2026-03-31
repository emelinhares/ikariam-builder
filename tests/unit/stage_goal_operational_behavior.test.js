import { HR } from '../../modules/HR.js';
import { CTO } from '../../modules/CTO.js';
import { CFO } from '../../modules/CFO.js';
import { COO } from '../../modules/COO.js';

describe('Stage/goal operational behavior', () => {
  test('HR in BOOTSTRAP avoids aggressive tavern downshift that would slow population', () => {
    const events = { E: {}, on: vi.fn(), emit: vi.fn() };
    const audit = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const queue = {
      add: vi.fn(),
      getPending: vi.fn(() => []),
      hasPendingType: vi.fn(() => false),
    };
    const city = {
      id: 1,
      name: 'Alpha',
      tavern: { wineLevel: 3 },
      buildings: [{ building: 'tavern', level: 8 }],
      economy: { satisfaction: 2, population: 500 },
      resources: { wine: 3000 },
      production: { wineSpendings: 60 },
    };
    const state = {
      getAllCities: vi.fn(() => [city]),
      getCity: vi.fn(() => city),
      getConfidence: vi.fn(() => 'HIGH'),
    };
    const config = { get: vi.fn((k) => (k === 'wineEmergencyHours' ? 4 : 0)) };

    const hr = new HR({ events, audit, config, state, queue });
    hr.replan({ stage: 'BOOTSTRAP', globalGoal: 'GROW_POPULATION', cities: new Map([[1, {}]]) });

    expect(queue.add).not.toHaveBeenCalled();
  });

  test('CTO in PRE_EXPANSION aligns queue with expansion research first', () => {
    const events = { E: { CTO_RESEARCH_START: 'cto:researchStarted' }, on: vi.fn(), emit: vi.fn() };
    const audit = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const queue = { getPending: vi.fn(() => []), add: vi.fn() };
    const state = {
      research: { investigated: new Set() },
      getAllCities: vi.fn(() => [
        {
          id: 10,
          name: 'Science',
          workers: { scientists: 20 },
          buildings: [{ building: 'academy', level: 8 }],
        },
      ]),
      getConfidence: vi.fn(() => 'HIGH'),
      getServerNow: vi.fn(() => 0),
    };

    const cto = new CTO({ events, audit, config: { get: vi.fn() }, state, queue });
    cto.replan({ stage: 'PRE_EXPANSION', globalGoal: 'PREPARE_EXPANSION' });

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][0].payload.researchId).toBe(1030);
  });

  test('CFO applies strategic stage bias to building score in BOOTSTRAP', () => {
    const events = { E: {}, on: vi.fn(), emit: vi.fn() };
    const audit = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const city = {
      id: 101,
      name: 'Alpha',
      economy: { corruption: 0, population: 400, maxInhabitants: 1000, growthPerHour: 20, satisfaction: 3 },
      workers: { scientists: 5 },
      resources: { wood: 6000, wine: 1000, marble: 2000, glass: 1000, sulfur: 1000 },
      maxResources: 10000,
    };
    const state = { getAllCities: vi.fn(() => [city]) };
    const queue = { getPending: vi.fn(() => []) };
    const config = { get: vi.fn(() => 0) };
    const cfo = new CFO({ events, audit, config, state, queue });

    const base = cfo._buildingScore('warehouse', 5, city, null, 1, null);
    const bootstrap = cfo._buildingScore('warehouse', 5, city, null, 1, { stage: 'BOOTSTRAP', goal: 'SURVIVE' });

    expect(bootstrap).toBeGreaterThan(base);
  });

  test('COO adjusts wine emergency shipment size by stage', () => {
    const events = { E: {}, on: vi.fn(), emit: vi.fn() };
    const audit = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const dest = {
      id: 1,
      name: 'Destino',
      islandId: 11,
      maxResources: 10000,
      resources: { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 },
      production: { wineSpendings: 10 },
      buildings: [],
      tradegood: 1,
    };
    const src = {
      id: 2,
      name: 'Fonte',
      islandId: 22,
      maxResources: 10000,
      resources: { wood: 0, wine: 10000, marble: 0, glass: 0, sulfur: 0 },
      production: { wineSpendings: 0 },
      buildings: [],
      tradegood: 4,
    };
    const state = {
      fleetMovements: [],
      getCity: vi.fn((id) => (id === 1 ? dest : src)),
      getAllCities: vi.fn(() => [dest, src]),
      getInTransit: vi.fn(() => ({})),
      getConfidence: vi.fn(() => 'HIGH'),
    };
    const queue = { getPending: vi.fn(() => []), add: vi.fn() };
    const config = {
      get: vi.fn((k) => {
        if (k === 'minStockFraction') return 0.2;
        if (k === 'producerSafetyStockMultiplier') return 1.35;
        if (k === 'overflowThresholdPct') return 0.95;
        if (k === 'overflowTimeToCapHours') return 2;
        if (k === 'overflowTargetTimeToCapHours') return 6;
        return 0;
      }),
    };

    const coo = new COO({ events, audit, config, state, queue, client: {}, storage: {} });

    coo._strategicCtx = { stage: 'BOOTSTRAP', globalGoal: 'GROW_POPULATION' };
    coo._scheduleWineEmergency(1);
    const bootstrapWine = queue.add.mock.calls[0][0].payload.cargo.wine;

    queue.add.mockClear();
    coo._strategicCtx = { stage: 'PRE_EXPANSION', globalGoal: 'PREPARE_EXPANSION' };
    coo._scheduleWineEmergency(1);
    const preExpansionWine = queue.add.mock.calls[0][0].payload.cargo.wine;

    expect(preExpansionWine).toBeGreaterThan(bootstrapWine);
    expect(bootstrapWine).toBe(180);
    expect(preExpansionWine).toBe(300);
  });
});

