import { TradeGoodOrdinals } from '../data/const.js';

const RESOURCE_KEYS = Object.freeze(['wood', 'wine', 'marble', 'glass', 'sulfur']);

const TRADEGOOD_TO_RESOURCE = Object.freeze({
    [TradeGoodOrdinals.WINE]: 'wine',
    [TradeGoodOrdinals.MARBLE]: 'marble',
    [TradeGoodOrdinals.GLASS]: 'glass',
    [TradeGoodOrdinals.SULFUR]: 'sulfur',
});

export const CITY_ROLE = Object.freeze({
    PRODUCER_WINE: 'PRODUCER_WINE',
    PRODUCER_MARBLE: 'PRODUCER_MARBLE',
    PRODUCER_CRYSTAL: 'PRODUCER_CRYSTAL',
    PRODUCER_SULFUR: 'PRODUCER_SULFUR',
    HUB: 'HUB',
    DEFICIT: 'DEFICIT',
    OVERFLOW: 'OVERFLOW',
    BUILD_FOCUS: 'BUILD_FOCUS',
});

function _num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function _isProducerFor(city, resource) {
    return TRADEGOOD_TO_RESOURCE[_num(city?.tradegood, 0)] === resource;
}

function _getProductionPerHour(city, resource) {
    if (resource === 'wood') return Math.max(0, _num(city?.production?.wood, 0));
    if (_isProducerFor(city, resource)) {
        return Math.max(0, _num(city?.production?.tradegood, 0));
    }
    return 0;
}

export function classifyCities(cities, {
    hubCityId = null,
    minStockFraction = 0.20,
    overflowThresholdPct = 0.95,
    overflowTimeToCapHours = 2,
    buildFocusCityIds = new Set(),
    inTransitByCity = new Map(),
} = {}) {
    const buildFocusSet = buildFocusCityIds instanceof Set
        ? buildFocusCityIds
        : new Set(buildFocusCityIds ?? []);

    return (cities ?? []).map((city) => {
        const maxResources = Math.max(0, _num(city?.maxResources, 0));
        const resources = {};
        const productionPerHour = {};
        const deficitFlags = {};
        const overflowFlags = {};
        const timeToCapHours = {};

        let maxFillRatio = 0;
        let minTimeToCap = Infinity;

        for (const resource of RESOURCE_KEYS) {
            const onHand = Math.max(0, _num(city?.resources?.[resource], 0));
            const incoming = Math.max(0, _num(inTransitByCity.get(city?.id)?.[resource], 0));
            const effective = onHand + incoming;
            const production = _getProductionPerHour(city, resource);
            const minTarget = maxResources > 0 ? Math.floor(maxResources * minStockFraction) : 0;

            const ratio = maxResources > 0 ? onHand / maxResources : 0;
            const remaining = Math.max(0, maxResources - onHand);
            const ttc = production > 0 ? (remaining / production) : Infinity;

            resources[resource] = onHand;
            productionPerHour[resource] = production;
            deficitFlags[resource] = maxResources > 0 && effective < minTarget;
            overflowFlags[resource] = maxResources > 0 && (
                ratio >= overflowThresholdPct ||
                (production > 0 && ttc <= overflowTimeToCapHours)
            );
            timeToCapHours[resource] = ttc;

            maxFillRatio = Math.max(maxFillRatio, ratio);
            minTimeToCap = Math.min(minTimeToCap, ttc);
        }

        const islandResource = TRADEGOOD_TO_RESOURCE[_num(city?.tradegood, 0)] ?? null;

        const roles = [];
        if (islandResource === 'wine') roles.push(CITY_ROLE.PRODUCER_WINE);
        if (islandResource === 'marble') roles.push(CITY_ROLE.PRODUCER_MARBLE);
        if (islandResource === 'glass') roles.push(CITY_ROLE.PRODUCER_CRYSTAL);
        if (islandResource === 'sulfur') roles.push(CITY_ROLE.PRODUCER_SULFUR);
        if (hubCityId !== null && Number(city?.id) === Number(hubCityId)) roles.push(CITY_ROLE.HUB);
        if (Object.values(deficitFlags).some(Boolean)) roles.push(CITY_ROLE.DEFICIT);
        if (Object.values(overflowFlags).some(Boolean)) roles.push(CITY_ROLE.OVERFLOW);
        if (buildFocusSet.has(city?.id)) roles.push(CITY_ROLE.BUILD_FOCUS);

        return {
            cityId: city?.id,
            islandResource,
            tradegood: _num(city?.tradegood, 0),
            productionPerHour,
            storagePressure: maxFillRatio,
            deficitFlags,
            overflowFlags,
            roles,
            timeToCapHours,
            maxFillRatio,
            minTimeToCapHours: minTimeToCap,
        };
    });
}

