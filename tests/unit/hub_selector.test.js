import { identifyHub, buildCityClassification } from '../../modules/HubSelector.js';
import { CITY_ROLE } from '../../modules/CityClassifier.js';

describe('HubSelector', () => {
  test('identifyHub favors warehouse + centrality score', () => {
    const cities = [
      {
        id: 1,
        name: 'EdgeSmall',
        coords: [0, 0],
        buildings: [{ building: 'warehouse', level: 2 }],
      },
      {
        id: 2,
        name: 'CentralBig',
        coords: [50, 50],
        buildings: [{ building: 'warehouse', level: 8 }],
      },
      {
        id: 3,
        name: 'EdgeBig',
        coords: [100, 100],
        buildings: [{ building: 'warehouse', level: 7 }],
      },
    ];

    const hub = identifyHub(cities);
    expect(hub.id).toBe(2);
  });

  test('buildCityClassification returns map keyed by cityId', () => {
    const cities = [
      {
        id: 101,
        maxResources: 10_000,
        resources: { wood: 7000, wine: 200, marble: 300, glass: 100, sulfur: 50 },
        production: { wood: 300, tradegood: 200 },
        tradegood: 2,
      },
      {
        id: 202,
        maxResources: 10_000,
        resources: { wood: 1000, wine: 100, marble: 50, glass: 50, sulfur: 20 },
        production: { wood: 100, tradegood: 100 },
        tradegood: 1,
      },
    ];

    const byCity = buildCityClassification({
      cities,
      queuePending: [{ type: 'BUILD', cityId: 202 }],
      getInTransit: () => ({ wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 }),
      config: { minStockFraction: 0.2, overflowThresholdPct: 0.95, overflowTimeToCapHours: 2 },
      hubCityId: 101,
    });

    expect(byCity).toBeInstanceOf(Map);
    expect(byCity.has(101)).toBe(true);
    expect(byCity.has(202)).toBe(true);
    expect(byCity.get(202).roles).toContain(CITY_ROLE.BUILD_FOCUS);
  });
});

