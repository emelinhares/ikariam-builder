import { evaluateWorkforcePolicy } from '../../modules/WorkforcePolicy.js';

describe('WorkforcePolicy', () => {
  test('recommends explicit allocation when idle population exists and production is below floor', () => {
    const cities = [{
      id: 1,
      name: 'Capital',
      tradegood: 2, // marble
      workers: { wood: 10, tradegood: 8, scientists: 2, priests: 0 },
      economy: { population: 120, citizens: 100, satisfaction: 4, goldPerHour: 180 },
      production: { wood: 90, tradegood: 40 },
      buildings: [{ building: 'academy', level: 8 }],
    }];

    const cityContexts = new Map([[1, { wineHours: 12, pendingTransports: [] }]]);

    const result = evaluateWorkforcePolicy({
      cities,
      cityContexts,
      stage: 'BOOTSTRAP',
      globalGoal: 'UNBLOCK_PRODUCTION',
      growthStage: 'STABILIZE_CITY',
      readiness: { empireReadiness: 0.55 },
    });

    const signal = result.perCity.get(1);

    expect(signal.idlePopulation).toBeGreaterThan(0);
    expect(signal.productionFloorMet).toBe(false);
    expect(signal.workforceBlockingFactors).toHaveLength(0);
    expect(signal.recommendedWorkersWood).toBeGreaterThan(cities[0].workers.wood);
    expect(signal.recommendedWorkersTradegood).toBeGreaterThan(cities[0].workers.tradegood);
    expect(signal.recommendedScientists).toBeGreaterThanOrEqual(cities[0].workers.scientists);
    expect(signal.workforceReasons).toEqual(expect.arrayContaining([
      'idle_population_detected_with_production_below_floor_reallocation_recommended',
    ]));
  });

  test('emits explicit blocking factor when city stays idle without safe allocation path', () => {
    const cities = [{
      id: 2,
      name: 'Blocked',
      tradegood: 4,
      workers: { wood: 0, tradegood: 0, scientists: 0, priests: 0 },
      economy: { population: 80, citizens: 60, satisfaction: -1, goldPerHour: -250 },
      production: { wood: 10, tradegood: 5 },
      buildings: [],
    }];
    const cityContexts = new Map([[2, { wineHours: 1.2, pendingTransports: [] }]]);

    const result = evaluateWorkforcePolicy({
      cities,
      cityContexts,
      stage: 'THROUGHPUT_GROWTH',
      globalGoal: 'SURVIVE',
      growthStage: 'THROUGHPUT_GROWTH',
      readiness: { empireReadiness: 0.4 },
    });

    const signal = result.perCity.get(2);

    expect(signal.idlePopulation).toBeGreaterThan(0);
    expect(signal.productionFloorMet).toBe(false);
    expect(signal.workforceBlockingFactors).toEqual(expect.arrayContaining([
      'happiness_below_zero_blocks_safe_workforce_push',
      'wine_coverage_critical_blocks_workforce_push',
      'gold_flow_too_negative_for_workforce_expansion',
      'idle_population_unresolved_due_to_blocking_factors',
    ]));
    expect(result.blockingFactors).toEqual(expect.arrayContaining([
      'workforce_idle_population_unresolved_cities:1',
    ]));
  });
});

