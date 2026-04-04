import { TASK_TYPE } from './taskTypes.js';

export class TaskOutcomeTracker {
    constructor({ events, audit, state, client, isCriticalOutcomeTask, countRelevantTransportMovements }) {
        this._events = events;
        this._audit = audit;
        this._state = state;
        this._client = client;
        this._isCriticalOutcomeTask = isCriticalOutcomeTask;
        this._countRelevantTransportMovements = countRelevantTransportMovements;
    }

    _captureHybridPathDecision(task, decision, normalizeRouteConfidence) {
        const payload = {
            taskId: task.id,
            cityId: task.cityId,
            actionType: task.type,
            decision: {
                ts: Date.now(),
                preferredPath: decision.preferredPath ?? 'endpoint',
                pathDecision: decision.pathDecision ?? 'endpoint',
                decisionReason: decision.decisionReason ?? 'UNSPECIFIED',
                dataProvenance: Array.isArray(decision.dataProvenance) ? decision.dataProvenance : ['endpoint'],
                contextLock: decision.contextLock ?? { locked: true },
                tokenSnapshot: decision.tokenSnapshot ?? null,
                routeConfidence: decision.routeConfidence ?? normalizeRouteConfidence(task.confidence),
            },
        };
        task.pathDecision = payload.decision;
        const ev = this._events?.E?.HYBRID_PATH_DECIDED;
        if (ev) this._events.emit(ev, payload);
        return payload.decision;
    }

    _createTaskOutcome(task, { executionStartedAt, outcomeClass, reasonCode, evidence, nextStep } = {}) {
        return {
            taskId: task.id,
            taskType: task.type,
            type: task.type,
            cityId: task.cityId,
            timestamp: Date.now(),
            latencyMs: Math.max(0, Date.now() - Number(executionStartedAt ?? Date.now())),
            outcomeClass,
            reasonCode: reasonCode ?? null,
            evidence: Array.isArray(evidence) ? evidence : [],
            nextStep: nextStep ?? 'none',
        };
    }

    _recordTaskOutcome(task, outcome) {
        if (!task || !outcome) return outcome;
        task.lastOutcome = outcome;
        task.outcomeHistory = [
            ...(Array.isArray(task.outcomeHistory) ? task.outcomeHistory : []),
            outcome,
        ].slice(-10);

        const ev = this._events?.E?.QUEUE_TASK_OUTCOME;
        if (ev) this._events.emit(ev, { task, outcome });

        const line = `${task.type} outcome=${outcome.outcomeClass} reason=${outcome.reasonCode ?? 'N/A'}`;
        if (outcome.outcomeClass === 'failed') this._audit.error('TaskOutcome', line, outcome, task.cityId);
        else if (outcome.outcomeClass === 'inconclusive' || outcome.outcomeClass === 'guard_reschedule') this._audit.warn('TaskOutcome', line, outcome, task.cityId);
        else this._audit.info('TaskOutcome', line, outcome, task.cityId);

        return outcome;
    }

    async _postValidateTaskOutcome(task, { validationBaseline, executionStartedAt, dispatchResult = null } = {}) {
        if (!this._isCriticalOutcomeTask(task)) {
            return this._createTaskOutcome(task, {
                executionStartedAt,
                outcomeClass: 'success',
                reasonCode: 'TASK_NON_CRITICAL_DISPATCH_OK',
                evidence: ['nonCriticalTask=true'],
                nextStep: 'none',
            });
        }

        switch (task.type) {
            case TASK_TYPE.BUILD:
                return await this._validateBuildOutcome(task, validationBaseline, executionStartedAt);
            case TASK_TYPE.TRANSPORT:
                return await this._validateTransportOutcome(task, validationBaseline, executionStartedAt);
            case TASK_TYPE.WINE_ADJUST:
                return await this._validateWineAdjustOutcome(task, validationBaseline, executionStartedAt, dispatchResult);
            case TASK_TYPE.WORKER_REALLOC:
                return await this._validateWorkerReallocOutcome(task, validationBaseline, executionStartedAt, dispatchResult);
            default:
                return this._createTaskOutcome(task, {
                    executionStartedAt,
                    outcomeClass: 'inconclusive',
                    reasonCode: 'POST_VALIDATION_TYPE_UNSUPPORTED',
                    evidence: [`type=${task.type}`],
                    nextStep: 'retry',
                });
        }
    }

    async _validateBuildOutcome(task, baseline, executionStartedAt) {
        const evidence = [];
        try { await this._client.probeCityData(task.cityId); evidence.push('probeCityData=ok'); }
        catch (err) { evidence.push(`probeCityData=error:${err.message}`); }
        const city = this._state.getCity?.(task.cityId) ?? null;
        const expectedPos = Number(task.payload?.position);
        const slot = city?.buildings?.find?.(b => Number(b?.position) === expectedPos) ?? null;
        const nowUC = Number(city?.underConstruction ?? -1);
        const nowLevel = Number(slot?.level ?? -1);
        evidence.push(`underConstructionBefore=${baseline?.build?.underConstruction ?? 'N/A'}`);
        evidence.push(`underConstructionAfter=${city?.underConstruction ?? 'N/A'}`);
        evidence.push(`slotLevelBefore=${baseline?.build?.level ?? 'N/A'}`);
        evidence.push(`slotLevelAfter=${nowLevel}`);

        const hasUpgradeEvidence = nowUC === expectedPos || slot?.isUpgrading === true || (Number.isFinite(nowLevel) && nowLevel > Number(baseline?.build?.level ?? -1));
        return this._createTaskOutcome(task, {
            executionStartedAt,
            outcomeClass: hasUpgradeEvidence ? 'success' : 'inconclusive',
            reasonCode: hasUpgradeEvidence ? 'BUILD_STATE_CONFIRMED' : 'BUILD_POST_STATE_NOT_CONFIRMED',
            evidence,
            nextStep: hasUpgradeEvidence ? 'none' : 'retry',
        });
    }

