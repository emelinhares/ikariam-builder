// ExpansionReadiness.js — readiness explícito para crescimento/expansão/consolidação

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

function _cityProductionPerHour(city) {
    return _num(city?.production?.wood, 0) + _num(city?.production?.tradegood, 0);
}

function _cityPopulation(city) {
    return _num(city?.economy?.population, _num(city?.economy?.citizens, 0));
}

function _cityResourcesTotal(city) {
    return RESOURCES.reduce((sum, res) => sum + _num(city?.resources?.[res], 0), 0);
}

function _cityWineHours(city, cityCtx) {
    if (Number.isFinite(cityCtx?.wineHours)) return cityCtx.wineHours;
    const spendings = _num(city?.production?.wineSpendings, 0);
    if (spendings <= 0) return Infinity;
    return _num(city?.resources?.wine, 0) / spendings;
}

function _cityLogisticsMinimum(city, cityCtx, cityCount) {
    const levels = _buildingLevels(city);
    const hasPort = (levels.port ?? 0) >= 1 || (levels.tradePort ?? 0) >= 1;
    const pendingTransports = Array.isArray(cityCtx?.pendingTransports) ? cityCtx.pendingTransports.length : 0;
    const hasTransportRoute = pendingTransports > 0;
    return cityCount <= 1 || hasPort || hasTransportRoute;
}

function _evaluateCity(city, cityCtx, cityCount, stage, globalGoal) {
    const population = _cityPopulation(city);
    const satisfaction = _num(city?.economy?.satisfaction, 0);
    const wineHours = _cityWineHours(city, cityCtx);
    const goldPerHour = _num(city?.economy?.goldPerHour, 0);
    const storagePressure = _cityStoragePressure(city);
    const productionPerHour = _cityProductionPerHour(city);
    const logisticsMinimum = _cityLogisticsMinimum(city, cityCtx, cityCount);
    const resourcesAvailable = _cityResourcesTotal(city);

    const scoreCards = [
        {
            key: 'population',
            ok: population >= 300,
            pass: `city_${city.id}_population_ok:${population}`,
            block: `city_${city.id}_low_population:${population}<300`,
        },
        {
            key: 'happiness',
            ok: satisfaction >= 1,
            pass: `city_${city.id}_happiness_ok:${satisfaction}`,
            block: `city_${city.id}_low_happiness:${satisfaction}<1`,
        },
        {
            key: 'wineCoverageHours',
            ok: wineHours >= 4 || wineHours === Infinity,
            pass: `city_${city.id}_wine_coverage_ok:${wineHours === Infinity ? 'infinite' : wineHours.toFixed(1)}h`,
            block: `city_${city.id}_wine_coverage_low:${Number.isFinite(wineHours) ? wineHours.toFixed(1) : 0}h<4h`,
        },
        {
            key: 'goldPerHour',
            ok: goldPerHour >= 0,
            pass: `city_${city.id}_gold_flow_ok:${goldPerHour}/h`,
            block: `city_${city.id}_negative_gold_flow:${goldPerHour}/h`,
        },
        {
            key: 'storagePressure',
            ok: storagePressure <= 0.9,
            pass: `city_${city.id}_storage_pressure_ok:${storagePressure.toFixed(2)}`,
            block: `city_${city.id}_storage_pressure_high:${storagePressure.toFixed(2)}>0.90`,
        },
        {
            key: 'productionPerHour',
            ok: productionPerHour >= 700,
            pass: `city_${city.id}_production_ok:${productionPerHour}/h`,
            block: `city_${city.id}_low_production:${productionPerHour}/h<700/h`,
        },
        {
            key: 'logisticsMinimum',
            ok: logisticsMinimum,
            pass: `city_${city.id}_logistics_minimum_ok`,
            block: `city_${city.id}_missing_logistics_minimum`,
        },
        {
            key: 'resourcesAvailable',
            ok: resourcesAvailable >= 3000,
            pass: `city_${city.id}_resources_available_ok:${resourcesAvailable}`,
            block: `city_${city.id}_insufficient_resources:${resourcesAvailable}<3000`,
        },
    ];

    const reasons = scoreCards.filter((s) => s.ok).map((s) => s.pass);
    const blockingFactors = scoreCards.filter((s) => !s.ok).map((s) => s.block);
    const cityReadiness = Number((reasons.length / scoreCards.length).toFixed(2));
    const requiredReadiness = stage === 'PRE_EXPANSION' || globalGoal === 'PREPARE_EXPANSION' ? 0.75 : 0.7;

    return {
        cityId: city.id,
        cityReadiness,
        expansionReady: cityReadiness >= requiredReadiness && blockingFactors.length <= 2,
        reasons,
        blockingFactors,
        signals: {
            population,
            happiness: satisfaction,
            wineCoverageHours: Number.isFinite(wineHours) ? Number(wineHours.toFixed(2)) : Infinity,
            goldPerHour,
            storagePressure: Number(storagePressure.toFixed(2)),
            productionPerHour,
            logisticsMinimum,
            resourcesAvailable,
        },
    };
}

