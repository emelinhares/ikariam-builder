// UIBridge.js — transforma estado interno em UIState para o painel
// Desacopla panel.js de StateManager, TaskQueue e Audit.
// panel.js nunca toca em StateManager diretamente — só lê UIState via Events.

import { nanoid } from './utils.js';

export class UIBridge {
    constructor({ events, state, queue, audit, config, dc, healthCheck = null }) {
        this._events = events;
        this._state  = state;
        this._queue  = queue;
        this._audit  = audit;
        this._config = config;
        this._dc     = dc;           // DataCollector — para setRecMode
        this._healthCheck = healthCheck;
        this._alerts = [];           // Alert[]
        this._rebuildTimer = null;
        this._hybridLatest = new Map(); // taskId -> { pathDecision?, attemptOutcome? }

        // REC mode
        this._recMode   = false;
        this._prevMode  = null;      // modo antes de ativar REC
    }

    init() {
        const E   = this._events.E;
        const sched = () => this._schedRebuild();

        // Rebuild com debounce 100ms para absorver cascata de eventos
        this._events.on(E.STATE_CITY_UPDATED,  sched);
        this._events.on(E.STATE_ALL_FRESH,     sched);
        this._events.on(E.QUEUE_TASK_ADDED,    sched);
        this._events.on(E.QUEUE_TASK_DONE,     sched);
        this._events.on(E.QUEUE_TASK_FAILED,   sched);
        this._events.on(E.QUEUE_MODE_CHANGED,  sched);
        this._events.on(E.AUDIT_ENTRY_ADDED,   sched);
        this._events.on(E.AUDIT_ERROR_ADDED, ({ entry }) => {
            this._addAlert('P1', entry?.module ?? 'Audit', `Erro capturado: ${entry?.message ?? 'desconhecido'}`, entry?.cityId ?? null);
            sched();
        });

        this._events.on(E.HEALTHCHECK_UPDATED, sched);
        this._events.on(E.HYBRID_PATH_DECIDED, ({ taskId, decision } = {}) => {
            if (!taskId) return;
            const cur = this._hybridLatest.get(taskId) ?? {};
            this._hybridLatest.set(taskId, { ...cur, pathDecision: decision });
            sched();
        });
        this._events.on(E.HYBRID_ATTEMPT_OUTCOME, ({ taskId, outcome } = {}) => {
            if (!taskId) return;
            const cur = this._hybridLatest.get(taskId) ?? {};
            this._hybridLatest.set(taskId, { ...cur, attemptOutcome: outcome });
            sched();
        });

        // Alertas — sem debounce (imediatos)
        this._events.on(E.HR_WINE_EMERGENCY, d =>
            this._addAlert('P0', 'HR', `Vinho crítico: ${d.hoursLeft?.toFixed(1)}h`, d.cityId)
        );
        this._events.on(E.CSO_CAPITAL_RISK, d =>
            this._addAlert('P1', 'CSO', `Capital em risco: ${d.atRisk?.toLocaleString()} unidades`, d.cityId)
        );
        this._events.on(E.QUEUE_BLOCKED, d =>
            this._addAlert('P1', 'Queue', d.reason, null)
        );
        this._events.on(E.QUEUE_TASK_FAILED, ({ task, error, fatal }) => {
            if (fatal) this._addAlert('P1', 'Queue', `Task falhou (fatal): ${error}`, task?.cityId);
        });
        this._events.on(E.UI_ALERT_RESOLVED, ({ alertId }) => {
            const a = this._alerts.find(x => x.id === alertId);
            if (a) { a.resolved = true; sched(); }
        });

        // Comandos da UI
        this._events.on(E.UI_COMMAND, cmd => this._handleCommand(cmd));

        // Rebuild inicial para popular o painel logo após init
        this._schedRebuild();
    }

    // ── Build e emissão ───────────────────────────────────────────────────────

    _schedRebuild() {
        clearTimeout(this._rebuildTimer);
        this._rebuildTimer = setTimeout(() => this._rebuild(), 100);
    }

    _rebuild() {
        const uiState = this._buildUIState();
        this._lastUiState = uiState;
        this._events.emit(this._events.E.UI_STATE_UPDATED, uiState);
    }

