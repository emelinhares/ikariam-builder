import { TradeGoodOrdinals } from '../data/const.js';
import { ACADEMY_MAX_SCIENTISTS } from '../data/effects.js';
import { CITY_ROLE, classifyCities } from './CityClassifier.js';

function _num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function _round(v, digits = 2) {
    const p = 10 ** digits;
    return Math.round(_num(v, 0) * p) / p;
}

function _isAggressiveWindow(stage, growthStage) {
    return stage === 'BOOTSTRAP'
        || growthStage === 'BOOTSTRAP_CITY'
        || growthStage === 'STABILIZE_CITY'
        || growthStage === 'THROUGHPUT_GROWTH';
}

function _isGoldHealthy(goldPerHour, stage, growthStage) {
    const floor = _isAggressiveWindow(stage, growthStage) ? 60 : 120;
    return _num(goldPerHour, 0) >= floor;
}

function _cityIslandResource(city) {
    const tg = _num(city?.tradegood, 0);
    if (tg === TradeGoodOrdinals.WINE) return 'wine';
    if (tg === TradeGoodOrdinals.MARBLE) return 'marble';
    if (tg === TradeGoodOrdinals.GLASS) return 'glass';
    if (tg === TradeGoodOrdinals.SULFUR) return 'sulfur';
    return null;
}

function _buildFloors({ stage, globalGoal, growthStage, readiness, cityClass }) {
    const aggressive = _isAggressiveWindow(stage, growthStage);
    const producerRole = Array.isArray(cityClass?.roles)
        && cityClass.roles.some((r) => [
            CITY_ROLE.PRODUCER_WINE,
            CITY_ROLE.PRODUCER_MARBLE,
            CITY_ROLE.PRODUCER_CRYSTAL,
            CITY_ROLE.PRODUCER_SULFUR,
        ].includes(r));

    let woodFloor = aggressive ? 180 : 130;
    let tradegoodFloor = producerRole ? 110 : 40;

    if (globalGoal === 'UNBLOCK_PRODUCTION') {
        woodFloor += 30;
        tradegoodFloor += 25;
    }
    if (globalGoal === 'CONSOLIDATE_NEW_CITY') {
        woodFloor += 10;
        tradegoodFloor += 15;
    }
    if (_num(readiness?.empireReadiness, 0) < 0.65) {
        woodFloor += 20;
        tradegoodFloor += 10;
    }

    return {
        woodFloor,
        tradegoodFloor,
        producerRole,
    };
}

