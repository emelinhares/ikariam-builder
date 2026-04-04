// Planner.js — orquestrador do ciclo de decisão do ERP
//
// Único listener de STATE_ALL_FRESH. Executa os módulos em sequência,
// passando um PlannerContext compartilhado entre eles:
//
//   Fase 1 — SUSTENTO (HR)
//     Vinho crítico e felicidade negativa têm prioridade absoluta.
//     HR cria WINE_ADJUST e marca wineEmergencyHandled no contexto.
//
//   Fase 2 — CAPACIDADE (COO)
//     Recalcula hub, verifica overflow, agenda transportes.
//     COO atualiza pendingTransports no contexto por cidade.
//
//   Fase 3 — INFRAESTRUTURA (CFO)
//     Avalia o que construir, respeitando buildBlocked do contexto.
//     buildBlocked = true para qualquer cidade com emergência de sustento.
//
//   Fase 4 — PESQUISA (CTO)
//     Enfileira pesquisa se há academia disponível.
//
//   Fase 5 — SEGURANÇA + DETECÇÃO (CSO + MnA)
//     Verifica capital em risco e novas cidades. Sem dependência de fase.
//
// PlannerContext por cidade:
//   wineHours            — horas de vinho restante
//   satisfaction         — economy.satisfaction atual
//   hasCriticalSupply    — wineHours < threshold OU satisfaction <= 0
//   pendingTransports    — transportes já na fila com destino a esta cidade
//   buildBlocked         — CFO não deve agir (hasCriticalSupply = true)
//   buildApprovedBy      — 'CFO' se build foi aprovado neste ciclo, null caso contrário
//   wineEmergencyHandled — HR já criou WINE_ADJUST emergencial
//
// Timers adaptativos:
//   Após cada ciclo, calcula quando o próximo evento relevante vai ocorrer
//   e agenda um wake-up antes dele — sem esperar o heartbeat completo.
//   Eventos monitorados:
//     - Vinho chegando ao threshold de emergência (wineHours → threshold)
//     - Construção terminando (city.underConstruction → completesAt)
//     - Transporte chegando (fleetMovements → arrivalTs)
//   Wake-ups reativos (fora do timer):
//     - QUEUE_TASK_DONE tipo BUILD → mini-ciclo imediato (CFO + COO)
//     - QUEUE_TASK_DONE tipo TRANSPORT → mini-ciclo imediato (HR + CFO)
//     - QUEUE_TASK_FAILED → mini-ciclo imediato (COO replaneja logística)

import { WINE_USE } from '../data/wine.js';
import { getWarehouseSafe } from '../data/effects.js';
import { detectEmpireStage } from './EmpireStage.js';
import { chooseGlobalGoal } from './GoalEngine.js';
import { evaluateGrowthPolicy } from './GrowthPolicy.js';
import { evaluateFleetPolicy } from './FleetPolicy.js';
import { evaluateWorkforcePolicy } from './WorkforcePolicy.js';
import { evaluateWineSustainPolicy } from './WineSustainPolicy.js';

// Delay de debounce para wake-ups reativos (evitar avalanche de eventos)
const REACTIVE_DEBOUNCE  = 10 * 1000;       // 10s após QUEUE_TASK_DONE

export class PlannerCityContext {
    constructor(data = {}) {
        this.wineHours = data.wineHours ?? Infinity;
        this.satisfaction = data.satisfaction ?? null;
        this.populationUsed = Number(data.populationUsed ?? 0);
        this.maxInhabitants = Number(data.maxInhabitants ?? 0);
        this.populationUtilization = Number(data.populationUtilization ?? 0);
        this.populationGrowthPerHour = Number(data.populationGrowthPerHour ?? 0);
        this.hasCriticalSupply = Boolean(data.hasCriticalSupply);
        this.wineBootstrapNeeded = Boolean(data.wineBootstrapNeeded);
        this.wineSustain = data.wineSustain ?? null;
        this.pendingTransports = Array.isArray(data.pendingTransports) ? data.pendingTransports : [];
        this.buildBlocked = Boolean(data.buildBlocked);
        this.buildApprovedBy = data.buildApprovedBy ?? null;
        this.wineEmergencyHandled = Boolean(data.wineEmergencyHandled);
        this.idlePopulation = data.idlePopulation;
        this.workforceUtilization = data.workforceUtilization;
        this.productionFloorMet = data.productionFloorMet;
        this.recommendedWorkersWood = data.recommendedWorkersWood;
        this.recommendedWorkersTradegood = data.recommendedWorkersTradegood;
        this.recommendedScientists = data.recommendedScientists;
        this.workforceBlockingFactors = data.workforceBlockingFactors;
        this.workforceReasons = data.workforceReasons;
    }

