import { evaluateGrowthPolicy } from '../../modules/GrowthPolicy.js';

describe('GrowthPolicy', () => {
  test('returns BOOTSTRAP_CITY with explicit milestone and blockers for new weak account', () => {
    const cities = [{
      id: 1,
      economy: { population: 180, goldPerHour: 10, satisfaction: 1 },
      production: { wood: 300, tradegood: 120 },
    }];
    const cityContexts = new Map([[1, { wineHours: 2.5, pendingTransports: [] }]]);

    const policy = evaluateGrowthPolicy({
      stage: 'BOOTSTRAP',
      globalGoal: 'GROW_POPULATION',
      readiness: { empireReadiness: 0.2, cityReadiness: 0.3, expansionReady: false, consolidationNeeded: false },
      stageMetrics: {
        cityCount: 1,
        storagePressureAvg: 0.91,
      },
      cities,
      cityContexts,
    });

    expect(policy.growthStage).toBe('BOOTSTRAP_CITY');
    expect(policy.nextMilestone).toBe('CITY_STABLE_BASELINE');
    expect(policy.recommendedBuildCluster).toBe('SURVIVAL_CORE');
    expect(policy.recommendedResourceFocus).toBe('WINE_AND_GOLD_STABILITY');
    expect(policy.milestoneBlockingFactors).toEqual(expect.arrayContaining([
      'happiness_below_bootstrap_target',
      'wine_coverage_below_bootstrap_target',
      'gold_per_hour_below_bootstrap_target',
    ]));
  });

  test('returns PREPARE_EXPANSION when ready/aligned and exposes logistics blockers', () => {
    const policy = evaluateGrowthPolicy({
      stage: 'PRE_EXPANSION',
      globalGoal: 'PREPARE_EXPANSION',
      readiness: {
        empireReadiness: 0.9,
        cityReadiness: 0.88,
        expansionReady: true,
        consolidationNeeded: false,
        blockingFactors: ['empire_logistics_coverage_low:0/1'],
      },
      stageMetrics: {
        cityCount: 1,
        totalGoldPerHour: 140,
        storagePressureAvg: 0.72,
      },
      cities: [{
        id: 1,
        economy: { population: 950, goldPerHour: 140, satisfaction: 4 },
        production: { wood: 1500, tradegood: 700 },
      }],
      cityContexts: new Map([[1, { wineHours: 18, pendingTransports: [] }]]),
    });

    expect(policy.growthStage).toBe('PREPARE_EXPANSION');
    expect(policy.nextMilestone).toBe('SAFE_EXPANSION_EXECUTION');
    expect(policy.recommendedBuildCluster).toBe('EXPANSION_ENABLEMENT');
    expect(policy.recommendedResourceFocus).toBe('EXPANSION_STOCKPILE');
    expect(policy.milestoneBlockingFactors).toEqual(expect.arrayContaining([
      'logistics_not_ready_for_expansion_jit',
    ]));
  });

  test('returns CONSOLIDATE_NEW_CITY in multi-city with consolidation pressure', () => {
    const policy = evaluateGrowthPolicy({
      stage: 'MULTI_CITY_EARLY',
      globalGoal: 'CONSOLIDATE_NEW_CITY',
      readiness: {
        empireReadiness: 0.58,
        cityReadiness: 0.62,
        expansionReady: false,
        consolidationNeeded: true,
      },
      stageMetrics: {
        cityCount: 2,
        storagePressureAvg: 0.66,
      },
      cities: [
        { id: 1, economy: { population: 700, goldPerHour: 130, satisfaction: 3 }, production: { wood: 900, tradegood: 300 } },
        { id: 2, economy: { population: 250, goldPerHour: 40, satisfaction: 1 }, production: { wood: 350, tradegood: 120 } },
      ],
      cityContexts: new Map([
        [1, { wineHours: 20, pendingTransports: [{}] }],
        [2, { wineHours: 4, pendingTransports: [] }],
      ]),
    });

    expect(policy.growthStage).toBe('CONSOLIDATE_NEW_CITY');
    expect(policy.nextMilestone).toBe('NEW_CITY_BASELINE_STABILITY');
    expect(policy.recommendedBuildCluster).toBe('NEW_CITY_SUSTAINMENT');
    expect(policy.recommendedResourceFocus).toBe('SUPPLY_STABILITY');
    expect(policy.milestoneBlockingFactors).toEqual(expect.arrayContaining([
      'new_city_supply_stability_gap',
    ]));
  });
});

