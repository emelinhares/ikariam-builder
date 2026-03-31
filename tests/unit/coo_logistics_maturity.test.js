import { COO } from '../../modules/COO.js';

function createCooHarness({ cities, config = {} } = {}) {
  const cityMap = new Map((cities ?? []).map((c) => [c.id, c]));

  const events = {
    E: {
      QUEUE_TASK_ADDED: 'queue:taskAdded',
      DC_HEADER_DATA: 'dc:headerData',
      HR_WINE_EMERGENCY: 'hr:wineEmergency',
      COO_TRANSPORT_SCHED: 'coo:transportScheduled',
      COO_MIN_STOCK_SCHED: 'coo:minStockScheduled',
    },
    on: vi.fn(),
    emit: vi.fn(),
  };

  const audit = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const configMap = {
    minStockFraction: 0.2,
    producerSafetyStockMultiplier: 1.35,
    overflowThresholdPct: 0.95,
    overflowTimeToCapHours: 2,
    overflowTargetTimeToCapHours: 6,
    ...config,
  };

  const state = {
    fleetMovements: [],
    getAllCities: vi.fn(() => [...cityMap.values()]),
    getCity: vi.fn((id) => cityMap.get(id) ?? null),
    getInTransit: vi.fn(() => ({})),
    getConfidence: vi.fn(() => 'HIGH'),
    isProbing: vi.fn(() => false),
    getActiveCityId: vi.fn(() => 0),
  };

  const queue = {
    getPending: vi.fn(() => []),
    add: vi.fn(),
  };

  const coo = new COO({
    events,
    audit,
    config: { get: vi.fn((k) => configMap[k]) },
    state,
    queue,
    client: {},
    storage: {},
  });

  return { coo, cityMap, state, queue, events, audit };
}

describe('COO logistics maturity', () => {
  test('prioritizes producer city over stock-only city for resource source', () => {
    const dest = {
      id: 1,
      name: 'Destino',
      islandId: 10,
      tradegood: 1,
      maxResources: 10_000,
      resources: { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 },
      production: { wood: 0, tradegood: 0, wineSpendings: 0 },
      buildings: [],
    };
    const producer = {
      id: 2,
      name: 'Produtora de Mármore',
      islandId: 20,
      tradegood: 2,
      maxResources: 10_000,
      resources: { wood: 1000, wine: 0, marble: 4000, glass: 0, sulfur: 0 },
      production: { wood: 300, tradegood: 1200, wineSpendings: 0 },
      buildings: [],
    };
    const stockOnly = {
      id: 3,
      name: 'Estoque',
      islandId: 30,
      tradegood: 1,
      maxResources: 10_000,
      resources: { wood: 1000, wine: 0, marble: 9000, glass: 0, sulfur: 0 },
      production: { wood: 300, tradegood: 1000, wineSpendings: 0 },
      buildings: [],
    };

    const { coo } = createCooHarness({ cities: [dest, producer, stockOnly] });
    const ledger = coo._buildCommitmentLedger();
    const cls = coo._buildCityClassification();

    const source = coo._findSource('marble', 1000, dest.id, ledger, cls);
    expect(source.id).toBe(producer.id);
  });

  test('schedules overflow relief before 95% based on timeToCap', () => {
    const src = {
      id: 11,
      name: 'Cidade Produtiva',
      islandId: 10,
      tradegood: 2,
      maxResources: 10_000,
      resources: { wood: 8800, wine: 0, marble: 100, glass: 0, sulfur: 0 },
      production: { wood: 2000, tradegood: 1000, wineSpendings: 0 },
      buildings: [],
    };
    const dst = {
      id: 22,
      name: 'Cidade Receptora',
      islandId: 20,
      tradegood: 1,
      maxResources: 10_000,
      resources: { wood: 1000, wine: 0, marble: 500, glass: 0, sulfur: 0 },
      production: { wood: 100, tradegood: 100, wineSpendings: 0 },
      buildings: [],
    };

    const { coo, queue } = createCooHarness({ cities: [src, dst] });
    const cls = coo._buildCityClassification();
    const ledger = coo._buildCommitmentLedger();

    const scheduled = coo._checkCityOverflow(src, ledger, cls);
    expect(scheduled).toBe(1);
    expect(queue.add).toHaveBeenCalledTimes(1);

    const task = queue.add.mock.calls[0][0];
    expect(task.type).toBe('TRANSPORT');
    expect(task.payload.fromCityId).toBe(src.id);
    expect(task.payload.toCityId).toBe(dst.id);
    expect(task.payload.overflowRelief).toBe(true);
    expect(task.payload.cargo.wood).toBeGreaterThan(0);
  });
});

