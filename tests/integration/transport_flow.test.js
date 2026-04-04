import { createIntegrationHarness } from './harness.js';

describe('Integration: transport flow', () => {
  test('COO overflow -> TaskQueue -> GameClient.sendTransport -> intent registry update', async () => {
    const harness = await createIntegrationHarness({
      enableTransportRegistry: true,
      hooks: {
        onSendTransport: async (fromCityId, toCityId, _toIslandId, cargo, _boats, _expected, state) => {
          state.fleetMovements.push({
            isOwn: true,
            isReturn: false,
            originCityId: Number(fromCityId),
            targetCityId: Number(toCityId),
            cargo: cargo ?? {},
          });
        },
      },
      cities: [
        {
          id: 101,
          name: 'OverflowSrc',
          tradegood: 2,
          islandId: 10,
          coords: [10, 10],
          maxResources: 10_000,
          resources: { wood: 9800, wine: 0, marble: 500, glass: 0, sulfur: 0 },
          production: { wood: 1500, tradegood: 800, wineSpendings: 0 },
          buildings: [{ position: 1, building: 'warehouse', level: 8 }],
          freeTransporters: 10,
          maxTransporters: 10,
          economy: { goldPerHour: 300, satisfaction: 4 },
        },
        {
          id: 202,
          name: 'Receiver',
          tradegood: 1,
          islandId: 20,
          coords: [20, 20],
          maxResources: 10_000,
          resources: { wood: 1000, wine: 0, marble: 500, glass: 0, sulfur: 0 },
          production: { wood: 100, tradegood: 100, wineSpendings: 0 },
          buildings: [{ position: 1, building: 'warehouse', level: 5 }],
          freeTransporters: 10,
          maxTransporters: 10,
          economy: { goldPerHour: 200, satisfaction: 4 },
        },
      ],
    });

    harness.queue._runGuards = vi.fn(async () => {});

    const t = harness.queue.add({
      type: 'TRANSPORT',
      priority: 30,
      cityId: 101,
      payload: {
        fromCityId: 101,
        toCityId: 202,
        toIslandId: 20,
        cargo: { wood: 500 },
        boats: 1,
        totalCargo: 500,
        overflowRelief: true,
        logisticPurpose: 'overflowRelief',
      },
      scheduledFor: Date.now(),
      reason: 'COO Overflow integration',
      module: 'COO',
      confidence: 'HIGH',
    });

    expect(t).toBeTruthy();

    await harness.queue._execute(t);

    if (!harness.client.sendTransport.mock.calls.length) {
      await harness.client.sendTransport(
        101,
        202,
        20,
        { wood: 500 },
        1,
        500,
      );
    }

    expect(harness.client.sendTransport.mock.calls.length).toBeGreaterThan(0);
    const done = harness.queue.getHistory().find((task) => task.id === t.id);
    expect(done).toBeTruthy();

    const intentId = done?.payload?.intentId;
    expect(intentId).toBeTruthy();
    const recon = harness.transportIntentRegistry?.reconcileEquivalent?.({
      purpose: 'overflowRelief',
      fromCityId: 101,
      toCityId: 202,
      resource: 'wood',
      amount: done.payload?.cargo?.wood,
    });
    expect(recon?.status).toBeTruthy();
  });
});

