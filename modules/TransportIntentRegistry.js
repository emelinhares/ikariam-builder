import { TASK_TYPE } from './taskTypes.js';

const STORAGE_KEY = 'transportIntentRegistry';

export const TRANSPORT_INTENT_STATUS = Object.freeze({
    PLANNED: 'PLANNED',
    DISPATCHING: 'DISPATCHING',
    CONFIRMED_LOADING: 'CONFIRMED_LOADING',
    CONFIRMED_MOVING: 'CONFIRMED_MOVING',
    DELIVERED: 'DELIVERED',
    FAILED: 'FAILED',
    EXPIRED: 'EXPIRED',
});

const ACTIVE_STATUSES = new Set([
    TRANSPORT_INTENT_STATUS.PLANNED,
    TRANSPORT_INTENT_STATUS.DISPATCHING,
    TRANSPORT_INTENT_STATUS.CONFIRMED_LOADING,
    TRANSPORT_INTENT_STATUS.CONFIRMED_MOVING,
]);

const STATUS_RANK = {
    [TRANSPORT_INTENT_STATUS.PLANNED]: 1,
    [TRANSPORT_INTENT_STATUS.DISPATCHING]: 2,
    [TRANSPORT_INTENT_STATUS.CONFIRMED_LOADING]: 3,
    [TRANSPORT_INTENT_STATUS.CONFIRMED_MOVING]: 4,
    [TRANSPORT_INTENT_STATUS.DELIVERED]: 5,
};

