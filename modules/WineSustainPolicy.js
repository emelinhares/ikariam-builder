import { getMaxServableWineLevel, WINE_USE } from '../data/wine.js';

export const WINE_MODE = Object.freeze({
    BOOTSTRAP_TAVERN: 'BOOTSTRAP_TAVERN',
    MAINTAIN: 'MAINTAIN',
    REDUCE_WASTE: 'REDUCE_WASTE',
    IMPORT_WINE: 'IMPORT_WINE',
    CRITICAL_NO_WINE: 'CRITICAL_NO_WINE',
});

export const WINE_RISK_LEVEL = Object.freeze({
    HEALTHY: 'HEALTHY',
    LOW: 'LOW',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
});

function _num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function _resolvePopulationUtilization(signals = {}) {
    const typed = _num(signals.populationUtilization, NaN);
    if (Number.isFinite(typed) && typed >= 0) return typed;
    const used = _num(signals.populationUsed, 0);
    const max = _num(signals.maxInhabitants, 0);
    return max > 0 ? (used / max) : 0;
}

function _resolveTargetGrowthPerHour(utilization = 0) {
    if (utilization >= 0.98) return 0;
    if (utilization >= 0.94) return 0.2;
    if (utilization >= 0.90) return 0.5;
    if (utilization >= 0.82) return 1;
    return 2;
}

function _resolveEmergencyThresholdHours(ctx = null, base = 4) {
    const stage = ctx?.stage ?? null;
    const growthStage = ctx?.growthPolicy?.growthStage ?? null;
    let threshold = base;
    if (stage === 'BOOTSTRAP' || growthStage === 'BOOTSTRAP_CITY') threshold += 2;
    else if (stage === 'PRE_EXPANSION' || growthStage === 'STABILIZE_CITY') threshold += 1.5;
    else if (stage === 'MULTI_CITY_EARLY') threshold += 1;
    return threshold;
}

