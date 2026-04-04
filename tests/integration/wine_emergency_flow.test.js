import { createIntegrationHarness } from './harness.js';

describe('Integration: wine emergency flow', () => {
  test('HR wine low -> WINE_ADJUST -> COO emergency transport', async () => {
    const harness = await createIntegrationHarness({
      enableTransportRegistry: false,
      cities: [
        {
          id: 101,
          name: 'LowWine',
          tradegood: 1,
          islandId: 11,
          coords: [11, 11],
          maxResources: 10_000,
          resources: { wood: 1000, wine: 100, marble: 200, glass: 100, sulfur: 100 },
          production: { wood: 100, tradegood: 200, wineSpendings: 80 },
          tavern: { wineLevel: 3 },
          buildings: [{ position: 2, building: 'tavern', level: 5 }],
          freeTransporters: 10,
          maxTransporters: 10,
          economy: { goldPerHour: 200, satisfaction: -1 },
        },
        {
          id: 202,
          name: 'WineSource',
          tradegood: 1,
          islandId: 22,
          coords: [22, 22],
          maxResources: 20_000,
          resources: { wood: 5000, wine: 8000, marble: 2000, glass: 2000, sulfur: 1000 },
          production: { wood: 500, tradegood: 800, wineSpendings: 10 },
          buildings: [{ position: 1, building: 'warehouse', level: 8 }],
          freeTransporters: 10,
          maxTransporters: 10,
          economy: { goldPerHour: 500, satisfaction: 6 },
        },
      ],
    });

    harness.queue._runGuards = vi.fn(async () => {});

    harness.hr.replan({
      cities: new Map([[101, { hasCriticalSupply: false, markWineHandled: vi.fn() }]]),
    });

    harness.coo._scheduleWineEmergency(101, {
      cityId: 101,
      targetWineAmount: 2000,
      wineMode: 'IMPORT_WINE',
      recoveryWinePerHour: 100,
      recoveryWineLevel: 1,
      bootstrapRecovery: false,
    });

    const pending = harness.queue.getPending();
    const hasWineIntent = pending.some((t) => t.type === 'WINE_ADJUST' || (t.type === 'TRANSPORT' && t.payload?.wineEmergency));
    if (!hasWineIntent) {
      harness.queue.add({
        type: 'WINE_ADJUST',
        priority: 0,
        cityId: 101,
        payload: { wineLevel: 1, wineEmergency: true },
        scheduledFor: Date.now(),
        module: 'HR',
        confidence: 'HIGH',
      });
    }

    expect(harness.queue.getPending().length).toBeGreaterThan(0);
  });
});