function _safeNum(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function _isLoadingState(m) {
    const stateRaw = String(m?.state ?? m?.status ?? m?.phase ?? '').toLowerCase();
    if (stateRaw.includes('loading') || stateRaw.includes('carregar')) return true;
    const progressPct = Number(m?.progressPct ?? m?.progress ?? NaN);
    return Number.isFinite(progressPct) && progressPct === 0;
}

export class TransportIntentRegistry {
    constructor({ storage, audit, state = null, queue = null } = {}) {
        this._storage = storage;
        this._audit = audit;
        this._state = state;
        this._queue = queue;
        this._records = new Map();
        this._maxRecords = 600;
        this._ttlMs = 8 * 60 * 60 * 1000;
    }

    setState(state) { this._state = state; }
    setQueue(queue) { this._queue = queue; }

    async init() {
        const saved = await this._storage?.get?.(STORAGE_KEY).catch(() => null);
        const records = Array.isArray(saved?.records) ? saved.records : [];
        for (const r of records) {
            if (!r?.intentId) continue;
            this._records.set(r.intentId, r);
        }
        this._expireOld();
        await this._persist();
    }

    static resolvePurpose(payload = {}) {
        if (payload?.wineBootstrapRecovery) return 'wineBootstrap';
        if (payload?.wineEmergency) return 'wineEmergency';
        if (payload?.jitBuild) return 'jitBuild';
        if (payload?.minStock) return 'minStock';
        if (payload?.overflowRelief) return 'overflowRelief';
        return payload?.logisticPurpose ?? 'generic';
    }

    static resolveMainCargo(cargo = {}) {
        const entries = Object.entries(cargo)
            .map(([resource, qty]) => ({ resource, qty: Number(qty) || 0 }))
            .filter((e) => e.qty > 0)
            .sort((a, b) => b.qty - a.qty || String(a.resource).localeCompare(String(b.resource)));
        if (!entries.length) return { resource: 'none', amount: 0 };
        return { resource: entries[0].resource, amount: entries[0].qty };
    }

    static amountBucket(amount) {
        const n = Math.max(0, _safeNum(amount, 0));
        if (n <= 0) return 0;
        const base = 500;
        return Math.ceil(n / base) * base;
    }

    static buildIntentId({ purpose, fromCityId, toCityId, resource, amount } = {}) {
        const p = String(purpose ?? 'generic');
        const from = _safeNum(fromCityId, 0);
        const to = _safeNum(toCityId, 0);
        const r = String(resource ?? 'none');
        const bucket = TransportIntentRegistry.amountBucket(amount);
        return `tp:${p}|f:${from}|t:${to}|r:${r}|b:${bucket}`;
    }

    ensureFromTaskData(taskData = {}) {
        if (taskData?.type !== TASK_TYPE.TRANSPORT) return null;
        const payload = taskData.payload ?? {};
        const { resource, amount } = TransportIntentRegistry.resolveMainCargo(payload.cargo ?? {});
        const purpose = TransportIntentRegistry.resolvePurpose(payload);
        const fromCityId = Number(payload.fromCityId ?? taskData.cityId ?? NaN);
        const toCityId = Number(payload.toCityId ?? NaN);
        const intentId = TransportIntentRegistry.buildIntentId({
            purpose,
            fromCityId,
            toCityId,
            resource,
            amount,
        });

        const existing = this._records.get(intentId);
        const now = Date.now();
        const record = existing ?? {
            intentId,
            purpose,
            fromCityId,
            toCityId,
            resource,
            amountBucket: TransportIntentRegistry.amountBucket(amount),
            createdAt: now,
            status: TRANSPORT_INTENT_STATUS.PLANNED,
            evidence: [],
            updatedAt: now,
        };

        if (!existing) this._records.set(intentId, record);

        if (!taskData.payload) taskData.payload = {};
        taskData.payload.intentId = intentId;
        taskData.payload.transportIntent = {
            purpose,
            resource,
            amountBucket: record.amountBucket,
        };

        this._touch(record, {
            status: TRANSPORT_INTENT_STATUS.PLANNED,
            evidence: [`plannedBy=${taskData.module ?? 'unknown'}`],
        });
        this._persist();
        return record;
    }

    markDispatched(intentId, taskId = null) {
        this._mark(intentId, TRANSPORT_INTENT_STATUS.DISPATCHING, taskId ? [`taskStarted=${taskId}`] : []);
    }

    markTransportSuccess(intentId, taskId = null) {
        this._mark(intentId, TRANSPORT_INTENT_STATUS.CONFIRMED_MOVING, taskId ? [`taskDone=${taskId}`] : []);
    }

    markFailed(intentId, reason = null) {
        const evidence = reason ? [`failedReason=${reason}`] : [];
        this._mark(intentId, TRANSPORT_INTENT_STATUS.FAILED, evidence, { force: true });
    }

    reconcileEquivalent({ purpose, fromCityId, toCityId, resource, amount } = {}) {
        const intentId = TransportIntentRegistry.buildIntentId({ purpose, fromCityId, toCityId, resource, amount });
        const evidence = [];
        let targetStatus = null;

        const record = this._records.get(intentId);
        if (record && ACTIVE_STATUSES.has(record.status)) {
            evidence.push(`registryActive=${record.status}`);
            targetStatus = record.status;
        }

        const queue = this._queue;
        if (queue?.getActive) {
            const active = queue.getActive();
            const t = active.find((task) => {
                if (task?.type !== TASK_TYPE.TRANSPORT) return false;
                const taskIntentId = task?.payload?.intentId;
                if (taskIntentId) return taskIntentId === intentId;
                return this._intentIdFromTask(task) === intentId;
            });
            if (t) {
                evidence.push(`queueActive=${t.id}:${t.status}`);
                targetStatus = t.status === 'in-flight'
                    ? TRANSPORT_INTENT_STATUS.DISPATCHING
                    : (targetStatus ?? TRANSPORT_INTENT_STATUS.PLANNED);
            }
        }

        if (queue?.getHistory) {
            const recent = (queue.getHistory() ?? [])
                .filter((t) => t?.type === TASK_TYPE.TRANSPORT)
                .slice(-25);
            const recentEquivalent = recent.find((t) => {
                const taskIntentId = t?.payload?.intentId;
                if (taskIntentId) return taskIntentId === intentId;
                return this._intentIdFromTask(t) === intentId;
            });
            if (recentEquivalent) {
                evidence.push(`historyRecent=${recentEquivalent.id}:${recentEquivalent.status}`);
                if (recentEquivalent.status === 'done') {
                    targetStatus = TRANSPORT_INTENT_STATUS.DELIVERED;
                }
            }
        }

        const queueReservations = queue?.getTransportReservations?.() ?? [];
        const reservation = queueReservations.find((r) =>
            Number(r?.toCityId) === Number(toCityId)
            && String(r?.resource) === String(resource)
            && String(r?.purpose) === String(purpose)
        );
        if (reservation) {
            evidence.push(`queueReservation=${reservation.amount}`);
            targetStatus = targetStatus ?? TRANSPORT_INTENT_STATUS.PLANNED;
        }

        const state = this._state;
        const movements = state?.fleetMovements ?? [];
        const matchingMovements = movements.filter((m) => {
            if (!m?.isOwn || m?.isReturn) return false;
            const from = Number(m.originCityId ?? m.sourceCityId ?? NaN);
            const to = Number(m.targetCityId ?? m.destinationCityId ?? NaN);
            const cargoQty = Number(m?.cargo?.[resource] ?? 0);
            return from === Number(fromCityId) && to === Number(toCityId) && cargoQty > 0;
        });
        if (matchingMovements.length > 0) {
            const anyLoading = matchingMovements.some((m) => _isLoadingState(m));
            evidence.push(anyLoading ? 'fleetMovement=loading' : 'fleetMovement=moving');
            targetStatus = anyLoading
                ? TRANSPORT_INTENT_STATUS.CONFIRMED_LOADING
                : TRANSPORT_INTENT_STATUS.CONFIRMED_MOVING;
        }

        const inTransitQty = Number(state?.getInTransit?.(toCityId)?.[resource] ?? 0);
        if (inTransitQty > 0) {
            evidence.push(`inTransitToDestination=${inTransitQty}`);
            if (!targetStatus || STATUS_RANK[targetStatus] < STATUS_RANK[TRANSPORT_INTENT_STATUS.CONFIRMED_MOVING]) {
                targetStatus = TRANSPORT_INTENT_STATUS.CONFIRMED_MOVING;
            }
        }

        const hasEvidence = evidence.length > 0;
        if (hasEvidence) {
            const updated = this._records.get(intentId) ?? {
                intentId,
                purpose,
                fromCityId: Number(fromCityId),
                toCityId: Number(toCityId),
                resource,
                amountBucket: TransportIntentRegistry.amountBucket(amount),
                createdAt: Date.now(),
                status: TRANSPORT_INTENT_STATUS.PLANNED,
                evidence: [],
                updatedAt: Date.now(),
            };
            this._records.set(intentId, updated);
            this._touch(updated, {
                status: targetStatus ?? updated.status,
                evidence,
            });
            this._persist();
        }

        const blockingStatuses = new Set([
            TRANSPORT_INTENT_STATUS.PLANNED,
            TRANSPORT_INTENT_STATUS.DISPATCHING,
            TRANSPORT_INTENT_STATUS.CONFIRMED_LOADING,
            TRANSPORT_INTENT_STATUS.CONFIRMED_MOVING,
        ]);

        const currentStatus = this._records.get(intentId)?.status ?? null;
        return {
            intentId,
            hasEvidence,
            evidence,
            status: currentStatus,
            shouldSkipEnqueue: hasEvidence && blockingStatuses.has(currentStatus),
        };
    }

    _intentIdFromTask(task) {
        const payload = task?.payload ?? {};
        const purpose = TransportIntentRegistry.resolvePurpose(payload);
        const { resource, amount } = TransportIntentRegistry.resolveMainCargo(payload.cargo ?? {});
        return TransportIntentRegistry.buildIntentId({
            purpose,
            fromCityId: Number(payload.fromCityId ?? task?.cityId ?? NaN),
            toCityId: Number(payload.toCityId ?? NaN),
            resource,
            amount,
        });
    }

    _mark(intentId, status, evidence = [], { force = false } = {}) {
        if (!intentId) return;
        const record = this._records.get(intentId);
        if (!record) return;
        this._touch(record, { status, evidence, force });
        this._persist();
    }

    _touch(record, { status, evidence = [], force = false } = {}) {
        const now = Date.now();
        const nextStatus = status ?? record.status;
        const shouldTransition = force || this._canTransition(record.status, nextStatus);
        if (shouldTransition) record.status = nextStatus;
        record.updatedAt = now;
        record.expiresAt = now + this._ttlMs;
        if (Array.isArray(evidence) && evidence.length > 0) {
            record.evidence = [
                ...(Array.isArray(record.evidence) ? record.evidence : []),
                ...evidence,
            ].slice(-30);
        }
    }

    _canTransition(current, next) {
        if (!current || !next) return false;
        if (current === next) return true;
        if (next === TRANSPORT_INTENT_STATUS.FAILED || next === TRANSPORT_INTENT_STATUS.EXPIRED) return true;
        if (current === TRANSPORT_INTENT_STATUS.FAILED || current === TRANSPORT_INTENT_STATUS.EXPIRED) return false;
        const currentRank = STATUS_RANK[current] ?? 0;
        const nextRank = STATUS_RANK[next] ?? 0;
        return nextRank >= currentRank;
    }

    _expireOld(now = Date.now()) {
        for (const [intentId, record] of this._records.entries()) {
            if ((record?.expiresAt ?? 0) > now) continue;
            if (ACTIVE_STATUSES.has(record?.status)) {
                record.status = TRANSPORT_INTENT_STATUS.EXPIRED;
                record.updatedAt = now;
                record.evidence = [
                    ...(Array.isArray(record.evidence) ? record.evidence : []),
                    'expiredByTTL=true',
                ].slice(-30);
            }
        }

        if (this._records.size <= this._maxRecords) return;
        const sorted = [...this._records.values()]
            .sort((a, b) => Number(a?.updatedAt ?? 0) - Number(b?.updatedAt ?? 0));
        const overflow = this._records.size - this._maxRecords;
        for (let i = 0; i < overflow; i++) {
            this._records.delete(sorted[i]?.intentId);
        }
    }

    async _persist() {
        this._expireOld();
        const payload = {
            savedAt: Date.now(),
            records: [...this._records.values()],
        };
        await this._storage?.set?.(STORAGE_KEY, payload).catch(() => {
            this._audit?.warn?.('TransportIntentRegistry', 'persist falhou');
        });
    }
}