export function evaluateWineSustainPolicy({ city, signals = {}, ctx = null, emergencyHours = 4 } = {}) {
    const wineStock = _num(city?.resources?.wine, 0);
    const tavernLevel = _num(city?.tavern?.wineLevel, 0);
    const tavernBuildingLevel = (city?.buildings ?? [])
        .filter((b) => b?.building === 'tavern')
        .reduce((max, b) => Math.max(max, _num(b?.level, 0)), 0);
    const tavernExists = tavernBuildingLevel > 0;
    const maxServableWineLevel = getMaxServableWineLevel(tavernBuildingLevel);

    const rawWineSpendings = _num(signals.wineSpendings, _num(city?.production?.wineSpendings, 0));
    const fallbackWineSpendings = tavernLevel > 0 ? _num(WINE_USE[tavernLevel], 0) : 0;
    const effectiveWineSpendings = rawWineSpendings > 0 ? rawWineSpendings : fallbackWineSpendings;
    const hasStockWithoutConsumption = wineStock > 0 && effectiveWineSpendings <= 0;

    const happinessScore = signals.happinessScore ?? city?.typed?.happinessScore ?? city?.economy?.satisfaction ?? null;
    const happinessState = signals.happinessState ?? city?.typed?.happinessState ?? null;
    const populationGrowthPerHour = _num(signals.populationGrowthPerHour, _num(city?.typed?.populationGrowthPerHour, _num(city?.economy?.growthPerHour, 0)));
    const populationUsed = _num(signals.populationUsed, _num(city?.typed?.populationUsed, _num(city?.economy?.population, 0)));
    const maxInhabitants = _num(signals.maxInhabitants, _num(city?.typed?.maxInhabitants, _num(city?.economy?.maxInhabitants, 0)));
    const populationUtilization = _resolvePopulationUtilization({ ...signals, populationUsed, maxInhabitants });
    const targetPopulationGrowthPerHour = _resolveTargetGrowthPerHour(populationUtilization);

    const coverageHours = effectiveWineSpendings > 0 ? (wineStock / effectiveWineSpendings) : Infinity;
    const threshold = _resolveEmergencyThresholdHours(ctx, emergencyHours);

    const wineReasons = [];
    const wineBlockingFactors = [];

    if (!tavernExists) {
        wineBlockingFactors.push('tavern_not_built');
    }
    if (wineStock <= 0) {
        wineReasons.push('wine_stock_empty');
    }
    if (hasStockWithoutConsumption) {
        wineReasons.push('wine_available_but_not_consumed');
    }
    if (Number.isFinite(coverageHours) && coverageHours < threshold) {
        wineReasons.push(`wine_coverage_below_threshold:${coverageHours.toFixed(1)}h<${threshold.toFixed(1)}h`);
    }
    if (happinessScore !== null && Number(happinessScore) <= 0) {
        wineReasons.push(`happiness_critical:${Number(happinessScore)}`);
    }
    if (populationGrowthPerHour < targetPopulationGrowthPerHour) {
        wineReasons.push(`growth_below_target:${populationGrowthPerHour.toFixed(2)}<${targetPopulationGrowthPerHour.toFixed(2)}`);
    }

    let wineMode = WINE_MODE.MAINTAIN;
    let wineRiskLevel = WINE_RISK_LEVEL.HEALTHY;
    let needsWineImport = false;
    let needsTavernBootstrap = false;
    let needsTavernAdjustment = false;

    let targetWineLevel = Math.max(0, Math.min(tavernLevel, maxServableWineLevel));

    if (wineStock <= 0) {
        wineMode = WINE_MODE.CRITICAL_NO_WINE;
        wineRiskLevel = WINE_RISK_LEVEL.CRITICAL;
        needsWineImport = true;
        needsTavernBootstrap = tavernExists;
        needsTavernAdjustment = tavernExists && tavernLevel <= 0;
        targetWineLevel = tavernExists ? Math.max(1, targetWineLevel) : 0;
    } else if (hasStockWithoutConsumption) {
        wineMode = WINE_MODE.BOOTSTRAP_TAVERN;
        wineRiskLevel = WINE_RISK_LEVEL.HIGH;
        needsTavernBootstrap = tavernExists;
        needsTavernAdjustment = tavernExists;
        targetWineLevel = tavernExists ? Math.max(1, targetWineLevel) : 0;
    } else if (Number.isFinite(coverageHours) && coverageHours < threshold) {
        wineMode = WINE_MODE.IMPORT_WINE;
        wineRiskLevel = coverageHours < Math.max(1, threshold * 0.4)
            ? WINE_RISK_LEVEL.CRITICAL
            : WINE_RISK_LEVEL.HIGH;
        needsWineImport = true;
    } else {
        const growthGap = populationGrowthPerHour - targetPopulationGrowthPerHour;
        const nearCap = populationUtilization >= 0.94;
        if (nearCap && growthGap > 0.6 && tavernLevel > 0) {
            wineMode = WINE_MODE.REDUCE_WASTE;
            wineRiskLevel = WINE_RISK_LEVEL.LOW;
            needsTavernAdjustment = true;
            targetWineLevel = Math.max(0, tavernLevel - 1);
            wineReasons.push('near_capacity_reduce_wine_waste');
        } else if (populationGrowthPerHour + 0.3 < targetPopulationGrowthPerHour && tavernExists && tavernLevel < maxServableWineLevel) {
            wineMode = WINE_MODE.MAINTAIN;
            wineRiskLevel = WINE_RISK_LEVEL.LOW;
            needsTavernAdjustment = true;
            targetWineLevel = Math.min(maxServableWineLevel, tavernLevel + 1);
            wineReasons.push('growth_insufficient_adjust_tavern_up');
        }
    }

    if (wineRiskLevel === WINE_RISK_LEVEL.HEALTHY && wineReasons.length === 0) {
        wineReasons.push('wine_sustain_healthy');
    }

    const targetCoverageHours = Math.max(
        threshold,
        populationUtilization < 0.9 ? threshold + 8 : threshold + 2,
    );

    return {
        wineMode,
        wineCoverageHours: Number.isFinite(coverageHours) ? Number(coverageHours.toFixed(2)) : Infinity,
        wineRiskLevel,
        needsWineImport,
        needsTavernBootstrap,
        needsTavernAdjustment,
        targetWineLevel,
        targetPopulationGrowthPerHour: Number(targetPopulationGrowthPerHour.toFixed(2)),
        targetWineCoverageHours: Number(targetCoverageHours.toFixed(2)),
        targetWineAmount: Math.max(0, Math.ceil(Math.max(0, effectiveWineSpendings) * targetCoverageHours)),
        effectiveWineSpendings: Number(effectiveWineSpendings.toFixed(2)),
        rawWineSpendings: Number(rawWineSpendings.toFixed(2)),
        happinessScore: happinessScore === null ? null : Number(happinessScore),
        happinessState,
        populationGrowthPerHour: Number(populationGrowthPerHour.toFixed(2)),
        populationUsed,
        maxInhabitants,
        populationUtilization: Number(populationUtilization.toFixed(3)),
        wineReasons,
        wineBlockingFactors,
        emergencyHoursThreshold: Number(threshold.toFixed(2)),
    };
}

