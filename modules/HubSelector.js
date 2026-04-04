import { classifyCities } from './CityClassifier.js';
import { createEmptyResources } from './resourceContracts.js';

function centralityScore(city, allCities) {
    if (allCities.length < 2) return 0;
    const others = allCities.filter(c => c.id !== city.id);
    const avgDist = others.reduce((sum, c) =>
        sum + Math.hypot(c.coords[0] - city.coords[0], c.coords[1] - city.coords[1]), 0
    ) / others.length;
    return Math.max(0, 50 - avgDist);
}

export function identifyHub(cities = []) {
    if (!Array.isArray(cities) || !cities.length) return null;

    let best = null;
    let bestScore = -Infinity;

    for (const city of cities) {
        const warehouseLevel = Math.max(
            0,
            ...(city.buildings || [])
                .filter(b => b.building === 'warehouse')
                .map(b => b.level ?? 0)
        );
        const capacityScore = warehouseLevel * 10;
        const score = capacityScore + centralityScore(city, cities);
        if (score > bestScore) {
            bestScore = score;
            best = city;
        }
    }

    return best;
}

export function buildCityClassification({
    cities = [],
    queuePending = [],
    getInTransit = () => createEmptyResources(),
    config = {},
    hubCityId = null,
    buildFocusCityIds = null,
} = {}) {
    const inTransitByCity = new Map();
    for (const city of cities) {
        inTransitByCity.set(city.id, getInTransit(city.id) ?? createEmptyResources());
    }

    const buildFocus = buildFocusCityIds ?? new Set(
        queuePending
            .filter(t => t.type === 'BUILD')
            .map(t => t.cityId)
    );

    const classifications = classifyCities(cities, {
        hubCityId,
        minStockFraction: config.minStockFraction ?? 0.20,
        overflowThresholdPct: config.overflowThresholdPct ?? 0.95,
        overflowTimeToCapHours: config.overflowTimeToCapHours ?? 2,
        buildFocusCityIds: buildFocus,
        inTransitByCity,
    });

    const map = new Map();
    for (const cls of classifications) map.set(cls.cityId, cls);
    return map;
}

