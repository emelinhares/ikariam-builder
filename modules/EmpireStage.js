// EmpireStage.js — detecção explícita do estágio estratégico do império

import { evaluateExpansionReadiness } from './ExpansionReadiness.js';

const STAGES = Object.freeze({
    BOOTSTRAP: 'BOOTSTRAP',
    EARLY_GROWTH: 'EARLY_GROWTH',
    PRE_EXPANSION: 'PRE_EXPANSION',
    MULTI_CITY_EARLY: 'MULTI_CITY_EARLY',
    SPECIALIZATION: 'SPECIALIZATION',
    MILITARY_PREP: 'MILITARY_PREP',
});

const RESOURCES = ['wood', 'wine', 'marble', 'glass', 'sulfur'];

function _num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function _buildingLevels(city) {
    const levels = {};
    for (const slot of city?.buildings ?? []) {
        if (!slot?.building) continue;
        levels[slot.building] = Math.max(_num(slot.level, 0), levels[slot.building] ?? 0);
    }
    return levels;
}

function _cityStoragePressure(city) {
    const maxRes = _num(city?.maxResources, 0);
    if (maxRes <= 0) return 0;
    let maxFill = 0;
    for (const res of RESOURCES) {
        const q = _num(city?.resources?.[res], 0);
        maxFill = Math.max(maxFill, q / maxRes);
    }
    return Math.max(0, Math.min(1, maxFill));
}

function _cityDevelopmentScore(city) {
    const levels = _buildingLevels(city);
    const vals = Object.values(levels);
    if (!vals.length) return 0;
    return vals.reduce((sum, lv) => sum + _num(lv, 0), 0) / vals.length;
}

function _infraScore(city) {
    const levels = _buildingLevels(city);
    const score = [
        levels.townHall >= 3,
        levels.warehouse >= 3,
        levels.tavern >= 1,
        levels.academy >= 1,
    ].filter(Boolean).length;
    return score / 4;
}

export function detectEmpireStage({ cities = [], cityContexts = null, fleetPolicy = null } = {}) {
    const cityCount = cities.length;
    const totalPopulation = cities.reduce(
        (sum, c) => sum + _num(c?.economy?.population, _num(c?.economy?.citizens, 0)),
        0,
    );
    const totalGoldPerHour = cities.reduce((sum, c) => sum + _num(c?.economy?.goldPerHour, 0), 0);
    const totalProductionPerHour = cities.reduce((sum, c) => {
        const wood = _num(c?.production?.wood, 0);
        const tradegood = _num(c?.production?.tradegood, 0);
        return sum + wood + tradegood;
    }, 0);

    const storagePressureAvg = cityCount
        ? cities.reduce((sum, c) => sum + _cityStoragePressure(c), 0) / cityCount
        : 0;
    const storagePressureHighCities = cities.filter((c) => _cityStoragePressure(c) >= 0.92).length;

    const infraScoreAvg = cityCount
        ? cities.reduce((sum, c) => sum + _infraScore(c), 0) / cityCount
        : 0;
    const hasInfrastructureMinimum = infraScoreAvg >= 0.6;

    const avgDevelopmentLevel = cityCount
        ? cities.reduce((sum, c) => sum + _cityDevelopmentScore(c), 0) / cityCount
        : 0;

    const underDevelopedCities = cities.filter((c) => _cityDevelopmentScore(c) < 3.5).length;
    const criticalSupplyCities = cityContexts instanceof Map
        ? [...cityContexts.values()].filter((ctx) => ctx?.hasCriticalSupply).length
        : 0;

    const readinessInfo = evaluateExpansionReadiness({
        cities,
        cityContexts,
        fleetPolicy,
    });
    const expansionReadiness = readinessInfo.empireReadiness;

    let stage = STAGES.BOOTSTRAP;

    if (
        cityCount >= 3 &&
        totalProductionPerHour >= 6500 &&
        totalGoldPerHour >= 700 &&
        avgDevelopmentLevel >= 9 &&
        hasInfrastructureMinimum
    ) {
        stage = STAGES.MILITARY_PREP;
    } else if (cityCount >= 4 && avgDevelopmentLevel >= 6) {
        stage = STAGES.SPECIALIZATION;
    } else if (cityCount >= 2) {
        stage = STAGES.MULTI_CITY_EARLY;
    } else if (cityCount === 1 && readinessInfo.expansionReady) {
        stage = STAGES.PRE_EXPANSION;
    } else if (
        cityCount === 1 &&
        totalPopulation >= 350 &&
        totalProductionPerHour >= 900 &&
        hasInfrastructureMinimum
    ) {
        stage = STAGES.EARLY_GROWTH;
    }

    return {
        stage,
        metrics: {
            cityCount,
            totalPopulation,
            totalProductionPerHour,
            totalGoldPerHour,
            storagePressureAvg,
            storagePressureHighCities,
            hasInfrastructureMinimum,
            avgDevelopmentLevel,
            underDevelopedCities,
            criticalSupplyCities,
            expansionReadiness: Number(expansionReadiness.toFixed(2)),
            expansionReady: readinessInfo.expansionReady,
            consolidationNeeded: readinessInfo.consolidationNeeded,
            readinessReasons: readinessInfo.reasons,
            readinessBlockingFactors: readinessInfo.blockingFactors,
            cityReadiness: readinessInfo.cityReadiness,
            cityReadinessByCityId: readinessInfo.cityReadinessByCityId,
            fleetPolicy,
            fleetReadiness: Number(readinessInfo.telemetry?.fleetReadiness ?? 1),
            fleetBlocked: Boolean(readinessInfo.telemetry?.blockedByFleet),
            recommendedCargoShipsToBuy: Number(readinessInfo.telemetry?.recommendedCargoShipsToBuy ?? 0),
        },
    };
}

export { STAGES as EMPIRE_STAGE };