    _buildUIState() {
        const mode     = this._config.get('operationMode');
        const cities   = this._state.getAllCities();
        const allTasks = [
            ...this._queue.getPending(),
            ...this._queue.getHistory(),
        ];
        const nextAction = this._buildNextAction(allTasks);

        return {
            bot: {
                status:     this._calcBotStatus(),
                mode,
                confidence: this._calcGlobalConfidence(cities),
                lastSync:   this._state.lastFullRefresh,
                alertCount: this._alerts.filter(a => !a.resolved).length,
                activeCity: this._state.getActiveCityId(),
            },
            alerts: [...this._alerts].filter(a => !a.resolved).slice(0, 10),
            nextAction,
            queue: {
                pending:   allTasks.filter(t => t.status === 'pending'   || t.status === 'planned').map(t => this._withHybridTaskMeta(t)),
                inFlight:  allTasks.filter(t => t.status === 'in-flight' || t.status === 'blocked').map(t => this._withHybridTaskMeta(t)),
                completed: this._queue.getHistory().slice(-20).map(t => this._withHybridTaskMeta(t)),
            },
            cities: cities.map(c => ({
                id:               c.id,
                name:             c.name,
                tradegood:        c.tradegood,
                islandId:         c.islandId,
                health:           this._cityHealth(c),
                confidence:       this._state.getConfidence(c.id),
                dataAgeMs:        c.fetchedAt ? Date.now() - c.fetchedAt : null,
                isActive:         c.id === this._state.getActiveCityId(),
                isCapital:        c.isCapital,
                resources:        { ...c.resources },
                maxResources:     c.maxResources,
                goldPerHour:      c.economy.goldPerHour,
                corruption:       c.economy.corruption,
                construction:     this._buildConstructionInfo(c),
                freeTransporters: c.freeTransporters,
            })),
            cityDetail: null,
            fleetMovements: this._buildFleetMovements(),
            logs: this._audit.getEntries().slice(-100),
            errorTelemetry: {
                recent: this._audit.getErrorEntries().slice(-50),
                stats1h: this._audit.getErrorStats({ since: Date.now() - 60 * 60_000 }),
                hybrid: this._audit.getHybridStats?.() ?? null,
            },
            healthCheck: this._healthCheck?.getState?.() ?? null,
            recMode: this._recMode,
        };
    }

    // ── Alertas ───────────────────────────────────────────────────────────────

    _addAlert(level, module, message, cityId) {
        // Deduplicar: não adicionar alerta igual nos últimos 60s
        const recent = this._alerts.find(a =>
            !a.resolved &&
            a.module === module &&
            a.cityId === (cityId ?? null) &&
            Date.now() - a.ts < 60_000
        );
        if (recent) return;

        const alert = {
            id:       nanoid(6),
            level,
            module,
            message,
            cityId:   cityId ?? null,
            ts:       Date.now(),
            resolved: false,
        };
        this._alerts.unshift(alert);
        if (this._alerts.length > 50) this._alerts.pop();
        this._events.emit(this._events.E.UI_ALERT_ADDED, alert);
    }

    resolveAlert(alertId) {
        const a = this._alerts.find(x => x.id === alertId);
        if (a) {
            a.resolved = true;
            this._events.emit(this._events.E.UI_ALERT_RESOLVED, { alertId });
        }
    }

    // ── Comandos da UI ────────────────────────────────────────────────────────

