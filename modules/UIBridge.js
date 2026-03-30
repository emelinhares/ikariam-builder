// UIBridge.js — transforma estado interno em UIState para o painel
// Desacopla panel.js de StateManager, TaskQueue e Audit.
// panel.js nunca toca em StateManager diretamente — só lê UIState via Events.

import { nanoid } from './utils.js';
import { getCost } from '../data/buildings.js';

export class UIBridge {
    constructor({ events, state, queue, audit, config, dc }) {
        this._events = events;
        this._state  = state;
        this._queue  = queue;
        this._audit  = audit;
        this._config = config;
        this._dc     = dc;           // DataCollector — para setRecMode
        this._alerts = [];           // Alert[]
        this._rebuildTimer = null;

        // Estado do último teste manual
        this._testResult   = null;   // { id, status, summary, error, elapsedMs, startedAt }
        this._testTaskId   = null;   // id da task de teste em andamento

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

        // Atualizar testResult quando task de teste concluir
        this._events.on(E.QUEUE_TASK_DONE, ({ task }) => {
            if (this._testTaskId && task.id === this._testTaskId) {
                this._testResult = {
                    ...this._testResult,
                    status:    'done',
                    elapsedMs: Date.now() - (this._testResult?.startedAt ?? Date.now()),
                };
                this._testTaskId = null;
                this._schedRebuild();
            }
        });
        this._events.on(E.QUEUE_TASK_FAILED, ({ task, error }) => {
            if (this._testTaskId && task.id === this._testTaskId) {
                this._testResult = {
                    ...this._testResult,
                    status:    'failed',
                    error:     error ?? 'Erro desconhecido',
                    elapsedMs: Date.now() - (this._testResult?.startedAt ?? Date.now()),
                };
                this._testTaskId = null;
                this._schedRebuild();
            }
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
                pending:   allTasks.filter(t => t.status === 'pending'   || t.status === 'planned'),
                inFlight:  allTasks.filter(t => t.status === 'in-flight' || t.status === 'blocked'),
                completed: this._queue.getHistory().slice(-20),
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
            },
            testResult: this._testResult,
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

            case 'testTransport': {
                const fromCity = this._state.getCity(Number(cmd.fromCityId));
                const toCity   = this._state.getCity(Number(cmd.toCityId));
                if (!fromCity || !toCity) {
                    this._testResult = { status: 'error', summary: 'Cidade inválida', error: `from=${cmd.fromCityId} to=${cmd.toCityId}` };
                    this._schedRebuild();
                    break;
                }
                if (!toCity.islandId) {
                    this._testResult = { status: 'error', summary: `islandId de ${toCity.name} desconhecido — aguarde fetch de dados`, error: null };
                    this._schedRebuild();
                    break;
                }
                const qty   = Number(cmd.qty) || 500;
                const boats = Math.ceil(qty / 500);
                const task  = this._queue.add({
                    type:   'TRANSPORT',
                    priority: 0,
                    cityId: fromCity.id,
                    payload: {
                        fromCityId:  fromCity.id,
                        toCityId:    toCity.id,
                        toIslandId:  toCity.islandId,
                        cargo:       { [cmd.resource]: qty },
                        boats,
                        totalCargo:  qty,
                    },
                    scheduledFor: Date.now(),
                    reason:      `TESTE: ${qty} ${cmd.resource} de ${fromCity.name} → ${toCity.name}`,
                    module:      'TEST',
                    maxAttempts: 1,
                });
                this._testTaskId = task.id;
                this._testResult = { id: task.id, status: 'pending', startedAt: Date.now(),
                    summary: `TRANSPORT ${qty} ${cmd.resource}: ${fromCity.name} → ${toCity.name} (${boats} navio(s))` };
                this._audit.info('UIBridge', `Teste transporte: ${task.id} — ${this._testResult.summary}`);
                this._schedRebuild();
                break;
            }

            case 'testBuild': {
                const city = this._state.getCity(Number(cmd.cityId));
                if (!city) {
                    this._testResult = { status: 'error', summary: `Cidade ${cmd.cityId} não encontrada`, error: null };
                    this._schedRebuild();
                    break;
                }
                // Filtrar edifícios com tabela de custo, não-especiais, sem construção ativa
                const SKIP = new Set(['buildingGround land', 'buildingGround sea', 'buildingGround dockyard',
                    'buildingGround', 'pirateFortress', 'chronosForge', 'shrineOflympus', 'shrineOfOlympus',
                    'dump', 'wall', 'palaceColony', 'palace']);
                const candidates = (city.buildings || []).filter(b => {
                    if (!b.building || b.building.includes('buildingGround') || b.building.includes('constructionSite')) return false;
                    if (SKIP.has(b.building)) return false;
                    try { const c = getCost(b.building, b.level + 1); return c && Object.keys(c).length > 0; }
                    catch { return false; }
                });
                if (!candidates.length) {
                    const allBuildings = (city.buildings || [])
                        .map(b => b.building || '(vazio)')
                        .filter(b => b !== '(vazio)');
                    this._audit.warn('UIBridge',
                        `testBuild: nenhum candidato em ${city.name}. Edifícios encontrados: ${allBuildings.join(', ') || '(nenhum — estado vazio)'}`
                    );
                    this._testResult = { status: 'error', summary: `Nenhum edifício com tabela de custo em ${city.name} — ver log para detalhes`, error: null };
                    this._schedRebuild();
                    break;
                }
                const pick = candidates[Math.floor(Math.random() * candidates.length)];
                const cost = getCost(pick.building, pick.level + 1);
                const task = this._queue.add({
                    type:     'BUILD',
                    priority: 0,
                    cityId:   city.id,
                    payload: {
                        building:     pick.building,
                        position:     pick.position,
                        buildingView: pick.building,
                        templateView: pick.building,
                        cost,
                        toLevel:      pick.level + 1,
                    },
                    scheduledFor: Date.now(),
                    reason:      `TESTE: ${pick.building} lv${pick.level}→${pick.level + 1} em ${city.name}`,
                    module:      'TEST',
                    maxAttempts: 1,
                });
                this._testTaskId = task.id;
                this._testResult = { id: task.id, status: 'pending', startedAt: Date.now(),
                    summary: `BUILD ${pick.building} lv${pick.level}→${pick.level + 1} em ${city.name} (pos ${pick.position})` };
                this._audit.info('UIBridge', `Teste build: ${task.id} — ${this._testResult.summary}`);
                this._schedRebuild();
                break;
            }
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
        };
    }
}