    async _validateTransportOutcome(task, baseline, executionStartedAt) {
        const evidence = [];
        try { await this._client.fetchMilitaryAdvisor(); evidence.push('fetchMilitaryAdvisor=ok'); }
        catch (err) { evidence.push(`fetchMilitaryAdvisor=error:${err.message}`); }
        const before = Number(baseline?.transportCount ?? 0);
        const after = this._countRelevantTransportMovements(task);
        evidence.push(`transportCountBefore=${before}`);
        evidence.push(`transportCountAfter=${after}`);
        return this._createTaskOutcome(task, {
            executionStartedAt,
            outcomeClass: after > before ? 'success' : 'inconclusive',
            reasonCode: after > before ? 'TRANSPORT_MOVEMENT_CONFIRMED' : 'TRANSPORT_POST_STATE_NOT_CONFIRMED',
            evidence,
            nextStep: after > before ? 'none' : 'retry',
        });
    }

    async _validateWineAdjustOutcome(task, baseline, executionStartedAt, dispatchResult = null) {
        const evidence = [];
        const tokenRotated = !!dispatchResult?.tokenRotated;
        const deterministicRefusal = !!dispatchResult?.deterministicRefusal;
        const refusalReasonCode = dispatchResult?.refusalReasonCode ?? null;
        const refusalMessage = dispatchResult?.refusalMessage ?? null;
        evidence.push(`actionRequestRotated=${tokenRotated}`);
        evidence.push(`deterministicRefusal=${deterministicRefusal}`);
        if (refusalReasonCode) evidence.push(`refusalReasonCode=${refusalReasonCode}`);
        if (refusalMessage) evidence.push(`refusalMessage=${refusalMessage}`);

        if (deterministicRefusal) {
            return this._createTaskOutcome(task, {
                executionStartedAt,
                outcomeClass: 'failed',
                reasonCode: refusalReasonCode ?? 'SERVER_REFUSED_INSUFFICIENT_RESOURCES',
                evidence,
                nextStep: 'cancel',
            });
        }

        try { await this._client.probeCityData(task.cityId); evidence.push('probeCityData=ok'); }
        catch (err) { evidence.push(`probeCityData=error:${err.message}`); }
        const city = this._state.getCity?.(task.cityId) ?? null;
        const before = Number(baseline?.wineLevel ?? NaN);
        const after = Number(city?.tavern?.wineLevel ?? NaN);
        evidence.push(`wineLevelBefore=${Number.isFinite(before) ? before : 'N/A'}`);
        evidence.push(`wineLevelAfter=${Number.isFinite(after) ? after : 'N/A'}`);
        const stateChanged = Number.isFinite(before) && Number.isFinite(after) && before !== after;
        const success = stateChanged && tokenRotated;
        return this._createTaskOutcome(task, {
            executionStartedAt,
            outcomeClass: success ? 'success' : 'inconclusive',
            reasonCode: success ? 'WINE_LEVEL_CHANGED_WITH_TOKEN_ROTATION' : (!stateChanged ? 'WINE_LEVEL_UNCHANGED' : 'WINE_ACTIONREQUEST_NOT_ROTATED'),
            evidence,
            nextStep: success ? 'none' : 'retry',
        });
    }

    async _validateWorkerReallocOutcome(task, baseline, executionStartedAt, dispatchResult = null) {
        const evidence = [];
        const tokenRotated = !!dispatchResult?.tokenRotated;
        evidence.push(`actionRequestRotated=${tokenRotated}`);
        try { await this._client.probeCityData(task.cityId); evidence.push('probeCityData=ok'); }
        catch (err) { evidence.push(`probeCityData=error:${err.message}`); }
        const city = this._state.getCity?.(task.cityId) ?? null;
        const before = Number(baseline?.scientists ?? NaN);
        const after = Number(city?.workers?.scientists ?? NaN);
        evidence.push(`scientistsBefore=${Number.isFinite(before) ? before : 'N/A'}`);
        evidence.push(`scientistsAfter=${Number.isFinite(after) ? after : 'N/A'}`);
        const stateChanged = Number.isFinite(before) && Number.isFinite(after) && before !== after;
        const success = stateChanged && tokenRotated;
        return this._createTaskOutcome(task, {
            executionStartedAt,
            outcomeClass: success ? 'success' : 'inconclusive',
            reasonCode: success ? 'WORKER_ALLOCATION_CHANGED_WITH_TOKEN_ROTATION' : (!stateChanged ? 'WORKER_ALLOCATION_UNCHANGED' : 'WORKER_ACTIONREQUEST_NOT_ROTATED'),
            evidence,
            nextStep: success ? 'none' : 'retry',
        });
    }
}

