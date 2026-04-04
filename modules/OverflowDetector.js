import { TASK_TYPE } from './taskTypes.js';

export function scheduleOverflowTransport({
    city,
    dest,
    resource,
    amount,
    confidence = 'HIGH',
}) {
    const boats = Math.ceil(amount / 500);
    return {
        type: TASK_TYPE.TRANSPORT,
        priority: 30,
        cityId: city.id,
        payload: {
            fromCityId: city.id,
            toCityId: dest.id,
            toIslandId: dest.islandId,
            cargo: { [resource]: amount },
            boats,
            totalCargo: amount,
            overflowRelief: true,
            logisticPurpose: 'overflowRelief',
        },
        scheduledFor: Date.now(),
        reason: `COO Overflow: ${resource}+${amount} de ${city.name} → ${dest.name}`,
        module: 'COO',
        confidence,
    };
}

export function checkCityOverflow({
    city,
    classifications,
    ledger,
    queue,
    config,
    hub,
    state,
    getReservedCoverage,
    findOverflowDest,
    enqueueTransportTask,
    audit,
}) {
    const maxRes = city.maxResources;
    if (!maxRes || maxRes === 0) return 0;

    const cityClass = classifications?.get(city.id) ?? null;
    let scheduledCount = 0;

    for (const [res, qty] of Object.entries(city.resources)) {
        const overflowByPct = qty >= maxRes * 0.95;
        const overflowByTime = cityClass?.overflowFlags?.[res] ?? false;
        if (!overflowByPct && !overflowByTime) continue;

        const desiredTtcHours = config.overflowTargetTimeToCapHours ?? 6;
        const productionPerHour = cityClass?.productionPerHour?.[res] ?? 0;
        const desiredMaxByTtc = Number.isFinite(productionPerHour) && productionPerHour > 0
            ? Math.max(0, maxRes - Math.ceil(productionPerHour * desiredTtcHours))
            : qty;
        const desiredMax = overflowByPct
            ? Math.floor(maxRes * 0.80)
            : Math.min(Math.floor(maxRes * 0.90), desiredMaxByTtc);
        const excess = Math.max(0, qty - desiredMax);
        if (excess <= 0) continue;

        const existente = queue.getPending(city.id)
            .find(t => t.type === TASK_TYPE.TRANSPORT && t.payload?.cargo?.[res]);
        if (existente) continue;

        const dest = findOverflowDest(res, city.id, classifications, excess) ?? hub;
        if (!dest || dest.id === city.id) continue;

        const alreadyReserved = getReservedCoverage(dest.id, res, 'overflowRelief');
        if (alreadyReserved > 0) continue;

        const destCity = state.getCity(dest.id);
        const destSpace = Math.max(0, (destCity?.maxResources ?? 0) - (destCity?.resources[res] ?? 0));
        const toSend = Math.min(excess, destSpace > 0 ? destSpace : excess);
        if (toSend <= 0) continue;

        const task = scheduleOverflowTransport({
            city,
            dest,
            resource: res,
            amount: toSend,
            confidence: state.getConfidence(city.id),
        });
        enqueueTransportTask(task);
        scheduledCount++;

        const entry = ledger.get(city.id);
        if (entry && res in entry) entry[res] += toSend;

        audit?.warn?.('COO', `Overflow de ${res} em ${city.name}: ${qty}/${maxRes}`);
    }

    return scheduledCount;
}