    markBuildBlocked() {
        this.buildBlocked = true;
    }

    markWineHandled({ wineBootstrapNeeded } = {}) {
        this.wineEmergencyHandled = true;
        if (wineBootstrapNeeded !== undefined) {
            this.wineBootstrapNeeded = Boolean(wineBootstrapNeeded);
        }
    }

    setBuildApprovedBy(moduleName) {
        this.buildApprovedBy = moduleName ?? null;
    }
}

export class Planner {
    constructor({ events, audit, config, state, queue, hr, cfo, coo, cto, cso, mna }) {
        this._events = events;
        this._audit  = audit;
        this._config = config;
        this._state  = state;
        this._queue  = queue;
        this._hr     = hr;
        this._cfo    = cfo;
        this._coo    = coo;
        this._cto    = cto;
        this._cso    = cso;
        this._mna    = mna;

        this._running        = false;   // proteção contra reentrância
        this._adaptiveTimer  = null;    // setTimeout do próximo wake-up adaptativo
        this._reactiveTimer  = null;    // setTimeout do wake-up reativo (debounced)
        this._lastCycleTs    = 0;       // timestamp do último ciclo concluído
        this._lastSummary    = null;
        this._lastContext    = null;
        this._unsubscribers  = [];
    }

    shutdown() {
        for (const unsub of this._unsubscribers.splice(0)) {
            try { unsub(); } catch { /* best-effort */ }
        }
        if (this._adaptiveTimer) {
            clearTimeout(this._adaptiveTimer);
            this._adaptiveTimer = null;
        }
        if (this._reactiveTimer) {
            clearTimeout(this._reactiveTimer);
            this._reactiveTimer = null;
        }
        this._audit.info('Planner', 'Planner shutdown — timers limpos');
    }

    _trackUnsub(unsub) {
        if (typeof unsub === 'function') this._unsubscribers.push(unsub);
    }

    getLastSummary() {
        return this._lastSummary ? { ...this._lastSummary } : null;
    }

    getLastContext() {
        if (!this._lastContext) return null;
        return {
            ...this._lastContext,
            cities: this._lastContext.cities instanceof Map
                ? new Map(this._lastContext.cities)
                : this._lastContext.cities,
        };
    }

    init() {
        const E = this._events.E;

        // Único listener de STATE_ALL_FRESH no sistema
        this._trackUnsub(this._events.on(E.STATE_ALL_FRESH, ({ ts }) => {
            this._onStateFresh(ts);
        }));

        // Wake-ups reativos: BUILD ou TRANSPORT concluído → mini-ciclo em 10s
        this._trackUnsub(this._events.on(E.QUEUE_TASK_DONE, ({ task }) => {
            if (task.type === 'BUILD' || task.type === 'TRANSPORT' || task.type === 'WINE_ADJUST') {
                this._scheduleReactiveCycle(task.type);
            }
        }));

        // Falha de task → replaneja logística imediatamente
        this._trackUnsub(this._events.on(E.QUEUE_TASK_FAILED, ({ task }) => {
            if (task.type === 'TRANSPORT' || task.type === 'BUILD' || task.type === 'WINE_ADJUST') {
                this._scheduleReactiveCycle(task.type, 'FAILED');
            }
        }));

        // Eventos de sustento críticos devem disparar replanejamento reativo.
        this._trackUnsub(this._events.on(E.HR_WINE_EMERGENCY, ({ cityId }) => {
            this._scheduleReactiveCycle('HR_WINE_EMERGENCY', `CITY_${cityId}`);
        }));
        this._trackUnsub(this._events.on(E.HR_WINE_ADJUSTED, ({ cityId }) => {
            this._scheduleReactiveCycle('HR_WINE_ADJUSTED', `CITY_${cityId}`);
        }));

        this._audit.info('Planner', 'Planner iniciado — timers adaptativos + wake-ups reativos ativos');
    }

