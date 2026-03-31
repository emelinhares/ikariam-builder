// FleetPolicy.js — política explícita de capacidade naval/logística

import { TASK_TYPE } from './taskTypes.js';

function _num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function _countNoFreeBoatsOutcomes(queueHistory = []) {
    const recent = [...(Array.isArray(queueHistory) ? queueHistory : [])].slice(-35);
    let hits = 0;
    for (const task of recent) {
        if (task?.type !== TASK_TYPE.TRANSPORT) continue;
        const codes = [
            task?.lastOutcome?.reasonCode,
            task?.lastBlockerCode,
            task?.reasonCode,
            ...(Array.isArray(task?.outcomeHistory)
                ? task.outcomeHistory.map((o) => o?.reasonCode)
                : []),
        ].filter(Boolean);
        if (codes.includes('GUARD_TRANSPORT_NO_FREE_BOATS')) hits += 1;
    }
    return hits;
}

export function evaluateFleetPolicy({
    stage = null,
    globalGoal = null,
    growthStage = null,
    empireReadiness = 0,
    cities = [],
    cityContexts = null,
    stageMetrics = {},
    queuePending = [],
    queueHistory = [],
} = {}) {
    const cityCount = Math.max(0, stageMetrics.cityCount ?? cities.length);
    const totalCargoShips = cities.reduce((sum, city) => sum + _num(city?.maxTransporters, 0), 0);
    const freeCargoShips = cities.reduce((sum, city) => sum + _num(city?.freeTransporters, 0), 0);

    const pendingTransports = (Array.isArray(queuePending) ? queuePending : [])
        .filter((t) => t?.type === TASK_TYPE.TRANSPORT)
        .length;

    const jitBuildPressure = (Array.isArray(queuePending) ? queuePending : [])
        .filter((t) => t?.type === TASK_TYPE.TRANSPORT && t?.payload?.jitBuild)
        .length;
    const minStockPressure = (Array.isArray(queuePending) ? queuePending : [])
        .filter((t) => t?.type === TASK_TYPE.TRANSPORT && t?.payload?.minStock)
        .length;
    const overflowPressure = (Array.isArray(queuePending) ? queuePending : [])
        .filter((t) => t?.type === TASK_TYPE.TRANSPORT && t?.payload?.overflowRelief)
        .length;

    const pendingTransportsByCityCtx = cityContexts instanceof Map
        ? [...cityContexts.values()].reduce((sum, c) => sum + (Array.isArray(c?.pendingTransports) ? c.pendingTransports.length : 0), 0)
        : 0;

    const guardNoFreeBoatsRecent = _countNoFreeBoatsOutcomes(queueHistory);
    const logisticsPressureRaw =
        (pendingTransports + pendingTransportsByCityCtx) * 0.12
        + jitBuildPressure * 0.25
        + minStockPressure * 0.18
        + overflowPressure * 0.22
        + Math.max(0, _num(stageMetrics.storagePressureHighCities, 0)) * 0.15;
    const logisticsPressure = Math.min(1, Number(logisticsPressureRaw.toFixed(3)));

    const totalGoldPerHour = _num(stageMetrics.totalGoldPerHour,
        cities.reduce((sum, c) => sum + _num(c?.economy?.goldPerHour, 0), 0));
    const availableGold = cities.reduce((sum, c) => sum + _num(c?.economy?.gold, 0), 0);
    const capitalAtRisk = _num(stageMetrics.capitalAtRisk, 0);

    const baseTarget = Math.max(2, cityCount * 2 + Math.ceil((pendingTransports + jitBuildPressure) / 4));
    let targetCargoShips = baseTarget;
    if (stage === 'PRE_EXPANSION' || globalGoal === 'PREPARE_EXPANSION' || growthStage === 'PREPARE_EXPANSION') {
        targetCargoShips = Math.max(targetCargoShips, cityCount * 3 + 2);
    }
    if (growthStage === 'CONSOLIDATE_NEW_CITY') {
        targetCargoShips = Math.max(targetCargoShips, cityCount * 3);
    }

    const freeShipTarget = Math.max(1, Math.min(6, Math.ceil((pendingTransports + jitBuildPressure * 2) / 2)));
    const recurringNoBoats = guardNoFreeBoatsRecent >= 2;

    const fleetBlockingFactors = [];
    const fleetReasons = [];

    if (totalCargoShips < targetCargoShips) {
        fleetBlockingFactors.push(`fleet_capacity_below_target:${totalCargoShips}<${targetCargoShips}`);
    } else {
        fleetReasons.push(`fleet_capacity_target_ok:${totalCargoShips}/${targetCargoShips}`);
    }

    if (freeCargoShips < freeShipTarget) {
        fleetBlockingFactors.push(`fleet_free_ships_low:${freeCargoShips}<${freeShipTarget}`);
    } else {
        fleetReasons.push(`fleet_free_ships_ok:${freeCargoShips}/${freeShipTarget}`);
    }

    if (recurringNoBoats) {
        fleetBlockingFactors.push(`fleet_recent_guard_no_free_boats:${guardNoFreeBoatsRecent}`);
    } else {
        fleetReasons.push(`fleet_no_recent_no_free_boats_guard:${guardNoFreeBoatsRecent}`);
    }

    if (logisticsPressure >= 0.6) {
        fleetBlockingFactors.push(`fleet_logistics_pressure_high:${logisticsPressure.toFixed(2)}`);
    } else {
        fleetReasons.push(`fleet_logistics_pressure_ok:${logisticsPressure.toFixed(2)}`);
    }

    const capacityRatio = totalCargoShips > 0 ? Math.min(1, totalCargoShips / Math.max(targetCargoShips, 1)) : 0;
    const freeRatio = Math.min(1, freeCargoShips / Math.max(freeShipTarget, 1));
    const noBoatsPenalty = Math.min(0.5, guardNoFreeBoatsRecent * 0.1);
    const pressurePenalty = Math.min(0.35, logisticsPressure * 0.35);
    const readinessBase = 0.55 * capacityRatio + 0.30 * freeRatio + 0.15 * Math.max(0, _num(empireReadiness, 0));
    const fleetReadiness = Number(Math.max(0, Math.min(1, readinessBase - noBoatsPenalty - pressurePenalty)).toFixed(2));

    const blockedByFleet =
        fleetReadiness < 0.6
        || recurringNoBoats
        || totalCargoShips < targetCargoShips
        || freeCargoShips < freeShipTarget;

    const goldBuffer = Math.max(25_000, cityCount * 12_000);
    const surplusGold = Math.max(0, availableGold - goldBuffer);
    const shipCostEstimate = 1_000;
    let recommendedCargoShipsToBuy = 0;
    if (blockedByFleet) {
        const hardDeficit = Math.max(0, targetCargoShips - totalCargoShips);
        const urgencyShips = recurringNoBoats ? 1 : 0;
        const capRiskBoost = capitalAtRisk >= 60_000 ? 1 : 0;
        const affordableByCapital = Math.floor(surplusGold / shipCostEstimate);
        const affordableByCashflow = totalGoldPerHour >= 400 ? 2 : totalGoldPerHour >= 200 ? 1 : 0;
        recommendedCargoShipsToBuy = Math.max(0, Math.min(
            Math.max(hardDeficit + urgencyShips + capRiskBoost, 0),
            Math.max(affordableByCapital, affordableByCashflow),
        ));
    }

    if (recommendedCargoShipsToBuy > 0) {
        fleetReasons.push(`fleet_buy_recommended:${recommendedCargoShipsToBuy}`);
    }

    return {
        fleetReadiness,
        freeCargoShips,
        totalCargoShips,
        blockedByFleet,
        recommendedCargoShipsToBuy,
        fleetBlockingFactors,
        fleetReasons,
        telemetry: {
            stage,
            globalGoal,
            growthStage,
            targetCargoShips,
            freeShipTarget,
            pendingTransports,
            pendingTransportsByCityCtx,
            guardNoFreeBoatsRecent,
            logisticsPressure,
            totalGoldPerHour,
            availableGold,
            goldBuffer,
            surplusGold,
            capitalAtRisk,
        },
    };
}

