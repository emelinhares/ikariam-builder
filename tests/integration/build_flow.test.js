import { createIntegrationHarness } from './harness.js';

describe('Integration: build flow', () => {
  test('Planner -> CFO -> TaskQueue -> GameClient.upgradeBuilding -> probe -> done', async () => {
    const harness = await createIntegrationHarness({
      cities: [
        {
          id: 101,
          name: 'Alpha',
          tradegood: 2,
          islandId: 77,
          coords: [50, 50],
          resources: { wood: 50_000, wine: 2_000, marble: 50_000, glass: 50_000, sulfur: 50_000 },
          maxResources: 100_000,
          buildings: [{ position: 3, building: 'townHall', level: 0 }],
          economy: { goldPerHour: 500, satisfaction: 5 },
        },
      ],
      hooks: {
        onUpgradeBuilding: async (cityId, position, _view, _currentLevel, state) => {
          const city = state.cities.get(cityId);
          city.underConstruction = Number(position);
          const slot = city.buildings.find((b) => Number(b.position) === Number(position));
          if (slot) slot.isUpgrading = true;
        },
      },
    });

    harness.cfo.replan = vi.fn(() => {
      harness.queue.add({
        type: 'BUILD',
        priority: 10,
        cityId: 101,
        payload: {
          position: 3,
          building: 'townHall',
          buildingView: 'townHall',
          currentLevel: 0,
          cost: { wood: 1000 },
        },
        scheduledFor: Date.now(),
        module: 'CFO',
        confidence: 'HIGH',
      });
    });

    await harness.planner.runCycle(Date.now());
    expect(harness.cfo.replan).toHaveBeenCalled();

    const buildTask = harness.queue.getPending().find((t) => t.type === 'BUILD');
    expect(buildTask).toBeTruthy();

    await harness.queue._execute(buildTask);

    expect(harness.client.upgradeBuilding).toHaveBeenCalledTimes(1);
    expect(harness.client.probeCityData).toHaveBeenCalled();
    const done = harness.queue.getHistory().find((t) => t.id === buildTask.id);
    expect(done?.status).toBe('done');
  });
});