    // ── Entrada do ciclo ──────────────────────────────────────────────────────

    _onStateFresh(ts) {
        if (this._running) {
            this._audit.debug('Planner', 'Ciclo anterior ainda em andamento — ignorando STATE_ALL_FRESH');
            return;
        }
        this._running = true;
        this.runCycle(ts)
            .catch(err => this._audit.error('Planner', `Erro no ciclo: ${err.message}`))
            .finally(() => { this._running = false; });
    }

    /** Executa um ciclo completo de decisão. Pode ser chamado externamente para forçar replan. */
    async replan() {
        await this.runCycle(Date.now());
    }

    // ── Timers adaptativos ────────────────────────────────────────────────────

    /**
     * Calcula o próximo evento relevante e agenda wake-up antecipado.
     * Chamado ao fim de cada ciclo com o contexto produzido.
     * Eventos monitorados (em ordem de prioridade):
     *   1. Vinho chegando ao threshold — acordar 5min antes
     *   2. Construção terminando — acordar 2min depois (para reavaliar próximo build)
     *   3. Transporte chegando — acordar 5min antes (para confirmar recursos)
     */
    _scheduleAdaptiveWakeup(ctx) {
        if (this._adaptiveTimer) {
            clearTimeout(this._adaptiveTimer);
            this._adaptiveTimer = null;
        }

        const now       = Date.now();
        const WAKE_LEAD_MS = this._config.get('plannerWakeLeadMs') ?? 5 * 60_000;
        const WAKE_MIN_INTERVAL = this._config.get('plannerWakeMinIntervalMs') ?? 2 * 60_000;
        const threshold = (this._config.get('wineEmergencyHours') ?? 4) * 3600 * 1000;
        let   nextWake  = Infinity;
        let   nextReason = '';

        // 1. Vinho chegando ao threshold
        for (const [cityId, cityCtx] of ctx.cities) {
            if (cityCtx.wineHours === Infinity) continue;
            const city = this._state.getCity(cityId);
            if (!city) continue;

            let spendings = city.production?.wineSpendings ?? 0;
            if (spendings <= 0 && (city.tavern?.wineLevel ?? 0) > 0) {
                spendings = WINE_USE[city.tavern.wineLevel] ?? 0;
            }
            if (spendings <= 0) continue;

            // Quando o estoque vai atingir o threshold
            const wineMs      = cityCtx.wineHours * 3600 * 1000;
            const hitsThresh  = now + wineMs - threshold;

            if (hitsThresh > now) {
                const wakeAt = hitsThresh - WAKE_LEAD_MS;
                if (wakeAt < nextWake) {
                    nextWake   = wakeAt;
                    nextReason = `vinho de ${city.name} atinge threshold em ${(cityCtx.wineHours).toFixed(1)}h`;
                }
            }
        }

        // 2. Construção terminando (city.buildings[underConstruction].completed)
        for (const city of this._state.getAllCities()) {
            const ucIdx = city.underConstruction;
            if (ucIdx === -1 || ucIdx == null) continue;
            const slot = city.buildings?.[ucIdx];
            if (!slot?.completed) continue;

            // completed é em segundos Unix
            const completesMs = slot.completed * 1000;
            if (completesMs <= now) continue;

            // Acordar 2min depois da construção terminar
            const wakeAt = completesMs + 2 * 60 * 1000;
            if (wakeAt < nextWake) {
                nextWake   = wakeAt;
                nextReason = `construção em ${city.name} termina em ${Math.round((completesMs - now) / 60000)}min`;
            }
        }

        // 3. Transporte chegando (fleetMovements com arrivalTs)
        for (const mv of this._state.fleetMovements ?? []) {
            if (!mv.isOwn || mv.isReturn) continue;
            if (!mv.arrivalTs) continue;

            const arrivalMs = mv.arrivalTs * 1000;
            if (arrivalMs <= now) continue;

            // Acordar 5min antes da chegada para confirmar recursos disponíveis
            const wakeAt = arrivalMs - WAKE_LEAD_MS;
            if (wakeAt > now && wakeAt < nextWake) {
                nextWake   = wakeAt;
                nextReason = `transporte chega em ${Math.round((arrivalMs - now) / 60000)}min`;
            }
        }

        if (nextWake === Infinity) {
            this._audit.debug('Planner', 'Sem eventos futuros relevantes — sem wake-up adaptativo');
            return;
        }

        const delayMs = Math.max(nextWake - now, WAKE_MIN_INTERVAL);
        const inMin   = Math.round(delayMs / 60000);

        this._audit.info('Planner',
            `Wake-up adaptativo em ${inMin}min — motivo: ${nextReason}`
        );

        this._adaptiveTimer = setTimeout(() => {
            this._adaptiveTimer = null;
            this._audit.info('Planner', `Wake-up adaptativo disparado — ${nextReason}`);
            if (this._running) {
                this._audit.debug('Planner',
                    `Wake-up adaptativo colidiu com ciclo em andamento — reagendando em ${Math.round(WAKE_MIN_INTERVAL / 1000)}s`
                );
                this._adaptiveTimer = setTimeout(() => {
                    this._adaptiveTimer = null;
                    this._onStateFresh(Date.now());
                }, WAKE_MIN_INTERVAL);
                return;
            }

            this._running = true;
            this.runCycle(Date.now())
                .catch(err => this._audit.error('Planner', `Erro no wake-up adaptativo: ${err.message}`))
                .finally(() => { this._running = false; });
        }, delayMs);
    }

