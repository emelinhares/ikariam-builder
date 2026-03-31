import { detectEmpireStage } from '../../modules/EmpireStage.js';
import { chooseGlobalGoal } from '../../modules/GoalEngine.js';
import { evaluateExpansionReadiness } from '../../modules/ExpansionReadiness.js';

describe('Empire strategic maturity', () => {
  test('detects PRE_EXPANSION for single mature city ready to expand', () => {
    const cities = [{
      id: 1,
      maxResources: 10_000,
      resources: { wood: 3000, wine: 1500, marble: 900, glass: 800, sulfur: 700 },
      production: { wood: 1400, tradegood: 800 },
      economy: { population: 900, goldPerHour: 300 },
      buildings: [
        { building: 'townHall', level: 8 },
        { building: 'warehouse', level: 8 },
        { building: 'tavern', level: 3 },
        { building: 'academy', level: 6 },
      ],
    }];

    const ctx = new Map([[1, { hasCriticalSupply: false }]]);

    const stageInfo = detectEmpireStage({ cities, cityContexts: ctx });

    expect(stageInfo.stage).toBe('PRE_EXPANSION');
    expect(stageInfo.metrics.expansionReadiness).toBeGreaterThanOrEqual(0.7);
    expect(stageInfo.metrics.expansionReady).toBe(true);
    expect(Array.isArray(stageInfo.metrics.readinessReasons)).toBe(true);
    expect(Array.isArray(stageInfo.metrics.readinessBlockingFactors)).toBe(true);
  });

  test('maps stage + telemetry to CONSOLIDATE_NEW_CITY on MULTI_CITY_EARLY', () => {
    const goal = chooseGlobalGoal({
      stage: 'MULTI_CITY_EARLY',
      stageMetrics: {
        cityCount: 2,
        criticalSupplyCities: 0,
        lowSatisfactionCities: 0,
        totalGoldPerHour: 200,
        totalProductionPerHour: 2200,
        storagePressureAvg: 0.45,
        storagePressureHighCities: 0,
        expansionReadiness: 0.5,
        underDevelopedCities: 1,
        consolidationNeeded: true,
        readinessBlockingFactors: ['empire_logistics_coverage_low:1/2'],
      },
      cities: [],
      cityContexts: new Map(),
    });

    expect(goal.goal).toBe('CONSOLIDATE_NEW_CITY');
    expect(goal.reason).toContain('multi_city_early_needs_consolidation');
  });

  test('distinguishes wants to expand vs can expand in PRE_EXPANSION', () => {
    const goal = chooseGlobalGoal({
      stage: 'PRE_EXPANSION',
      stageMetrics: {
        cityCount: 1,
        criticalSupplyCities: 0,
        totalGoldPerHour: 280,
        expansionReadiness: 0.9,
        expansionReady: false,
        readinessBlockingFactors: ['empire_storage_pressure_high:avg=0.93 highCities=1'],
      },
      cities: [],
      cityContexts: new Map(),
    });

    expect(goal.goal).toBe('UNBLOCK_PRODUCTION');
    expect(goal.reason).toContain('pre_expansion_not_ready');
  });

  test('computes objective readiness outputs for empire and city levels', () => {
    const cities = [
      {
        id: 1,
        maxResources: 12000,
        resources: { wood: 3000, wine: 1200, marble: 800, glass: 700, sulfur: 600 },
        production: { wood: 900, tradegood: 350, wineSpendings: 40 },
        economy: { population: 800, satisfaction: 5, goldPerHour: 220 },
        buildings: [
          { building: 'townHall', level: 8 },
          { building: 'warehouse', level: 7 },
          { building: 'port', level: 3 },
        ],
      },
    ];

    const cityContexts = new Map([[1, { hasCriticalSupply: false, pendingTransports: [] }]]);
    const readiness = evaluateExpansionReadiness({
      cities,
      cityContexts,
      stage: 'PRE_EXPANSION',
      globalGoal: 'PREPARE_EXPANSION',
    });

    expect(readiness.cityReadiness).toBeGreaterThan(0);
    expect(readiness.empireReadiness).toBeGreaterThan(0);
    expect(typeof readiness.expansionReady).toBe('boolean');
    expect(typeof readiness.consolidationNeeded).toBe('boolean');
    expect(Array.isArray(readiness.reasons)).toBe(true);
    expect(Array.isArray(readiness.blockingFactors)).toBe(true);
    expect(readiness.cityReadinessByCityId[1]).toBeTruthy();
  });

  test('gates expansion optimism when fleet is blocked during PREPARE_EXPANSION', () => {
    const cities = [{
      id: 1,
      maxResources: 12_000,
      resources: { wood: 3500, wine: 1200, marble: 900, glass: 800, sulfur: 700 },
      production: { wood: 1100, tradegood: 850, wineSpendings: 40 },
      economy: { population: 900, satisfaction: 5, goldPerHour: 260 },
      buildings: [
        { building: 'townHall', level: 8 },
        { building: 'warehouse', level: 8 },
        { building: 'port', level: 3 },
      ],
    }];

    const cityContexts = new Map([[1, { hasCriticalSupply: false, pendingTransports: [] }]]);
    const readiness = evaluateExpansionReadiness({
      cities,
      cityContexts,
      stage: 'PRE_EXPANSION',
      globalGoal: 'PREPARE_EXPANSION',
      fleetPolicy: {
        fleetReadiness: 0.32,
        blockedByFleet: true,
        freeCargoShips: 0,
        totalCargoShips: 2,
        recommendedCargoShipsToBuy: 4,
        fleetBlockingFactors: ['fleet_recent_guard_no_free_boats:3'],
        fleetReasons: [],
      },
    });

    expect(readiness.expansionReady).toBe(false);
    expect(readiness.blockingFactors.join('|')).toContain('fleet_recent_guard_no_free_boats');
    expect(readiness.telemetry.blockedByFleet).toBe(true);
    expect(readiness.telemetry.recommendedCargoShipsToBuy).toBe(4);
  });

  test('forces SURVIVE when critical supply is present regardless of stage', () => {
    const goal = chooseGlobalGoal({
      stage: 'SPECIALIZATION',
      stageMetrics: {
        cityCount: 4,
        criticalSupplyCities: 1,
        totalGoldPerHour: 900,
      },
      cities: [],
      cityContexts: new Map(),
    });

    expect(goal.goal).toBe('SURVIVE');
    expect(goal.reason).toBe('critical_supply_or_cashflow_pressure');
  });
});

