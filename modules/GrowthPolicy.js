// GrowthPolicy.js — política explícita de crescimento para conta nova/early game

import { GLOBAL_GOAL } from './GoalEngine.js';

export const GROWTH_STAGE = Object.freeze({
    BOOTSTRAP_CITY: 'BOOTSTRAP_CITY',
    STABILIZE_CITY: 'STABILIZE_CITY',
    THROUGHPUT_GROWTH: 'THROUGHPUT_GROWTH',
    PREPARE_EXPANSION: 'PREPARE_EXPANSION',
    CONSOLIDATE_NEW_CITY: 'CONSOLIDATE_NEW_CITY',
});

function _num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function _computeTelemetry({ cities = [], cityContexts = null, stageMetrics = {}, readiness = {} } = {}) {
    const cityCount = stageMetrics.cityCount ?? cities.length;
    const totalPopulation = stageMetrics.totalPopulation ?? cities.reduce(
        (sum, c) => sum + _num(c?.economy?.population, _num(c?.economy?.citizens, 0)),
        0,
    );
    const totalGoldPerHour = stageMetrics.totalGoldPerHour ?? cities.reduce(
        (sum, c) => sum + _num(c?.economy?.goldPerHour, 0),
        0,
    );
    const totalProductionPerHour = stageMetrics.totalProductionPerHour ?? cities.reduce((sum, c) => {
        const wood = _num(c?.production?.wood, 0);
        const tradegood = _num(c?.production?.tradegood, 0);
        return sum + wood + tradegood;
    }, 0);

    const satisfactions = cities
        .map((c) => c?.economy?.satisfaction)
        .filter((s) => Number.isFinite(Number(s)))
        .map((s) => Number(s));
    const happinessAvg = satisfactions.length
        ? satisfactions.reduce((sum, s) => sum + s, 0) / satisfactions.length
        : 0;
    const happinessCriticalCities = satisfactions.filter((s) => s <= 0).length;

    const wineHoursList = cityContexts instanceof Map
        ? [...cityContexts.values()]
            .map((ctx) => Number(ctx?.wineHours))
            .filter((v) => Number.isFinite(v) && v >= 0)
        : [];
    const wineCoverageHoursMin = wineHoursList.length ? Math.min(...wineHoursList) : Infinity;
    const wineCoverageHoursAvg = wineHoursList.length
        ? wineHoursList.reduce((sum, h) => sum + h, 0) / wineHoursList.length
        : Infinity;

    const storagePressureAvg = stageMetrics.storagePressureAvg ?? 0;
    const storagePressureHighCities = stageMetrics.storagePressureHighCities ?? 0;

    const readinessBlockingFactors = Array.isArray(readiness?.blockingFactors)
        ? readiness.blockingFactors
        : [];
    const readinessReasons = Array.isArray(readiness?.reasons)
        ? readiness.reasons
        : [];

    const pendingTransportCoverage = cityContexts instanceof Map && cityCount > 0
        ? [...cityContexts.values()].filter((ctx) => (ctx?.pendingTransports?.length ?? 0) > 0).length / cityCount
        : 0;
    const logisticsRisk = readinessBlockingFactors.some((f) => /logistics|transport/i.test(String(f)))
        || (cityCount >= 2 && pendingTransportCoverage < 0.20);

    return {
        cityCount,
        totalPopulation,
        totalGoldPerHour,
        totalProductionPerHour,
        happinessAvg: Number(happinessAvg.toFixed(2)),
        happinessCriticalCities,
        wineCoverageHoursMin: Number.isFinite(wineCoverageHoursMin) ? Number(wineCoverageHoursMin.toFixed(2)) : Infinity,
        wineCoverageHoursAvg: Number.isFinite(wineCoverageHoursAvg) ? Number(wineCoverageHoursAvg.toFixed(2)) : Infinity,
        storagePressureAvg: Number(storagePressureAvg.toFixed(3)),
        storagePressureHighCities,
        pendingTransportCoverage: Number(pendingTransportCoverage.toFixed(3)),
        logisticsRisk,
        empireReadiness: Number(_num(readiness?.empireReadiness, 0).toFixed(2)),
        cityReadiness: Number(_num(readiness?.cityReadiness, 0).toFixed(2)),
        expansionReady: Boolean(readiness?.expansionReady),
        consolidationNeeded: Boolean(readiness?.consolidationNeeded),
        readinessReasons,
        readinessBlockingFactors,
    };
}

function _finalize(stage, nextMilestone, reasons, blocking, buildCluster, resourceFocus, telemetry) {
    return {
        growthStage: stage,
        nextMilestone,
        milestoneReasons: reasons,
        milestoneBlockingFactors: blocking,
        recommendedBuildCluster: buildCluster,
        recommendedResourceFocus: resourceFocus,
        telemetry,
    };
}