    /**
     * Agenda um mini-ciclo reativo com debounce de 10s.
     * Usado após QUEUE_TASK_DONE e QUEUE_TASK_FAILED.
     * Evita avalanche quando várias tasks terminam juntas.
     */
    _scheduleReactiveCycle(taskType, reason = 'DONE') {
        if (this._reactiveTimer) return; // já agendado — debounce

        const now = Date.now();
        const WAKE_MIN_INTERVAL = this._config.get('plannerWakeMinIntervalMs') ?? 2 * 60_000;
        if (now - this._lastCycleTs < WAKE_MIN_INTERVAL) {
            this._audit.debug('Planner',
                `Wake-up reativo (${taskType} ${reason}) ignorado — ciclo recente há ${Math.round((now - this._lastCycleTs) / 1000)}s`
            );
            return;
        }

        this._audit.info('Planner',
            `Wake-up reativo agendado em ${REACTIVE_DEBOUNCE / 1000}s — ${taskType} ${reason}`
        );

        this._reactiveTimer = setTimeout(() => {
            this._reactiveTimer = null;
            if (this._running) {
                this._audit.debug('Planner',
                    `Wake-up reativo colidiu com ciclo em andamento — reagendando em ${Math.round(WAKE_MIN_INTERVAL / 1000)}s`
                );
                this._reactiveTimer = setTimeout(() => {
                    this._reactiveTimer = null;
                    this._onStateFresh(Date.now());
                }, WAKE_MIN_INTERVAL);
                return;
            }
            this._audit.info('Planner', `Wake-up reativo disparado (${taskType} ${reason})`);
            this._running = true;
            this.runCycle(Date.now())
                .catch(err => this._audit.error('Planner', `Erro no wake-up reativo: ${err.message}`))
                .finally(() => { this._running = false; });
        }, REACTIVE_DEBOUNCE);
    }

