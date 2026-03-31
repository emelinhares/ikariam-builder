// GoalEngine.js — objetivo global por ciclo com base no estágio e telemetria

import { EMPIRE_STAGE } from './EmpireStage.js';

const GOALS = Object.freeze({
    SURVIVE: 'SURVIVE',
    GROW_POPULATION: 'GROW_POPULATION',
    UNBLOCK_PRODUCTION: 'UNBLOCK_PRODUCTION',
    REDUCE_OVERFLOW: 'REDUCE_OVERFLOW',
    PREPARE_EXPANSION: 'PREPARE_EXPANSION',
    CONSOLIDATE_NEW_CITY: 'CONSOLIDATE_NEW_CITY',
    PREPARE_MILITARY: 'PREPARE_MILITARY',
});

function _num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function _computeTelemetry({ cities = [], cityContexts = null, stageMetrics = {} } = {}) {
    const cityCount = stageMetrics.cityCount ?? cities.length;

    const criticalSupplyCities = stageMetrics.criticalSupplyCities ?? (
        cityContexts instanceof Map
            ? [...cityContexts.values()].filter((c) => c?.hasCriticalSupply).length
            : 0
    );

    const lowSatisfactionCities = cityContexts instanceof Map
        ? [...cityContexts.values()].filter((c) => c?.satisfaction !== null && c?.satisfaction <= 0).length
        : 0;

    const totalGoldPerHour = stageMetrics.totalGoldPerHour ?? cities.reduce(
        (sum, c) => sum + _num(c?.economy?.goldPerHour, 0),
        0,
    );

    const totalProductionPerHour = stageMetrics.totalProductionPerHour ?? cities.reduce((sum, c) => {
        const wood = _num(c?.production?.wood, 0);
        const tradegood = _num(c?.production?.tradegood, 0);
        return sum + wood + tradegood;
    }, 0);

    const storagePressureAvg = stageMetrics.storagePressureAvg ?? 0;
    const storagePressureHighCities = stageMetrics.storagePressureHighCities ?? 0;
    const expansionReadiness = stageMetrics.expansionReadiness ?? 0;
    const underDevelopedCities = stageMetrics.underDevelopedCities ?? 0;
    const expansionReady = stageMetrics.expansionReady ?? (expansionReadiness >= 0.85);
    const consolidationNeeded = stageMetrics.consolidationNeeded ?? false;
    const readinessReasons = Array.isArray(stageMetrics.readinessReasons) ? stageMetrics.readinessReasons : [];
    const readinessBlockingFactors = Array.isArray(stageMetrics.readinessBlockingFactors) ? stageMetrics.readinessBlockingFactors : [];
    const fleetReadiness = _num(stageMetrics.fleetReadiness, 1);
    const fleetBlocked = Boolean(stageMetrics.fleetBlocked);
    const recommendedCargoShipsToBuy = _num(stageMetrics.recommendedCargoShipsToBuy, 0);

    return {
        cityCount,
        criticalSupplyCities,
        lowSatisfactionCities,
        totalGoldPerHour,
        totalProductionPerHour,
        storagePressureAvg,
        storagePressureHighCities,
        expansionReadiness,
        underDevelopedCities,
        expansionReady,
        consolidationNeeded,
        readinessReasons,
        readinessBlockingFactors,
        fleetReadiness,
        fleetBlocked,
        recommendedCargoShipsToBuy,
    };
}

export function chooseGlobalGoal({ stage, stageMetrics = {}, cities = [], cityContexts = null } = {}) {
    const t = _computeTelemetry({ cities, cityContexts, stageMetrics });

    // Regras globais de sobrevivência têm precedência sobre qualquer estágio.
    if (t.criticalSupplyCities > 0 || t.lowSatisfactionCities > 0 || t.totalGoldPerHour < -150) {
        return {
            goal: GOALS.SURVIVE,
            reason: 'critical_supply_or_cashflow_pressure',
            telemetry: t,
        };
    }

    if (t.storagePressureHighCities > 0 || t.storagePressureAvg >= 0.9) {
        return {
            goal: GOALS.REDUCE_OVERFLOW,
            reason: 'storage_pressure_high',
            telemetry: t,
        };
    }

    switch (stage) {
        case EMPIRE_STAGE.BOOTSTRAP:
            return {
                goal: t.totalProductionPerHour < 900 ? GOALS.UNBLOCK_PRODUCTION : GOALS.GROW_POPULATION,
                reason: 'bootstrap_prioritizes_survival_population_production',
                telemetry: t,
            };

        case EMPIRE_STAGE.EARLY_GROWTH:
            return {
                goal: t.totalProductionPerHour < 1800 ? GOALS.UNBLOCK_PRODUCTION : GOALS.GROW_POPULATION,
                reason: 'early_growth_prioritizes_population_and_production',
                telemetry: t,
            };

        case EMPIRE_STAGE.PRE_EXPANSION:
            return {
                goal: t.expansionReady ? GOALS.PREPARE_EXPANSION : GOALS.UNBLOCK_PRODUCTION,
                reason: t.expansionReady
                    ? 'pre_expansion_ready_for_expansion'
                    : `pre_expansion_not_ready:${t.readinessBlockingFactors.join('|') || 'insufficient_readiness'}`,
                telemetry: t,
            };

        case EMPIRE_STAGE.MULTI_CITY_EARLY:
            {
            const needsConsolidation = t.consolidationNeeded || t.underDevelopedCities > 0;
            return {
                goal: needsConsolidation ? GOALS.CONSOLIDATE_NEW_CITY : GOALS.PREPARE_EXPANSION,
                reason: needsConsolidation
                    ? `multi_city_early_needs_consolidation:${t.readinessBlockingFactors.join('|') || 'stability_gap'}`
                    : 'multi_city_early_ready_for_next_expansion',
                telemetry: t,
            };
            }

        case EMPIRE_STAGE.SPECIALIZATION:
            return {
                goal: t.underDevelopedCities > 0 ? GOALS.CONSOLIDATE_NEW_CITY : GOALS.UNBLOCK_PRODUCTION,
                reason: 'specialization_prioritizes_economic_efficiency',
                telemetry: t,
            };

        case EMPIRE_STAGE.MILITARY_PREP:
            return {
                goal: GOALS.PREPARE_MILITARY,
                reason: 'military_prep_prioritizes_useful_surplus_and_structure',
                telemetry: t,
            };

        default:
            return {
                goal: GOALS.GROW_POPULATION,
                reason: 'fallback_growth',
                telemetry: t,
            };
    }
}

export { GOALS as GLOBAL_GOAL };