export function evaluateExpansionReadiness({
    cities = [],
    cityContexts = null,
    stage = null,
    globalGoal = null,
    fleetPolicy = null,
} = {}) {
    const cityCount = cities.length;
    const perCity = [];

    for (const city of cities) {
        const cityCtx = cityContexts instanceof Map ? cityContexts.get(city.id) ?? null : null;
        perCity.push(_evaluateCity(city, cityCtx, cityCount, stage, globalGoal));
    }

    const cityReadinessByCityId = {};
    for (const c of perCity) {
        cityReadinessByCityId[c.cityId] = c;
    }

    const cityReadiness = perCity.length
        ? Number((perCity.reduce((sum, c) => sum + c.cityReadiness, 0) / perCity.length).toFixed(2))
        : 0;

    const totalPopulation = cities.reduce((sum, c) => sum + _cityPopulation(c), 0);
    const totalProductionPerHour = cities.reduce((sum, c) => sum + _cityProductionPerHour(c), 0);
    const totalGoldPerHour = cities.reduce((sum, c) => sum + _num(c?.economy?.goldPerHour, 0), 0);
    const storagePressureAvg = cityCount
        ? cities.reduce((sum, c) => sum + _cityStoragePressure(c), 0) / cityCount
        : 0;
    const storagePressureHighCities = cities.filter((c) => _cityStoragePressure(c) >= 0.92).length;
    const resourcesAvailableTotal = cities.reduce((sum, c) => sum + _cityResourcesTotal(c), 0);
    const logisticsCoveredCities = perCity.filter((c) => c.signals.logisticsMinimum).length;
    const criticalSupplyCities = cityContexts instanceof Map
        ? [...cityContexts.values()].filter((ctx) => ctx?.hasCriticalSupply).length
        : 0;

    const empireChecks = [
        {
            ok: totalPopulation >= Math.max(700, cityCount * 320),
            pass: `empire_population_ok:${totalPopulation}`,
            block: `empire_population_low:${totalPopulation}<${Math.max(700, cityCount * 320)}`,
        },
        {
            ok: totalProductionPerHour >= Math.max(1800, cityCount * 700),
            pass: `empire_production_ok:${totalProductionPerHour}/h`,
            block: `empire_low_production:${totalProductionPerHour}/h<${Math.max(1800, cityCount * 700)}/h`,
        },
        {
            ok: totalGoldPerHour >= Math.max(150, cityCount * 60),
            pass: `empire_gold_flow_ok:${totalGoldPerHour}/h`,
            block: `empire_gold_flow_low:${totalGoldPerHour}/h<${Math.max(150, cityCount * 60)}/h`,
        },
        {
            ok: storagePressureAvg <= 0.9 && storagePressureHighCities === 0,
            pass: `empire_storage_pressure_ok:${storagePressureAvg.toFixed(2)}`,
            block: `empire_storage_pressure_high:avg=${storagePressureAvg.toFixed(2)} highCities=${storagePressureHighCities}`,
        },
        {
            ok: logisticsCoveredCities >= Math.max(1, Math.ceil(cityCount * 0.75)),
            pass: `empire_logistics_coverage_ok:${logisticsCoveredCities}/${cityCount}`,
            block: `empire_logistics_coverage_low:${logisticsCoveredCities}/${cityCount}`,
        },
        {
            ok: resourcesAvailableTotal >= Math.max(9000, cityCount * 3000),
            pass: `empire_resources_available_ok:${resourcesAvailableTotal}`,
            block: `empire_resources_available_low:${resourcesAvailableTotal}<${Math.max(9000, cityCount * 3000)}`,
        },
        {
            ok: cityReadiness >= 0.7,
            pass: `empire_city_readiness_ok:${cityReadiness}`,
            block: `empire_city_readiness_low:${cityReadiness}<0.7`,
        },
        {
            ok: criticalSupplyCities === 0,
            pass: 'empire_no_critical_supply',
            block: `empire_critical_supply_present:${criticalSupplyCities}`,
        },
        {
            ok: !(fleetPolicy?.blockedByFleet),
            pass: `empire_fleet_ready:${Number(fleetPolicy?.fleetReadiness ?? 1).toFixed(2)}`,
            block: `empire_fleet_blocked:${Array.isArray(fleetPolicy?.fleetBlockingFactors) && fleetPolicy.fleetBlockingFactors.length ? fleetPolicy.fleetBlockingFactors.join('|') : 'unknown'}`,
        },
    ];

    const reasons = [
        ...empireChecks.filter((c) => c.ok).map((c) => c.pass),
        ...perCity.flatMap((c) => c.reasons),
        ...(Array.isArray(fleetPolicy?.fleetReasons) ? fleetPolicy.fleetReasons : []),
    ];
    const blockingFactors = [
        ...empireChecks.filter((c) => !c.ok).map((c) => c.block),
        ...perCity.flatMap((c) => c.blockingFactors),
        ...(Array.isArray(fleetPolicy?.fleetBlockingFactors) ? fleetPolicy.fleetBlockingFactors : []),
    ];

    const empireReadiness = Number((empireChecks.filter((c) => c.ok).length / empireChecks.length).toFixed(2));
    const requiredEmpireReadiness = stage === 'PRE_EXPANSION' || globalGoal === 'PREPARE_EXPANSION' ? 0.75 : 0.7;
    const fleetBlocksExpansion =
        (stage === 'PRE_EXPANSION' || globalGoal === 'PREPARE_EXPANSION')
        && Boolean(fleetPolicy?.blockedByFleet);
    const expansionReady =
        empireReadiness >= requiredEmpireReadiness
        && blockingFactors.length <= 6
        && !fleetBlocksExpansion;
    const consolidationNeeded = cityCount >= 2 && (
        criticalSupplyCities > 0 ||
        storagePressureHighCities > 0 ||
        totalGoldPerHour < Math.max(150, cityCount * 60) ||
        perCity.some((c) => c.cityReadiness < 0.55)
    );

    return {
        cityReadiness,
        cityReadinessByCityId,
        empireReadiness,
        expansionReady,
        consolidationNeeded,
        reasons,
        blockingFactors,
        telemetry: {
            cityCount,
            totalPopulation,
            totalProductionPerHour,
            totalGoldPerHour,
            storagePressureAvg: Number(storagePressureAvg.toFixed(2)),
            storagePressureHighCities,
            logisticsCoveredCities,
            resourcesAvailableTotal,
            criticalSupplyCities,
            fleetReadiness: Number(fleetPolicy?.fleetReadiness ?? 1),
            freeCargoShips: Number(fleetPolicy?.freeCargoShips ?? 0),
            totalCargoShips: Number(fleetPolicy?.totalCargoShips ?? 0),
            blockedByFleet: Boolean(fleetPolicy?.blockedByFleet),
            recommendedCargoShipsToBuy: Number(fleetPolicy?.recommendedCargoShipsToBuy ?? 0),
        },
    };
}