    // ── Ciclo principal ───────────────────────────────────────────────────────

    async runCycle(ts) {
        const startMs = Date.now();
        this._audit.info('Planner', `=== CICLO ${new Date(ts).toLocaleTimeString()} ===`);
        this._events.emit(this._events.E.PLANNER_CYCLE_START, { ts });

        // 1. Construir contexto global
        const ctx = this._buildContext(ts);

        // 2. Fase 1 — SUSTENTO
        this._audit.info('Planner', `Fase 1: SUSTENTO (HR) — ${ctx.cities.size} cidades`);
        this._hr.replan(ctx);

        // 3. Fase 2 — CAPACIDADE
        this._audit.info('Planner', 'Fase 2: CAPACIDADE (COO)');
        this._coo.replan(ctx);

        // 4. Marcar buildBlocked nas cidades com emergência
        this._markBuildBlocked(ctx);

        const blocked = [...ctx.cities.values()].filter(c => c.buildBlocked).length;
        if (blocked > 0) {
            this._audit.info('Planner', `${blocked} cidade(s) com buildBlocked por emergência de sustento`);
        }

        // 5. Fase 3 — INFRAESTRUTURA
        this._audit.info('Planner', 'Fase 3: INFRAESTRUTURA (CFO)');
        this._cfo.replan(ctx);

        // 6. Fase 4 — PESQUISA
        this._audit.info('Planner', 'Fase 4: PESQUISA (CTO)');
        this._cto.replan(ctx);

        // 7. Fase 5 — SEGURANÇA + DETECÇÃO
        this._audit.info('Planner', 'Fase 5: SEGURANÇA (CSO) + DETECÇÃO (MnA)');
        this._cso.replan(ctx);
        await this._mna.replan(ctx);

        // 8. Emitir evento de conclusão com resumo
        const durationMs = Date.now() - startMs;
        const summary    = this._buildSummary(ctx, durationMs);

        this._audit.info('Planner',
            `Ciclo concluído em ${durationMs}ms | ` +
            `emergências: ${summary.citiesWithEmergency.length} | ` +
            `bloqueadas: ${summary.citiesWithBuildBlocked.length} | ` +
            `builds aprovados: ${summary.buildsApproved}`
        );

        this._lastCycleTs = Date.now();
        this._lastSummary = summary;
        this._lastContext = ctx;
        this._events.emit(this._events.E.PLANNER_CYCLE_DONE, { ts, summary, ctx });

        // Agendar próximo wake-up baseado no estado atual
        this._scheduleAdaptiveWakeup(ctx);
    }

    // ── Contexto ──────────────────────────────────────────────────────────────

