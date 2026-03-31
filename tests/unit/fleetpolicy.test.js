import { evaluateFleetPolicy } from '../../modules/FleetPolicy.js';

describe('FleetPolicy', () => {
  test('computes explicit fleet signals and blocks expansion when capacity is weak', () => {
    const cities = [
      {
        id: 1,
        maxTransporters: 4,
        freeTransporters: 0,
        economy: { goldPerHour: 350, gold: 90_000 },
      },
    ];

    const queuePending = [
      { type: 'TRANSPORT', payload: { jitBuild: true } },
      { type: 'TRANSPORT', payload: { minStock: true } },
      { type: 'TRANSPORT', payload: { overflowRelief: true } },
    ];

    const queueHistory = [
      {
        type: 'TRANSPORT',
        lastOutcome: { reasonCode: 'GUARD_TRANSPORT_NO_FREE_BOATS' },
        outcomeHistory: [{ reasonCode: 'GUARD_TRANSPORT_NO_FREE_BOATS' }],
      },
      {
        type: 'TRANSPORT',
        lastBlockerCode: 'GUARD_TRANSPORT_NO_FREE_BOATS',
      },
    ];

    const result = evaluateFleetPolicy({
      stage: 'PRE_EXPANSION',
      globalGoal: 'PREPARE_EXPANSION',
      growthStage: 'PREPARE_EXPANSION',
      empireReadiness: 0.82,
      cities,
      queuePending,
      queueHistory,
      stageMetrics: {
        cityCount: 1,
        storagePressureHighCities: 1,
        totalGoldPerHour: 350,
        capitalAtRisk: 75_000,
      },
    });

    expect(result.totalCargoShips).toBe(4);
    expect(result.freeCargoShips).toBe(0);
    expect(result.blockedByFleet).toBe(true);
    expect(result.fleetReadiness).toBeLessThan(0.6);
    expect(result.recommendedCargoShipsToBuy).toBeGreaterThan(0);
    expect(result.fleetBlockingFactors.join('|')).toContain('fleet_recent_guard_no_free_boats');
  });
});