    _handleCommand(cmd) {
        switch (cmd.type) {
            case 'setMode':
                this._queue.setMode(cmd.mode).catch(() => {});
                break;
            case 'cancelTask':
                this._queue.cancel(cmd.taskId);
                break;
            case 'resolveAlert':
                this.resolveAlert(cmd.alertId);
                break;
            case 'forceRefresh':
                this._events.emit(this._events.E.STATE_ALL_FRESH, { ts: Date.now(), forced: true });
                break;

            case 'setRec': {
                const active = !!cmd.active;
                if (active === this._recMode) break;
                this._recMode = active;
                if (active) {
                    this._prevMode = this._config.get('operationMode');
                    this._queue.setMode('MANUAL').catch(() => {});
                } else {
                    if (this._prevMode && this._prevMode !== 'MANUAL') {
                        this._queue.setMode(this._prevMode).catch(() => {});
                    }
                    this._prevMode = null;
                }
                this._dc?.setRecMode(active);
                this._schedRebuild();
                break;
            }

            case 'startHealthCheck': {
                const res = this._healthCheck?.start?.({ suite: cmd.suite ?? 'full' });
                if (!res?.ok) {
                    this._audit.warn('UIBridge', `HealthCheck start bloqueado: ${res?.message ?? res?.code ?? 'erro desconhecido'}`);
                }
                this._schedRebuild();
                break;
            }

            case 'abortHealthCheck':
                this._healthCheck?.abort?.();
                this._schedRebuild();
                break;

            case 'exportHealthCheckReport':
                this._healthCheck?.exportReport?.({ format: cmd.format ?? 'both' });
                this._schedRebuild();
                break;
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _calcBotStatus() {
        if (this._config.get('operationMode') === 'MANUAL') return 'MANUAL';
        if (this._alerts.some(a => !a.resolved && a.level === 'P0')) return 'DEGRADED';
        if (!this._state._ready) return 'INITIALIZING';
        return 'RUNNING';
    }

    _calcGlobalConfidence(cities) {
        if (!cities.length) return 'UNKNOWN';
        const levels = cities.map(c => this._state.getConfidence(c.id));
        if (levels.every(l => l === 'HIGH'))  return 'HIGH';
        if (levels.some(l  => l === 'LOW'))   return 'LOW';
        return 'MEDIUM';
    }

    _cityHealth(city) {
        if (this._state.getConfidence(city.id) === 'LOW') return 'red';
        if ((city.economy.corruption ?? 0) > 0)           return 'yellow';
        return 'green';
    }

    _buildFleetMovements() {
        return (this._state.fleetMovements ?? []).map(m => ({
            id:        m.id ?? Math.random(),
            type:      m.missionType ?? '?',
            from:      m.originCityName ?? `cidade ${m.originCityId}`,
            to:        m.targetCityName ?? `cidade ${m.targetCityId}`,
            arrivesAt: m.eventTime ? Number(m.eventTime) * 1000 : null,
            cargo:     m.cargo ?? null,
            ships:     m.ships ?? null,
            isReturn:  !!(m.isReturn),
            isOwn:     !!(m.isOwn),
        }));
    }

    _buildConstructionInfo(city) {
        const ucIdx = this._state.getUnderConstruction(city.id);
        if (ucIdx === -1) return null;

        const slot = Array.isArray(city.buildings) ? city.buildings[ucIdx] : null;
        if (!slot) return { building: '?', level: 0, completesAt: null };

        return {
            building:   slot.building || '?',
            level:      slot.level ?? 0,
            completesAt: slot.completed ? slot.completed * 1000 : null, // seconds → ms
        };
    }

    _buildNextAction(tasks) {
        const pending = tasks
            .filter(t => t.status === 'pending' && t.scheduledFor <= Date.now() + 300_000)
            .sort((a, b) => a.priority - b.priority || a.scheduledFor - b.scheduledFor)[0];

        if (!pending) return null;

        const cityName = this._state.getCity(pending.cityId)?.name ?? `cidade ${pending.cityId}`;
        const hybridMeta = this._hybridLatest.get(pending.id) ?? {};
        return {
            type:       pending.type,
            cityId:     pending.cityId,
            cityName,
            summary:    `${pending.type} — ${cityName}`,
            reason:     pending.reason,
            module:     pending.module,
            confidence: pending.confidence,
            eta:        pending.scheduledFor,
            blocked:    pending.status === 'blocked',
            hybrid: {
                pathUsed: hybridMeta.attemptOutcome?.pathUsed ?? hybridMeta.pathDecision?.pathDecision ?? null,
                outcomeClass: hybridMeta.attemptOutcome?.outcomeClass ?? null,
                blockerCode: hybridMeta.attemptOutcome?.reasonCode ?? pending.lastBlockerCode ?? null,
                ambiguous: hybridMeta.attemptOutcome?.outcomeClass === 'fallback-triggered'
                    || hybridMeta.attemptOutcome?.outcomeClass === 'guard-reschedule',
            },
        };
    }

    _withHybridTaskMeta(task) {
        const hybridMeta = this._hybridLatest.get(task.id) ?? {};
        return {
            ...task,
            hybrid: {
                pathDecision: hybridMeta.pathDecision ?? task.pathDecision ?? null,
                attemptOutcome: hybridMeta.attemptOutcome ?? task.lastAttemptOutcome ?? null,
                blockerCode: hybridMeta.attemptOutcome?.reasonCode ?? task.lastBlockerCode ?? null,
            },
        };
    }
}