    _buildContext(ts) {
        const cities    = new Map();
        const allCities = this._state.getAllCities();
        const threshold = this._config.get('wineEmergencyHours') ?? 4;
        const queuePending = this._queue.getPending?.() ?? [];
        const queueHistory = this._queue.getHistory?.() ?? [];

        for (const city of allCities) {
            const satisfaction = city.typed?.happinessScore ?? city.economy?.satisfaction ?? null;
            const populationUsed = Number(city.typed?.populationUsed ?? city.economy?.population ?? 0);
            const maxInhabitants = Number(city.typed?.maxInhabitants ?? city.economy?.maxInhabitants ?? 0);
            const populationUtilization = Number(city.typed?.populationUtilization ?? (maxInhabitants > 0 ? populationUsed / maxInhabitants : 0));
            const growthPerHour = Number(city.typed?.populationGrowthPerHour ?? city.economy?.growthPerHour ?? 0);

            const wineSustain = evaluateWineSustainPolicy({
                city,
                signals: {
                    happinessScore: satisfaction,
                    populationGrowthPerHour: growthPerHour,
                    populationUsed,
                    maxInhabitants,
                    populationUtilization,
                    wineSpendings: Number(city?.typed?.wineSpendings ?? city?.production?.wineSpendings ?? 0),
                },
                ctx: null,
                emergencyHours: threshold,
            });
            const wineHours = wineSustain.wineCoverageHours;

            // satisfaction=null → jogo ainda não reportou (cidade não visitada) → não bloquear
            // satisfaction<=0 confirmado → felicidade real negativa → bloquear builds
            const satBlocked        = satisfaction !== null && satisfaction <= 0;
            const wineBootstrapNeeded = this._needsWineBootstrapRecovery({
                city,
                wine: Number(city?.resources?.wine ?? 0),
                spendings: Number(wineSustain?.effectiveWineSpendings ?? 0),
                satisfaction,
                growthPerHour,
                populationUtilization,
            });
            const hasCriticalSupply =
                wineHours < threshold
                || satBlocked
                || wineBootstrapNeeded
                || wineSustain.needsWineImport
                || wineSustain.needsTavernBootstrap;

            // Transportes já agendados com destino a esta cidade
            const pendingTransports = this._queue.getPending()
                .filter(t => t.type === 'TRANSPORT' && t.payload?.toCityId === city.id);

            cities.set(city.id, new PlannerCityContext({
                wineHours,
                satisfaction,
                populationUsed,
                maxInhabitants,
                populationUtilization,
                populationGrowthPerHour: growthPerHour,
                hasCriticalSupply,
                wineBootstrapNeeded,
                wineSustain,
                pendingTransports,
                buildBlocked:         false,  // preenchido por _markBuildBlocked
                buildApprovedBy:      null,   // preenchido pelo CFO
                wineEmergencyHandled: false,  // preenchido pelo HR
            }));
        }

        const stageInfoBase = detectEmpireStage({
            cities: allCities,
            cityContexts: cities,
        });

        const goalInfoBase = chooseGlobalGoal({
            stage: stageInfoBase.stage,
            stageMetrics: stageInfoBase.metrics,
            cities: allCities,
            cityContexts: cities,
        });

        const readinessBase = {
            cityReadiness: stageInfoBase.metrics?.cityReadiness ?? 0,
            empireReadiness: stageInfoBase.metrics?.expansionReadiness ?? 0,
            expansionReady: Boolean(stageInfoBase.metrics?.expansionReady),
            consolidationNeeded: Boolean(stageInfoBase.metrics?.consolidationNeeded),
            reasons: stageInfoBase.metrics?.readinessReasons ?? [],
            blockingFactors: stageInfoBase.metrics?.readinessBlockingFactors ?? [],
            cityReadinessByCityId: stageInfoBase.metrics?.cityReadinessByCityId ?? {},
        };

        const growthPolicyBase = evaluateGrowthPolicy({
            stage: stageInfoBase.stage,
            globalGoal: goalInfoBase.goal,
            readiness: readinessBase,
            stageMetrics: stageInfoBase.metrics,
            cities: allCities,
            cityContexts: cities,
        });

        const fleetPolicy = evaluateFleetPolicy({
            stage: stageInfoBase.stage,
            globalGoal: goalInfoBase.goal,
            growthStage: growthPolicyBase.growthStage,
            empireReadiness: readinessBase.empireReadiness,
            cities: allCities,
            cityContexts: cities,
            stageMetrics: {
                ...stageInfoBase.metrics,
                capitalAtRisk: this._estimateCapitalAtRisk(allCities),
            },
            queuePending,
            queueHistory,
        });

        const stageInfo = detectEmpireStage({
            cities: allCities,
            cityContexts: cities,
            fleetPolicy,
        });

        const readiness = {
            cityReadiness: stageInfo.metrics?.cityReadiness ?? 0,
            empireReadiness: stageInfo.metrics?.expansionReadiness ?? 0,
            expansionReady: Boolean(stageInfo.metrics?.expansionReady),
            consolidationNeeded: Boolean(stageInfo.metrics?.consolidationNeeded),
            reasons: stageInfo.metrics?.readinessReasons ?? [],
            blockingFactors: stageInfo.metrics?.readinessBlockingFactors ?? [],
            cityReadinessByCityId: stageInfo.metrics?.cityReadinessByCityId ?? {},
        };

        const goalInfo = chooseGlobalGoal({
            stage: stageInfo.stage,
            stageMetrics: stageInfo.metrics,
            cities: allCities,
            cityContexts: cities,
        });

        const growthPolicy = evaluateGrowthPolicy({
            stage: stageInfo.stage,
            globalGoal: goalInfo.goal,
            readiness,
            stageMetrics: stageInfo.metrics,
            cities: allCities,
            cityContexts: cities,
        });

        const workforcePolicy = evaluateWorkforcePolicy({
            cities: allCities,
            cityContexts: cities,
            stage: stageInfo.stage,
            globalGoal: goalInfo.goal,
            growthStage: growthPolicy.growthStage,
            readiness,
        });

        const readinessWithWorkforce = {
            ...readiness,
            empireReadiness: Number((((readiness.empireReadiness ?? 0) + (workforcePolicy.workforceReadiness ?? 0)) / 2).toFixed(2)),
            reasons: [
                ...(Array.isArray(readiness.reasons) ? readiness.reasons : []),
                ...(Array.isArray(workforcePolicy.reasons) ? workforcePolicy.reasons : []),
            ],
            blockingFactors: [
                ...(Array.isArray(readiness.blockingFactors) ? readiness.blockingFactors : []),
                ...(Array.isArray(workforcePolicy.blockingFactors) ? workforcePolicy.blockingFactors : []),
            ],
            workforceReadiness: Number(workforcePolicy.workforceReadiness ?? 0),
            workforceTelemetry: workforcePolicy.telemetry ?? {},
        };

        for (const [cityId, citySignal] of workforcePolicy.perCity ?? []) {
            const cityCtx = cities.get(cityId);
            if (!cityCtx) continue;
            cityCtx.idlePopulation = citySignal.idlePopulation;
            cityCtx.workforceUtilization = citySignal.workforceUtilization;
            cityCtx.productionFloorMet = citySignal.productionFloorMet;
            cityCtx.recommendedWorkersWood = citySignal.recommendedWorkersWood;
            cityCtx.recommendedWorkersTradegood = citySignal.recommendedWorkersTradegood;
            cityCtx.recommendedScientists = citySignal.recommendedScientists;
            cityCtx.workforceBlockingFactors = citySignal.workforceBlockingFactors;
            cityCtx.workforceReasons = citySignal.workforceReasons;
        }

        const growthPolicyWithWorkforce = evaluateGrowthPolicy({
            stage: stageInfo.stage,
            globalGoal: goalInfo.goal,
            readiness: readinessWithWorkforce,
            stageMetrics: stageInfo.metrics,
            cities: allCities,
            cityContexts: cities,
        });

        this._audit.info('Planner',
            `Estratégia global: stage=${stageInfo.stage} goal=${goalInfo.goal} ` +
            `growth=${growthPolicyWithWorkforce.growthStage} milestone=${growthPolicyWithWorkforce.nextMilestone}`
        );

        return {
            ts,
            cities,
            stage: stageInfo.stage,
            stageMetrics: stageInfo.metrics,
            readiness: readinessWithWorkforce,
            globalGoal: goalInfo.goal,
            goalReason: goalInfo.reason,
            goalTelemetry: goalInfo.telemetry,
            growthPolicy: growthPolicyWithWorkforce,
            fleetPolicy,
            workforcePolicy,
        };
    }