export function evaluateGrowthPolicy({
    stage = null,
    globalGoal = null,
    readiness = {},
    cities = [],
    cityContexts = null,
    stageMetrics = {},
} = {}) {
    const t = _computeTelemetry({ cities, cityContexts, stageMetrics, readiness });

    const reasons = [];
    const blocking = [];

    if (t.cityCount >= 2 && (t.consolidationNeeded || globalGoal === GLOBAL_GOAL.CONSOLIDATE_NEW_CITY)) {
        reasons.push('multi_city_empire_requires_new_city_stabilization');
        if (t.logisticsRisk) blocking.push('logistics_coverage_insufficient_for_multi_city');
        if (t.happinessCriticalCities > 0 || t.wineCoverageHoursMin < 6) {
            blocking.push('new_city_supply_stability_gap');
        }
        return _finalize(
            GROWTH_STAGE.CONSOLIDATE_NEW_CITY,
            'NEW_CITY_BASELINE_STABILITY',
            reasons,
            blocking,
            'NEW_CITY_SUSTAINMENT',
            'SUPPLY_STABILITY',
            t,
        );
    }

    if (t.cityCount <= 1 && (t.expansionReady || globalGoal === GLOBAL_GOAL.PREPARE_EXPANSION)) {
        reasons.push('single_city_ready_or_aligned_for_safe_expansion');
        if (t.totalGoldPerHour < 120) blocking.push('gold_per_hour_buffer_below_safe_expansion_floor');
        if (t.storagePressureAvg > 0.88) blocking.push('storage_pressure_too_high_for_expansion_buffering');
        if (t.logisticsRisk) blocking.push('logistics_not_ready_for_expansion_jit');
        return _finalize(
            GROWTH_STAGE.PREPARE_EXPANSION,
            'SAFE_EXPANSION_EXECUTION',
            reasons,
            blocking,
            'EXPANSION_ENABLEMENT',
            'EXPANSION_STOCKPILE',
            t,
        );
    }

    const severeBootstrap = t.cityCount <= 1 && (
        t.totalPopulation < 320
        || t.totalProductionPerHour < 850
        || t.totalGoldPerHour < 20
        || t.happinessAvg < 1.5
        || t.wineCoverageHoursMin < 4
    );
    if (severeBootstrap) {
        reasons.push('new_account_survival_baseline_not_reached');
        if (t.happinessAvg < 2) blocking.push('happiness_below_bootstrap_target');
        if (t.wineCoverageHoursMin < 6) blocking.push('wine_coverage_below_bootstrap_target');
        if (t.totalGoldPerHour < 40) blocking.push('gold_per_hour_below_bootstrap_target');
        if (t.storagePressureAvg > 0.9) blocking.push('storage_pressure_blocks_bootstrap_flow');
        return _finalize(
            GROWTH_STAGE.BOOTSTRAP_CITY,
            'CITY_STABLE_BASELINE',
            reasons,
            blocking,
            'SURVIVAL_CORE',
            'WINE_AND_GOLD_STABILITY',
            t,
        );
    }

    const stillStabilizing = t.cityCount <= 1 && (
        t.happinessAvg < 3
        || t.wineCoverageHoursAvg < 10
        || t.totalGoldPerHour < 100
        || t.storagePressureAvg > 0.82
    );
    if (stillStabilizing) {
        reasons.push('single_city_needs_stability_before_growth_acceleration');
        if (t.happinessAvg < 3) blocking.push('happiness_below_stability_band');
        if (t.totalGoldPerHour < 100) blocking.push('cashflow_not_stable_for_growth_push');
        if (t.storagePressureAvg > 0.82) blocking.push('storage_pressure_limits_growth_cycle');
        return _finalize(
            GROWTH_STAGE.STABILIZE_CITY,
            'SUSTAINED_POSITIVE_FLOW',
            reasons,
            blocking,
            'STABILITY_CORE',
            'THROUGHPUT_WITHOUT_OVERFLOW',
            t,
        );
    }

    reasons.push('baseline_stable_prioritize_throughput_and_flow_efficiency');
    if (t.storagePressureAvg > 0.86) blocking.push('storage_pressure_must_be_reduced_for_throughput');
    if (t.totalGoldPerHour < 140) blocking.push('cashflow_buffer_below_throughput_target');
    if (_num(t.empireReadiness, 0) < 0.75 && stage === 'PRE_EXPANSION') {
        blocking.push('expansion_readiness_gate_not_reached');
    }

    return _finalize(
        GROWTH_STAGE.THROUGHPUT_GROWTH,
        'EXPANSION_READINESS_GATE',
        reasons,
        blocking,
        'THROUGHPUT_CORE',
        'WOOD_MARBLE_FLOW',
        t,
    );
}