function _buildCitySignal({ city, cityCtx, cityClass, stage, globalGoal, growthStage, readiness }) {
    const population = _num(city?.economy?.population, _num(city?.economy?.citizens, 0));
    const workersWood = _num(city?.workers?.wood, 0);
    const workersTradegood = _num(city?.workers?.tradegood, 0);
    const priests = _num(city?.workers?.priests, 0);
    const scientists = _num(city?.workers?.scientists, 0);
    const assigned = workersWood + workersTradegood + priests + scientists;
    const inferredCitizens = Math.max(0, population - assigned);
    const citizens = _num(city?.economy?.citizens, inferredCitizens);

    const idlePopulation = Math.max(0, Math.round(citizens));
    const workforceUtilization = population > 0 ? _round((assigned / population) * 100, 1) : 0;

    const happiness = _num(city?.economy?.satisfaction, 0);
    const wineHours = Number.isFinite(cityCtx?.wineHours) ? _num(cityCtx.wineHours, 0) : Infinity;
    const goldPerHour = _num(city?.economy?.goldPerHour, 0);
    const isGoldHealthy = _isGoldHealthy(goldPerHour, stage, growthStage);

    const productionWood = _num(city?.production?.wood, 0);
    const productionTradegood = _num(city?.production?.tradegood, 0);

    const { woodFloor, tradegoodFloor, producerRole } = _buildFloors({
        stage,
        globalGoal,
        growthStage,
        readiness,
        cityClass,
    });

    const productionFloorMet = productionWood >= woodFloor && productionTradegood >= tradegoodFloor;

    const workforceBlockingFactors = [];
    const workforceReasons = [];

    if (happiness <= 0) workforceBlockingFactors.push('happiness_below_zero_blocks_safe_workforce_push');
    if (Number.isFinite(wineHours) && wineHours < 2) workforceBlockingFactors.push('wine_coverage_critical_blocks_workforce_push');
    if (goldPerHour < -200) workforceBlockingFactors.push('gold_flow_too_negative_for_workforce_expansion');

    const woodPerWorker = workersWood > 0 ? (productionWood / workersWood) : 8;
    const tradegoodPerWorker = workersTradegood > 0 ? (productionTradegood / workersTradegood) : 7;

    const needWoodWorkers = Math.max(0, Math.ceil((woodFloor - productionWood) / Math.max(woodPerWorker, 1)));
    const needTradegoodWorkers = Math.max(0, Math.ceil((tradegoodFloor - productionTradegood) / Math.max(tradegoodPerWorker, 1)));

    let allocWood = 0;
    let allocTradegood = 0;
    let allocScientists = 0;
    let availableIdle = idlePopulation;

    const islandResource = _cityIslandResource(city);
    const prioritizeTradegood = producerRole && ['wine', 'marble', 'glass', 'sulfur'].includes(islandResource);

    if (!workforceBlockingFactors.length && availableIdle > 0) {
        if (prioritizeTradegood) {
            allocTradegood = Math.min(availableIdle, needTradegoodWorkers);
            availableIdle -= allocTradegood;
            allocWood = Math.min(availableIdle, needWoodWorkers);
            availableIdle -= allocWood;
        } else {
            allocWood = Math.min(availableIdle, needWoodWorkers);
            availableIdle -= allocWood;
            allocTradegood = Math.min(availableIdle, needTradegoodWorkers);
            availableIdle -= allocTradegood;
        }
    }

    const academyLevel = (city?.buildings ?? [])
        .filter((b) => b?.building === 'academy')
        .reduce((max, b) => Math.max(max, _num(b?.level, 0)), 0);
    const scientistCap = _num(ACADEMY_MAX_SCIENTISTS[academyLevel], scientists);

    if (
        !workforceBlockingFactors.length
        && isGoldHealthy
        && availableIdle > 0
        && academyLevel > 0
        && (productionFloorMet || growthStage === 'THROUGHPUT_GROWTH')
    ) {
        const scientistHeadroom = Math.max(0, scientistCap - scientists);
        const desired = _isAggressiveWindow(stage, growthStage) ? 4 : 2;
        allocScientists = Math.min(availableIdle, scientistHeadroom, desired);
        availableIdle -= allocScientists;
    }

    const recommendedWorkersWood = workersWood + allocWood;
    const recommendedWorkersTradegood = workersTradegood + allocTradegood;
    const recommendedScientists = scientists + allocScientists;

    if (idlePopulation > 0 && !productionFloorMet && !workforceBlockingFactors.length) {
        workforceReasons.push('idle_population_detected_with_production_below_floor_reallocation_recommended');
    }

    if (allocWood > 0) workforceReasons.push(`allocate_${allocWood}_idle_to_wood_production`);
    if (allocTradegood > 0) {
        workforceReasons.push(
            prioritizeTradegood
                ? `allocate_${allocTradegood}_idle_to_island_tradegood_priority`
                : `allocate_${allocTradegood}_idle_to_tradegood_production`
        );
    }
    if (allocScientists > 0) workforceReasons.push(`gold_healthy_allocate_${allocScientists}_idle_to_scientists`);

    if (idlePopulation > 0 && productionFloorMet && allocScientists === 0 && academyLevel > 0 && !isGoldHealthy) {
        workforceReasons.push('idle_population_preserved_due_to_low_gold_not_science_push');
    }

    if (idlePopulation > 0 && !productionFloorMet && workforceBlockingFactors.length) {
        workforceBlockingFactors.push('idle_population_unresolved_due_to_blocking_factors');
    }

    if (idlePopulation > 0 && allocWood === 0 && allocTradegood === 0 && allocScientists === 0 && !workforceBlockingFactors.length) {
        workforceBlockingFactors.push('idle_population_without_actionable_reallocation_guard');
    }

    return {
        idlePopulation,
        workforceUtilization,
        productionFloorMet,
        recommendedWorkersWood,
        recommendedWorkersTradegood,
        recommendedScientists,
        workforceBlockingFactors,
        workforceReasons,
    };
}

export function evaluateWorkforcePolicy({
    cities = [],
    cityContexts = null,
    stage = null,
    globalGoal = null,
    growthStage = null,
    readiness = {},
} = {}) {
    const classes = classifyCities(cities);
    const classByCityId = new Map(classes.map((c) => [Number(c.cityId), c]));

    const perCity = new Map();

    for (const city of cities) {
        const cityCtx = cityContexts instanceof Map ? (cityContexts.get(city.id) ?? null) : null;
        const cityClass = classByCityId.get(Number(city.id)) ?? null;
        const signal = _buildCitySignal({
            city,
            cityCtx,
            cityClass,
            stage,
            globalGoal,
            growthStage,
            readiness,
        });
        perCity.set(city.id, signal);
    }

    const allSignals = [...perCity.values()];
    const blockedCities = allSignals.filter((s) => s.workforceBlockingFactors.length > 0).length;
    const utilizationAvg = allSignals.length
        ? _round(allSignals.reduce((sum, s) => sum + _num(s.workforceUtilization, 0), 0) / allSignals.length, 1)
        : 0;

    const unresolvedIdleCities = allSignals.filter((s) =>
        _num(s.idlePopulation, 0) > 0
        && !_num(s.productionFloorMet ? 1 : 0)
        && s.workforceBlockingFactors.length > 0
    ).length;

    const workforceReadiness = _round(Math.max(0, Math.min(1,
        1 - (blockedCities / Math.max(1, allSignals.length)) * 0.6 - (unresolvedIdleCities / Math.max(1, allSignals.length)) * 0.4
    )), 2);

    const reasons = [];
    const blockingFactors = [];

    if (utilizationAvg < 82) reasons.push(`workforce_utilization_below_target:${utilizationAvg}%<82%`);
    if (blockedCities === 0 && unresolvedIdleCities === 0) reasons.push('workforce_policy_healthy_no_unresolved_idle_cities');

    if (unresolvedIdleCities > 0) {
        blockingFactors.push(`workforce_idle_population_unresolved_cities:${unresolvedIdleCities}`);
    }
    if (blockedCities > 0) {
        blockingFactors.push(`workforce_cities_blocked:${blockedCities}`);
    }

    return {
        perCity,
        workforceReadiness,
        reasons,
        blockingFactors,
        telemetry: {
            cityCount: allSignals.length,
            blockedCities,
            unresolvedIdleCities,
            workforceUtilizationAvg: utilizationAvg,
        },
    };
}