    _needsWineBootstrapRecovery({
        city,
        wine = 0,
        spendings = 0,
        satisfaction = null,
        growthPerHour = 0,
        populationUtilization = 0,
    } = {}) {
        // Cidades com consumo ativo já entram pela política normal de emergência.
        if (spendings > 0) return false;

        const tavernBuilding = (city?.buildings ?? []).find((b) => b?.building === 'tavern');
        const tavernExists = Number(tavernBuilding?.level ?? 0) > 0;
        if (!tavernExists) return false;

        const tavernWineLevel = Number(city?.tavern?.wineLevel ?? 0);
        if (tavernWineLevel > 0 && wine > 0) return false;

        const lowWine = Number(wine ?? 0) <= 0;
        if (!lowWine) return false;

        const needsStability =
            (satisfaction !== null && satisfaction <= 1)
            || Number(growthPerHour ?? 0) <= 0
            || Number(populationUtilization ?? 0) >= 0.9;

        return needsStability;
    }

    _estimateCapitalAtRisk(cities = []) {
        return (Array.isArray(cities) ? cities : []).reduce((sum, city) => {
            const warehouseLevel = (city?.buildings ?? [])
                .filter((b) => b?.building === 'warehouse')
                .reduce((max, b) => Math.max(max, Number(b?.level ?? 0)), 0);
            const safeCapacity = getWarehouseSafe(warehouseLevel);
            const cityAtRisk = Object.values(city?.resources ?? {})
                .reduce((s, qty) => s + Math.max(0, Number(qty ?? 0) - safeCapacity), 0);
            return sum + cityAtRisk;
        }, 0);
    }

