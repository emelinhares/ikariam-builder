import { CFO } from '../../modules/CFO.js';
import { COO } from '../../modules/COO.js';

function createEmitter() {
  const handlers = new Map();
  return {
    E: {
      QUEUE_TASK_ADDED: 'queue:taskAdded',
      QUEUE_TASK_DONE: 'queue:taskDone',
      CFO_BUILD_APPROVED: 'cfo:buildApproved',
      CFO_BUILD_BLOCKED: 'cfo:buildBlocked',
      COO_TRANSPORT_SCHED: 'coo:transportScheduled',
      DC_HEADER_DATA: 'dc:headerData',
      HR_WINE_EMERGENCY: 'hr:wineEmergency',
      COO_MIN_STOCK_SCHED: 'coo:minStockScheduled',
    },
    on: vi.fn((event, cb) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(cb);
    }),
    emit: vi.fn((event, payload) => {
      for (const cb of handlers.get(event) ?? []) cb(payload);
    }),
  };
}

describe('Scope D CFO + COO integration', () => {
  test('local fail + global pass => BUILD waiting_resources + JIT transport requested', async () => {
    const events = createEmitter();
    const audit = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cityDest = {
      id: 101,
      name: 'Alpha',
      islandId: 11,
      tradegood: 1,
      coords: [0, 0],
      economy: { goldPerHour: 500, corruption: 0, population: 100, maxInhabitants: 500, growthPerHour: 2, satisfaction: 2 },
      workers: { scientists: 0 },
      resources: { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 },
      maxResources: 10_000,
      lockedPositions: new Set(),
      buildings: [{ building: 'townHall', level: 0, position: 3 }, { building: 'port', level: 5, position: 1 }],
      freeTransporters: 30,
      maxTransporters: 30,
      underConstruction: -1,
    };

    const citySrc = {
      id: 202,
      name: 'Beta',
      islandId: 22,
      tradegood: 1,
      coords: [3, 4],
      economy: { goldPerHour: 500, corruption: 0, population: 100, maxInhabitants: 500, growthPerHour: 2, satisfaction: 2 },
      workers: { scientists: 0 },
      resources: { wood: 8_000, wine: 0, marble: 0, glass: 0, sulfur: 0 },
      maxResources: 10_000,
      lockedPositions: new Set(),
      buildings: [{ building: 'warehouse', level: 10, position: 2 }, { building: 'port', level: 5, position: 1 }],
      freeTransporters: 30,
      maxTransporters: 30,
      underConstruction: -1,
    };

    const cities = new Map([
      [cityDest.id, cityDest],
      [citySrc.id, citySrc],
    ]);

    const configData = {
      roiThreshold: 2,
      goldProjectionHours: 12,
      minStockFraction: 0.2,
      transportSafetyBufferS: 0,
      sameIslandTravelS: 600,
      worldSpeedConst: 1200,
      departureFixedS: 0,
    };
    const config = { get: vi.fn((k) => configData[k]) };

    const state = {
      research: { investigated: new Set() },
      fleetMovements: [],
      getCity: vi.fn((id) => cities.get(id) ?? null),
      getAllCities: vi.fn(() => [...cities.values()]),
      getConfidence: vi.fn(() => 'HIGH'),
      getUnderConstruction: vi.fn(() => -1),
      getInTransit: vi.fn(() => ({})),
      isProbing: vi.fn(() => false),
      getActiveCityId: vi.fn(() => cityDest.id),
    };

    const taskList = [];
    const queue = {
      hasPendingBuild: vi.fn(() => false),
      getPending: vi.fn((cityId) => taskList.filter((t) => t.status === 'pending' && (!cityId || t.cityId === cityId))),
      add: vi.fn((taskData) => {
        const task = {
          id: `t-${taskList.length + 1}`,
          status: 'pending',
          createdAt: Date.now(),
          ...taskData,
        };
        taskList.push(task);
        events.emit(events.E.QUEUE_TASK_ADDED, { task });
        return task;
      }),
    };

    const client = { probeJourneyTime: vi.fn(async () => 1200) };
    const storage = { get: vi.fn(async () => null), set: vi.fn(async () => {}) };

    const cfo = new CFO({ events, audit, config, state, queue });
    const coo = new COO({ events, audit, config, state, queue, client, storage });
    coo.init();
    vi.spyOn(coo, '_calculateEta').mockResolvedValue({ loadingTime: 10, travelTime: 20, totalEta: 30 });
    vi.spyOn(cfo, '_getBuildCandidates').mockReturnValue([
      {
        building: 'townHall',
        position: 3,
        toLevel: 1,
        cost: { wood: 1000 },
        totalCost: 1000,
        score: 80,
        roi: 5,
        reason: 'test-candidate',
      },
    ]);

    cfo.evaluateCity(cityDest.id);
    await Promise.resolve();

    const waitingBuild = taskList.find((t) => t.type === 'BUILD');
    await coo._scheduleJITForBuild(waitingBuild);
    const jitTransport = taskList.find((t) => t.type === 'TRANSPORT');

    expect(waitingBuild).toBeTruthy();
    expect(waitingBuild.status).toBe('waiting_resources');
    expect(waitingBuild.reasonCode).toBe('BUILD_WAITING_RESOURCES_GLOBAL_TREASURY');
    expect(waitingBuild.payload.waitingResources).toBe(true);

    expect(jitTransport).toBeTruthy();
    expect(jitTransport.reasonCode).toBe('COO_JIT_TRANSPORT_FOR_BUILD');
    expect(jitTransport.payload.fromCityId).toBe(citySrc.id);
    expect(jitTransport.payload.toCityId).toBe(cityDest.id);
    expect(jitTransport.payload.cargo.wood).toBe(1000);
    expect(jitTransport.evidence.join(' | ')).toMatch(/sourceSafetyStock=/);
  });
});

