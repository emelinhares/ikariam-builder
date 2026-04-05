import { createIntegrationHarness } from './harness.js';

describe('Integration: wine starvation fixes', () => {
  test('splits emergency wine transport across multiple source cities', async () => {
    const harness = await createIntegrationHarness({
      enableTransportRegistry: false,
      cities: [
        {
          id: 101,
          name: 'NeedWine',
          tradegood: 2,
          islandId: 11,
          coords: [11, 11],
          maxResources: 10_000,
          resources: { wood: 1000, wine: 0, marble: 0, glass: 0, sulfur: 0 },
          production: { wood: 100, tradegood: 100, wineSpendings: 0 },
          tavern: { wineLevel: 0 },
          buildings: [{ position: 2, building: 'tavern', level: 6 }],
          freeTransporters: 10,
          maxTransporters: 10,
          economy: { goldPerHour: 100, satisfaction: -1 },
        },
        {
          id: 201,
          name: 'WineA',
          tradegood: 1,
          islandId: 21,
          coords: [21, 21],
          maxResources: 10_000,
          resources: { wood: 1000, wine: 2400, marble: 0, glass: 0, sulfur: 0 },
          production: { wood: 100, tradegood: 200, wineSpendings: 0 },
          buildings: [{ position: 1, building: 'warehouse', level: 8 }],
          freeTransporters: 10,
          maxTransporters: 10,
          economy: { goldPerHour: 100, satisfaction: 4 },
        },
        {
          id: 202,
          name: 'WineB',
          tradegood: 1,
          islandId: 22,
          coords: [22, 22],
          maxResources: 10_000,
          resources: { wood: 1000, wine: 2400, marble: 0, glass: 0, sulfur: 0 },
          production: { wood: 100, tradegood: 200, wineSpendings: 0 },
          buildings: [{ position: 1, building: 'warehouse', level: 8 }],
          freeTransporters: 10,
          maxTransporters: 10,
          economy: { goldPerHour: 100, satisfaction: 4 },
        },
        {
          id: 203,
          name: 'Other1',
          tradegood: 2,
          islandId: 23,
          coords: [23, 23],
          maxResources: 10_000,
          resources: { wood: 1000, wine: 100, marble: 0, glass: 0, sulfur: 0 },
          production: { wood: 100, tradegood: 50, wineSpendings: 0 },
          buildings: [{ position: 1, building: 'warehouse', level: 4 }],
          freeTransporters: 10,
          maxTransporters: 10,
          economy: { goldPerHour: 100, satisfaction: 4 },
        },
        {
          id: 204,
          name: 'Other2',
          tradegood: 3,
          islandId: 24,
          coords: [24, 24],
          maxResources: 10_000,
          resources: { wood: 1000, wine: 100, marble: 0, glass: 0, sulfur: 0 },
          production: { wood: 100, tradegood: 50, wineSpendings: 0 },
          buildings: [{ position: 1, building: 'warehouse', level: 4 }],
          freeTransporters: 10,
          maxTransporters: 10,
          economy: { goldPerHour: 100, satisfaction: 4 },
        },
      ],
    });

    harness.coo._scheduleWineEmergency(101, {
      cityId: 101,
      targetWineAmount: 2000,
      wineMode: 'IMPORT_WINE',
      recoveryWinePerHour: 100,
      recoveryWineLevel: 1,
      bootstrapRecovery: false,
    });

    const transports = harness.queue.getPending()
      .filter((t) => t.type === 'TRANSPORT' && t.payload?.wineEmergency);
    expect(transports.length).toBe(2);
    const total = transports.reduce((sum, t) => sum + Number(t.payload?.cargo?.wine ?? 0), 0);
    expect(total).toBe(2000);
  });

  test('tavern off + wine=0 still yields positive wine emergency shipment target', async () => {
    const harness = await createIntegrationHarness({
      enableTransportRegistry: false,
      cities: [
        {
          id: 301,
          name: 'NoWineTavernOff',
          tradegood: 2,
          islandId: 31,
          coords: [31, 31],
          maxResources: 10_000,
          resources: { wood: 1000, wine: 0, marble: 0, glass: 0, sulfur: 0 },
          production: { wood: 100, tradegood: 100, wineSpendings: 0 },
          tavern: { wineLevel: 0 },
          buildings: [{ position: 2, building: 'tavern', level: 5 }],
          freeTransporters: 10,
          maxTransporters: 10,
          economy: { goldPerHour: 100, satisfaction: 0, population: 300, growthPerHour: -1 },
          typed: { wineSpendings: 0, populationUsed: 300, maxInhabitants: 500, happinessScore: 0 },
        },
        {
          id: 302,
          name: 'WineSource',
          tradegood: 1,
          islandId: 32,
          coords: [32, 32],
          maxResources: 20_000,
          resources: { wood: 5000, wine: 8000, marble: 0, glass: 0, sulfur: 0 },
          production: { wood: 500, tradegood: 800, wineSpendings: 0 },
          buildings: [{ position: 1, building: 'warehouse', level: 8 }],
          freeTransporters: 10,
          maxTransporters: 10,
          economy: { goldPerHour: 300, satisfaction: 5 },
        },
      ],
    });

    harness.hr.init();
    harness.coo.init();

    harness.hr.replan({
      stage: 'BOOTSTRAP',
      globalGoal: 'SURVIVE',
      growthPolicy: { growthStage: 'STABILIZE_CITY' },
      cities: new Map([[301, {}]]),
    });

    const transports = harness.queue.getPending()
      .filter((t) => t.type === 'TRANSPORT' && t.payload?.wineEmergency && t.payload?.toCityId === 301);
    expect(transports.length).toBeGreaterThan(0);
    expect(Number(transports[0].payload?.cargo?.wine ?? 0)).toBeGreaterThan(0);
  });

  test('stale planned transport intent expires and allows a new equivalent transport', async () => {
    const harness = await createIntegrationHarness({
      enableTransportRegistry: true,
      cities: [
        {
          id: 401,
          name: 'Src',
          tradegood: 1,
          islandId: 41,
          coords: [41, 41],
          maxResources: 10_000,
          resources: { wood: 1000, wine: 5000, marble: 0, glass: 0, sulfur: 0 },
          production: { wood: 100, tradegood: 100, wineSpendings: 0 },
          buildings: [{ position: 1, building: 'warehouse', level: 8 }],
          freeTransporters: 10,
          maxTransporters: 10,
          economy: { goldPerHour: 100, satisfaction: 5 },
        },
        {
          id: 402,
          name: 'Dst',
          tradegood: 2,
          islandId: 42,
          coords: [42, 42],
          maxResources: 10_000,
          resources: { wood: 1000, wine: 0, marble: 0, glass: 0, sulfur: 0 },
          production: { wood: 100, tradegood: 100, wineSpendings: 0 },
          buildings: [{ position: 1, building: 'warehouse', level: 8 }],
          freeTransporters: 10,
          maxTransporters: 10,
          economy: { goldPerHour: 100, satisfaction: 0 },
        },
      ],
    });

    const t1 = harness.queue.add({
      type: 'TRANSPORT',
      priority: 1,
      cityId: 401,
      payload: {
        fromCityId: 401,
        toCityId: 402,
        toIslandId: 42,
        cargo: { wine: 500 },
        boats: 1,
        totalCargo: 500,
        wineEmergency: true,
        logisticPurpose: 'wineEmergency',
      },
      scheduledFor: Date.now(),
      reason: 'test planned intent',
      module: 'COO',
      confidence: 'HIGH',
    });

    const record = harness.transportIntentRegistry._records.get(t1.payload.intentId);
    record.createdAt = Date.now() - (harness.transportIntentRegistry._plannedDispatchTtlMs + 1000);
    record.updatedAt = record.createdAt;
    harness.transportIntentRegistry._expireOld(Date.now());

    const t2 = harness.queue.add({
      type: 'TRANSPORT',
      priority: 1,
      cityId: 401,
      payload: {
        fromCityId: 401,
        toCityId: 402,
        toIslandId: 42,
        cargo: { wine: 500 },
        boats: 1,
        totalCargo: 500,
        wineEmergency: true,
        logisticPurpose: 'wineEmergency',
      },
      scheduledFor: Date.now(),
      reason: 'test planned intent retry',
      module: 'COO',
      confidence: 'HIGH',
    });

    expect(t2).toBeTruthy();
    expect(t2.status).toBe('pending');
  });
});

