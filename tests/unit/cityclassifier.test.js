import { CITY_ROLE, classifyCities } from '../../modules/CityClassifier.js';

describe('CityClassifier', () => {
  test('classifies producer role, deficits, overflow by timeToCap and build focus', () => {
    const city = {
      id: 101,
      tradegood: 2, // marble
      maxResources: 10_000,
      resources: {
        wood: 8_500,
        wine: 300,
        marble: 200,
        glass: 100,
        sulfur: 100,
      },
      production: {
        wood: 2_000,
        tradegood: 1_800,
      },
    };

    const result = classifyCities([city], {
      hubCityId: 101,
      minStockFraction: 0.2,
      overflowThresholdPct: 0.95,
      overflowTimeToCapHours: 2,
      buildFocusCityIds: new Set([101]),
      inTransitByCity: new Map([[101, { wood: 0, wine: 1800, marble: 0, glass: 0, sulfur: 0 }]]),
    })[0];

    expect(result.cityId).toBe(101);
    expect(result.islandResource).toBe('marble');
    expect(result.tradegood).toBe(2);
    expect(result.productionPerHour.wood).toBe(2000);
    expect(result.productionPerHour.marble).toBe(1800);
    expect(result.overflowFlags.wood).toBe(true); // 8500 + 2000/h => cap in 0.75h
    expect(result.deficitFlags.wine).toBe(false); // onHand+inTransit >= min target

    expect(result.roles).toContain(CITY_ROLE.PRODUCER_MARBLE);
    expect(result.roles).toContain(CITY_ROLE.HUB);
    expect(result.roles).toContain(CITY_ROLE.OVERFLOW);
    expect(result.roles).toContain(CITY_ROLE.BUILD_FOCUS);
  });
});