    _markBuildBlocked(ctx) {
        for (const [cityId, cityCtx] of ctx.cities) {
            if (cityCtx.hasCriticalSupply) {
                cityCtx.markBuildBlocked();
                this._audit.debug('Planner',
                    `Cidade ${cityId}: buildBlocked ` +
                    `(vinho=${cityCtx.wineHours === Infinity ? '∞' : cityCtx.wineHours.toFixed(1)}h ` +
                    `mode=${cityCtx.wineSustain?.wineMode ?? 'N/A'} ` +
                    `sat=${cityCtx.satisfaction ?? 'N/A'})`
                );
            }
        }
    }

    // ── Resumo do ciclo ───────────────────────────────────────────────────────

    _buildSummary(ctx, durationMs) {
        const entries = [...ctx.cities.entries()];
        return {
            ts:                     ctx.ts,
            durationMs,
            stage:                  ctx.stage ?? null,
            cityReadiness:          ctx.readiness?.cityReadiness ?? 0,
            empireReadiness:        ctx.readiness?.empireReadiness ?? 0,
            expansionReady:         Boolean(ctx.readiness?.expansionReady),
            consolidationNeeded:    Boolean(ctx.readiness?.consolidationNeeded),
            globalGoal:             ctx.globalGoal ?? null,
            goalReason:             ctx.goalReason ?? null,
            growthStage:            ctx.growthPolicy?.growthStage ?? null,
            nextMilestone:          ctx.growthPolicy?.nextMilestone ?? null,
            milestoneBlockingFactors: ctx.growthPolicy?.milestoneBlockingFactors ?? [],
            workforceReadiness:     Number(ctx.readiness?.workforceReadiness ?? 0),
            workforceBlockingFactors: Array.isArray(ctx.workforcePolicy?.blockingFactors) ? ctx.workforcePolicy.blockingFactors : [],
            workforceReasons:       Array.isArray(ctx.workforcePolicy?.reasons) ? ctx.workforcePolicy.reasons : [],
            fleetReadiness:          Number(ctx.fleetPolicy?.fleetReadiness ?? 1),
            blockedByFleet:          Boolean(ctx.fleetPolicy?.blockedByFleet),
            freeCargoShips:          Number(ctx.fleetPolicy?.freeCargoShips ?? 0),
            totalCargoShips:         Number(ctx.fleetPolicy?.totalCargoShips ?? 0),
            recommendedCargoShipsToBuy: Number(ctx.fleetPolicy?.recommendedCargoShipsToBuy ?? 0),
            citiesWithEmergency:    entries.filter(([, c]) => c.hasCriticalSupply).map(([id]) => id),
            citiesWithBuildBlocked: entries.filter(([, c]) => c.buildBlocked).map(([id]) => id),
            buildsApproved:         entries.filter(([, c]) => c.buildApprovedBy).length,
            modulesRan:             ['HR', 'COO', 'CFO', 'CTO', 'CSO', 'MnA'],
        };
    }
}
