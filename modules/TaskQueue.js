// TaskQueue.js — fila JIT de tarefas, executor sequencial
// Respeita OperationMode (FULL-AUTO / SEMI / MANUAL / SAFE).
// Guards por tipo de task. Persistência no Storage.
// NOISE scheduling delegado pelo CSO, executado aqui.
//
// Sistema de fases (TASK_PHASE):
//   SUSTENTO (1)   → WINE_ADJUST, TRANSPORT de vinho emergencial
//   LOGISTICA (2)  → TRANSPORT de recursos para build, overflow
//   CONSTRUCAO (3) → BUILD
//   PESQUISA (4)   → RESEARCH, WORKER_REALLOC
//   RUIDO (5)      → NOISE, NAVIGATE
// Ordenação: phase → priority → scheduledFor (menor = mais urgente em todos)
// Deduplicação: padrão = type + cityId + phase.
// Para TRANSPORT, usar assinatura logística (from/to/recurso/purpose) para evitar
// remessas repetitivas para o mesmo gargalo enquanto já há cobertura comprometida.
// Preempção: task de fase mais alta não é executada se há fase mais urgente pronta

import { nanoid, humanDelay } from './utils.js';
import { GameError }          from './GameClient.js';
import { TASK_TYPE }          from './taskTypes.js';
import { TransportIntentRegistry } from './TransportIntentRegistry.js';
import { createSafeStorage } from './SafeStorage.js';
import { TaskGuards } from './TaskGuards.js';
import { TaskOutcomeTracker } from './TaskOutcomeTracker.js';
import { NoiseScheduler } from './NoiseScheduler.js';

export const TASK_PHASE = Object.freeze({
    SUSTENTO:   1,
    LOGISTICA:  2,
    CONSTRUCAO: 3,
    PESQUISA:   4,
    RUIDO:      5,
});

export class TaskQueue {
    static REDISPATCH_PROBE_WINDOW_MS = 5 * 60_000;

    constructor({ events, audit, config, state, client, storage, transportIntentRegistry = null, taskGuards = null }) {
        this._events  = events;
        this._audit   = audit;
        this._config  = config;
        this._state   = state;
        this._client  = client;
        this._storage = storage;
        this._safeStorage = createSafeStorage(storage, { module: 'TaskQueue', audit });
        this._transportIntentRegistry = transportIntentRegistry;

        // Referência ao CFO injetada após construção (evitar dependência circular)
        this._cfo = null;

        this._taskGuards = taskGuards ?? new TaskGuards({
            state,
            client,
            audit,
            config,
            getCFO: () => this._cfo,
            reschedule: (task, delayMs, reasonCode = null) => this._reschedule(task, delayMs, reasonCode),
            cancelTask: (task) => {
                this._moveToHistory(task);
                this._persist();
            },
        });

        this._queue      = [];   // Task[]
        this._done       = [];   // últimas 50 tasks concluídas (histórico UI)
        this._executing  = false;

        this._taskOutcomeTracker = new TaskOutcomeTracker({
            events,
            audit,
            state,
            client,
            isCriticalOutcomeTask: (task) => this._isCriticalOutcomeTask(task),
            countRelevantTransportMovements: (task) => this._countRelevantTransportMovements(task),
        });

        this._noiseScheduler = new NoiseScheduler({
            queue: this,
            state,
            config,
        });

        this._attemptSeq = 0;
        this._stopped = false;
        this._tickTimer = null;
    }

    static CRITICAL_OUTCOME_TYPES = Object.freeze(new Set([
        TASK_TYPE.BUILD,
        TASK_TYPE.TRANSPORT,
        TASK_TYPE.WINE_ADJUST,
        TASK_TYPE.WORKER_REALLOC,
    ]));

    /** Injetar referência ao CFO após construção (evitar circular). */
    setCFO(cfo) { this._cfo = cfo; }
    setTransportIntentRegistry(registry) { this._transportIntentRegistry = registry; }

    /** Fase padrão por tipo de task. Pode ser sobrescrita passando `phase` no taskData. */
    _defaultPhase(type, payload) {
        switch (type) {
            case TASK_TYPE.WINE_ADJUST:    return TASK_PHASE.SUSTENTO;
            case TASK_TYPE.TRANSPORT:      return payload?.wineEmergency ? TASK_PHASE.SUSTENTO : TASK_PHASE.LOGISTICA;
            case TASK_TYPE.BUILD:          return TASK_PHASE.CONSTRUCAO;
            case TASK_TYPE.RESEARCH:
            case TASK_TYPE.WORKER_REALLOC: return TASK_PHASE.PESQUISA;
            case TASK_TYPE.NOISE:
            case TASK_TYPE.NAVIGATE:       return TASK_PHASE.RUIDO;
            default:               return TASK_PHASE.LOGISTICA;
        }
    }

    async init() {
        this._stopped = false;
        // Restaurar histórico de tasks concluídas (para mostrar na aba Fila após reload)
        const savedDone = await this._storage?.get?.('taskQueueDone');
        if (Array.isArray(savedDone)) {
            this._done = savedDone;
        }

        // Restaurar fila persistida
        const saved = await this._storage?.get?.('taskQueue');
        if (Array.isArray(saved)) {
            // BUILD e RESEARCH são decisões efêmeras — re-criadas pelo CFO/CTO a cada ciclo.
            // Restaurar apenas tasks operacionais (TRANSPORT, WINE_ADJUST) que representam
            // operações em andamento que devem ser completadas entre sessões.
            const EPHEMERAL_TYPES = new Set([TASK_TYPE.BUILD, TASK_TYPE.RESEARCH]);
            const ephemeralDropped = saved.filter(t => t.status !== 'done' && EPHEMERAL_TYPES.has(t.type));
            if (ephemeralDropped.length > 0) {
                this._audit?.info?.('TaskQueue',
                    `init: ${ephemeralDropped.length} task(s) efêmera(s) descartadas na restauração — CFO/CTO vão re-criar: ${ephemeralDropped.map(t => `${t.type}@${t.cityId}`).join(', ')}`
                );
            }
            const restored = saved.filter(t => t.status !== 'done' && !EPHEMERAL_TYPES.has(t.type));
            // Tasks 'in-flight' de sessões anteriores são zumbis:
            // nunca executaram até o fim, mas bloqueiam deduplicação e nunca
            // são retomadas (o _tick só pega status='pending').
            // Resetar para pending com delay de 5s para re-executar limpo.
            let zombies = 0;
            this._queue = restored.map(t => {
                if (t.status === 'in-flight') {
                    const zombieIndex = zombies;
                    zombies++;
                    const attempts = Math.max(0, Number(t.attempts) || 0);
                    const backoffMs = 5_000 * Math.pow(2, attempts);
                    const staggerMs = zombieIndex * 15_000;
                    return {
                        ...t,
                        status: 'pending',
                        scheduledFor: Date.now() + backoffMs + staggerMs,
                        recoveredFromZombie: true,
                    };
                }
                return t;
            });
            if (zombies > 0) {
                this._audit?.warn?.('TaskQueue',
                    `init: ${zombies} task(s) zumbi in-flight restauradas como pending — sessão anterior interrompida`
                );
            }
        }
        this._tick();
    }

    shutdown() {
        this._stopped = true;
        if (this._tickTimer) {
            clearTimeout(this._tickTimer);
            this._tickTimer = null;
        }
        this._executing = false;
        this._executingStartedAt = null;
    }

    // ── API pública ───────────────────────────────────────────────────────────

    /** Adiciona uma task à fila. Rejeita duplicatas pendentes conforme política por tipo. */
    add(taskData) {
        const incomingPhase = taskData.phase ?? this._defaultPhase(taskData.type, taskData.payload);

        if (taskData.type === TASK_TYPE.TRANSPORT && this._transportIntentRegistry) {
            this._transportIntentRegistry.setState?.(this._state);
            this._transportIntentRegistry.setQueue?.(this);

            const transportPayload = taskData.payload ?? {};
            const purpose = TransportIntentRegistry.resolvePurpose(transportPayload);
            const mainCargo = TransportIntentRegistry.resolveMainCargo(transportPayload.cargo ?? {});
            const reconcile = this._transportIntentRegistry.reconcileEquivalent({
                purpose,
                fromCityId: Number(transportPayload.fromCityId ?? taskData.cityId ?? NaN),
                toCityId: Number(transportPayload.toCityId ?? NaN),
                resource: mainCargo.resource,
                amount: mainCargo.amount,
            });

            if (reconcile.shouldSkipEnqueue) {
                this._audit.info('TaskQueue',
                    `TRANSPORT reconciliado — enqueue evitado intent=${reconcile.intentId} status=${reconcile.status} evidence=${reconcile.evidence.join(';')}`
                );
                const equivalent = this._findActiveTransportByIntentId(reconcile.intentId);
                return equivalent ?? {
                    id: reconcile.intentId,
                    type: TASK_TYPE.TRANSPORT,
                    status: 'reconciled',
                    cityId: taskData.cityId,
                    payload: {
                        ...(taskData.payload ?? {}),
                        intentId: reconcile.intentId,
                    },
                    reconciliation: reconcile,
                };
            }

            this._transportIntentRegistry.ensureFromTaskData(taskData);
        }

        if (taskData.type === TASK_TYPE.BUILD) {
            taskData = this._applyBuildSchedulingPrecedence(taskData);
        }

        // Deduplicação: por padrão type + cityId + phase (fases distintas coexistem —
        // ex: TRANSPORT de sustento e TRANSPORT de logística são legítimas em paralelo).
        // Para TRANSPORT, dedupe por rota + recursos + finalidade logística.
        // Exceção: NOISE nunca deduplica (múltiplas são intencionais).
        if (taskData.type !== TASK_TYPE.NOISE) {
            const duplicate = taskData.type === TASK_TYPE.TRANSPORT
                ? this._findDuplicateTransport(taskData, incomingPhase)
                : this._queue.find(t =>
                    t.type   === taskData.type &&
                    t.cityId === taskData.cityId &&
                    t.phase  === incomingPhase &&
                    (t.status === 'pending' || t.status === 'in-flight')
                );
            if (duplicate) {
                const schedIn = duplicate.scheduledFor > Date.now()
                    ? `em ${Math.round((duplicate.scheduledFor - Date.now()) / 1000)}s`
                    : 'imediata';
                this._audit.debug('TaskQueue',
                    `Task duplicada ignorada: ${taskData.type}[fase${incomingPhase}] cidade ${taskData.cityId} — já existe [${duplicate.id}] status=${duplicate.status} tentativas=${duplicate.attempts}/${duplicate.maxAttempts} exec=${schedIn}`
                );
                return duplicate;
            }
        }

        const task = {
            id:           nanoid(8),
            status:       'pending',
            attempts:     0,
            maxAttempts:  taskData.maxAttempts ?? 3,
            createdAt:    Date.now(),
            ...taskData,
            phase:        incomingPhase,  // garante phase mesmo se não veio no taskData
        };
        this._queue.push(task);
        this._applyUrgentReprioritization(task);
        this._persist();
        this._events.emit(this._events.E.QUEUE_TASK_ADDED, { task });
        this._audit.debug('TaskQueue', `Task adicionada: ${task.type} cidade ${task.cityId}`, { id: task.id });
        return task;
    }

    /** Remove uma task pelo ID. */
    cancel(taskId) {
        const idx = this._queue.findIndex(t => t.id === taskId);
        if (idx === -1) return false;
        this._queue.splice(idx, 1);
        this._persist();
        this._events.emit(this._events.E.QUEUE_TASK_CANCELLED, { taskId });
        return true;
    }

    /** Retorna tasks pendentes de uma cidade. */
    getPending(cityId) {
        return this._queue.filter(t =>
            t.status === 'pending' && (!cityId || t.cityId === cityId)
        );
    }

    /** Retorna task por ID (fila ativa + histórico), ou null se não existir. */
    getTaskById(taskId) {
        if (!taskId) return null;
        const inQueue = this._queue.find(t => t.id === taskId);
        if (inQueue) return { ...inQueue };
        const inHistory = this._done.find(t => t.id === taskId);
        if (inHistory) return { ...inHistory };
        return null;
    }

    /** Verifica se há BUILD pendente para uma cidade. */
    hasPendingBuild(cityId) {
        return this._queue.some(t =>
            t.type === TASK_TYPE.BUILD && t.cityId === cityId &&
            (t.status === 'pending' || t.status === 'in-flight' || t.status === 'waiting_resources')
        );
    }

    /** Verifica se há task de um tipo pendente para uma cidade. */
    hasPendingType(type, cityId) {
        return this._queue.some(t =>
            t.type === type && t.cityId === cityId &&
            (t.status === 'pending' || t.status === 'in-flight')
        );
    }

    /** Retorna tasks pendentes de uma fase específica, opcionalmente filtradas por cidade. */
    getPendingByPhase(phase, cityId) {
        return this._queue.filter(t =>
            t.status === 'pending' &&
            t.phase  === phase &&
            (!cityId || t.cityId === cityId)
        );
    }

    /** Verifica se há TRANSPORT de sustento (vinho emergencial) pendente para uma cidade destino. */
    hasPendingSustentoTransport(cityId) {
        return this._queue.some(t =>
            t.type   === TASK_TYPE.TRANSPORT &&
            t.phase  === TASK_PHASE.SUSTENTO &&
            t.payload?.toCityId === cityId &&
            (t.status === 'pending' || t.status === 'in-flight')
        );
    }

    /** Retorna histórico das últimas 50 tasks concluídas. */
    getHistory() { return [...this._done]; }

    /** Retorna snapshot das tasks ativas (pending, in-flight, blocked, waiting_resources, etc). */
    getActive() { return [...this._queue]; }

    /**
     * Reservas logísticas ativas por destino/recurso/finalidade.
     * Inclui apenas tasks TRANSPORT ainda ativas (não concluídas/não removidas).
     */
    getTransportReservations() {
        const activeStatuses = new Set(['pending', 'in-flight', 'blocked', 'waiting_resources']);
        const reservations = [];

        for (const t of this._queue) {
            if (t.type !== TASK_TYPE.TRANSPORT) continue;
            if (!activeStatuses.has(t.status)) continue;

            const p = t.payload ?? {};
            const toCityId = Number(p.toCityId ?? NaN);
            if (!Number.isFinite(toCityId)) continue;
            const purpose = this._resolveTransportPurpose(p);

            for (const [resource, qty] of Object.entries(p.cargo ?? {})) {
                const amount = Number(qty) || 0;
                if (amount <= 0) continue;
                reservations.push({
                    taskId: t.id,
                    toCityId,
                    resource,
                    purpose,
                    amount,
                    status: t.status,
                });
            }
        }

        return reservations;
    }

    /** Muda OperationMode e emite evento. */
    async setMode(mode) {
        await this._config.set('operationMode', mode);
        this._events.emit(this._events.E.QUEUE_MODE_CHANGED, { mode });
        this._audit.info('TaskQueue', `OperationMode alterado para ${mode}`);
    }

    // ── Loop principal ────────────────────────────────────────────────────────

    _tick() {
        if (this._stopped) return;

        const now  = Date.now();
        const mode = this._config.get('operationMode');

        this._promoteWaitingBuilds(now);

        // Watchdog: se _executing ficou true por mais de 60s, resetar e remarcar task
        if (this._executing && this._executingStartedAt && (now - this._executingStartedAt) > 60_000) {
            this._audit.error('TaskQueue', 'Watchdog: _executing travado há >60s — resetando');
            this._executing = false;
            this._executingStartedAt = null;
            // Remarcar tasks in-flight como pending
            for (const t of this._queue) {
                if (t.status === 'in-flight') {
                    t.status = 'pending';
                    t.scheduledFor = now + 5_000;
                }
            }
            this._persist();
        }

        if (!this._executing && mode !== 'MANUAL') {
            const ready = this._queue
                .filter(t => t.status === 'pending' && t.scheduledFor <= now)
                .sort((a, b) =>
                    // 1. Fase mais urgente primeiro (menor número = mais urgente)
                    (a.phase    - b.phase)    ||
                    // 2. Dentro da fase, menor priority primeiro
                    (a.priority - b.priority) ||
                    // 3. Desempate por tempo agendado
                    (a.scheduledFor - b.scheduledFor)
                );

            if (ready.length > 0) {
                const nextTask = ready[0];
                this._executing = true;
                this._executingStartedAt = Date.now();
                nextTask.status = 'in-flight';
                this._persist();

                this._execute(nextTask).catch(err => {
                    this._audit.error('TaskQueue', `_execute uncaught: ${err.message}`);
                });
            }
        }

        // Loop com setTimeout recursivo (não setInterval — armadilha documentada)
        const focusDelay = this._config.get('taskQueueTickFocusMs') ?? 1_000;
        const bgDelay = this._config.get('taskQueueTickBackgroundMs') ?? 5_000;
        const delay = document.visibilityState === 'hidden' ? bgDelay : focusDelay;
        this._tickTimer = setTimeout(() => this._tick(), delay);
    }

    // ── Execução ──────────────────────────────────────────────────────────────

    async _execute(task) {
        const executionStartedAt = Date.now();

        // Fallback para chamadas diretas de teste/integração fora do _tick.
        if (!this._executing || task.status !== 'in-flight') {
            this._executing = true;
            this._executingStartedAt = Date.now();
            task.status = 'in-flight';
            this._persist();
        }

        this._events.emit(this._events.E.QUEUE_TASK_STARTED, { task });

        if (this._hasTaskTimedOut(task)) {
            const timeoutReason = `SLA de task excedido (${this._formatMs(this._getTaskAgeMs(task))} > ${this._formatMs(this._getTaskTimeoutMs(task))})`;
            this._failTask(task, {
                error: timeoutReason,
                reasonCode: 'TASK_SLA_TIMEOUT',
                fatal: false,
                outcomeClass: 'hard-fail',
            });
            this._recordTaskOutcome(task, this._createTaskOutcome(task, {
                executionStartedAt,
                outcomeClass: 'failed',
                reasonCode: 'TASK_SLA_TIMEOUT',
                evidence: [timeoutReason],
                nextStep: 'cancel',
            }));
            return;
        }

        // Preempção: se chegou task de fase mais urgente enquanto esta ainda estava pending,
        // ceder para ela. O próximo _tick vai selecioná-la corretamente.
        const now = Date.now();
        const moreUrgent = this._queue.find(t =>
            t !== task &&
            t.status === 'pending' &&
            t.scheduledFor <= now &&
            (t.phase ?? TASK_PHASE.LOGISTICA) < (task.phase ?? TASK_PHASE.LOGISTICA)
        );
        if (moreUrgent) {
            this._audit.debug('TaskQueue',
                `Preempção: cedendo ${task.type}[fase${task.phase}] para ${moreUrgent.type}[fase${moreUrgent.phase}] mais urgente`
            );
            task.status = 'pending';
            this._executing = false;
            this._executingStartedAt = null;
            this._persist();
            return; // _executing permanece false — próximo _tick pega moreUrgent
        }

        if (task.type === TASK_TYPE.TRANSPORT) {
            this._transportIntentRegistry?.markDispatched?.(task.payload?.intentId, task.id);
        }

        this._audit.info('TaskQueue',
            `▶ [${task.id}] ${task.type} cidade ${task.cityId} tentativa ${task.attempts + 1}/${task.maxAttempts} — ${task.reason ?? ''}`);

        const pathDecision = this._captureHybridPathDecision(task, {
            actionType: task.type,
            preferredPath: 'endpoint',
            pathDecision: 'endpoint',
            decisionReason: 'ENDPOINT_PRIMARY',
            dataProvenance: ['endpoint'],
            routeConfidence: this._normalizeRouteConfidence(task.confidence),
        });

        try {
            // 1. OperationMode
            const mode = this._config.get('operationMode');
            if (mode === 'MANUAL') {
                task.status = 'blocked';
                this._persist();
                this._recordTaskOutcome(task, this._createTaskOutcome(task, {
                    executionStartedAt,
                    outcomeClass: 'inconclusive',
                    reasonCode: 'OPERATION_MODE_MANUAL',
                    evidence: ['operationMode=MANUAL'],
                    nextStep: 'wait_mode_change',
                }));
                return;
            }
            if (mode === 'SAFE' && task.confidence !== 'HIGH') {
                task.status = 'blocked';
                this._audit.warn('TaskQueue',
                    `SAFE MODE: task ${task.id} suspensa — confiança ${task.confidence}`,
                        { cityId: task.cityId }
                );
                this._persist();
                this._recordTaskOutcome(task, this._createTaskOutcome(task, {
                    executionStartedAt,
                    outcomeClass: 'inconclusive',
                    reasonCode: 'OPERATION_MODE_SAFE_CONFIDENCE_BLOCK',
                    evidence: [`confidence=${task.confidence ?? 'UNKNOWN'}`],
                    nextStep: 'wait_mode_change',
                }));
                return;
            }

            const validationBaseline = this._captureValidationBaseline(task);

            const redispatchProbe = await this._probeBeforeRedispatch(task, {
                validationBaseline,
                executionStartedAt,
            });
            if (redispatchProbe?.outcomeClass === 'success') {
                task.status = 'done';
                task.terminalReasonCode = redispatchProbe.reasonCode ?? null;
                this._persist();
                this._recordTaskOutcome(task, redispatchProbe);
                this._events.emit(this._events.E.QUEUE_TASK_DONE, { task, result: { idempotent: true }, outcome: redispatchProbe });
                this._audit.info('TaskQueue', `✓ [${task.id}] ${task.type} concluído por idempotência antes do re-dispatch`);
                this._moveToHistory(task);
                return;
            }

            // 2. Verificar probing (fetchAllCities em andamento)
            if (this._state.isProbing()) {
                const canBypassProbing = this._canRunDuringProbing(task);
                if (!canBypassProbing) {
                    // NOISE: atrasar menos (é baixa prioridade, não crítico)
                    const delayMs = task.type === TASK_TYPE.NOISE ? 10_000 : 30_000;
                    this._reschedule(task, delayMs, 'PROBING_IN_PROGRESS');
                    this._audit.debug('TaskQueue',
                        `Task [${task.id}] ${task.type} pausada durante fetchAllCities — reagendando em ${delayMs / 1000}s`
                    );
                    this._recordTaskOutcome(task, this._createTaskOutcome(task, {
                        executionStartedAt,
                        outcomeClass: 'guard_reschedule',
                        reasonCode: 'PROBING_IN_PROGRESS',
                        evidence: [
                            `delayMs=${delayMs}`,
                            `nextScheduledFor=${new Date(task.scheduledFor).toISOString()}`,
                        ],
                        nextStep: 'reschedule',
                    }));
                    return;
                }

                this._audit.warn('TaskQueue',
                    `Exceção de probing: permitindo ${task.type} urgente [${task.id}] durante fetchAllCities`
                );
            }

            // 3. Adquirir session lock — garante exclusividade durante navigate + action.
            // fetchAllCities também adquire este lock, então nunca se interpõe entre
            // o navigate do guard e o dispatch da task.
            const dispatchResult = await this._client.acquireSession(async () => {
                // 3a. Guards específicos por tipo (navigate acontece aqui dentro)
                await this._runGuards(task);

                // 3b. Executar via GameClient
                task.lastDispatchedAt = Date.now();
                return await this._dispatch(task);
            });

            this._captureHybridAttemptOutcome(task, dispatchResult?.hybridOutcome ?? {
                actionType: task.type,
                pathUsed: pathDecision.pathDecision,
                prereqCheck: 'pass',
                responseSignals: ['taskqueue:dispatch_completed'],
                outcomeClass: 'success',
                nextStep: 'task_complete',
            });

            const outcome = await this._postValidateTaskOutcome(task, {
                validationBaseline,
                executionStartedAt,
                dispatchResult,
            });

            this._recordTaskOutcome(task, outcome);

            if (outcome.outcomeClass === 'success') {
                task.status = 'done';
                task.terminalReasonCode = outcome.reasonCode ?? null;
                if (task.type === TASK_TYPE.TRANSPORT) {
                    this._transportIntentRegistry?.markTransportSuccess?.(task.payload?.intentId, task.id);
                }
                this._persist();
                this._events.emit(this._events.E.QUEUE_TASK_DONE, { task, result: dispatchResult, outcome });
                const elapsed = Date.now() - this._executingStartedAt;
                this._audit.info('TaskQueue',
                    `✓ [${task.id}] ${task.type} concluído em ${elapsed}ms`);
                this._moveToHistory(task);
            } else {
                task.attempts++;
                if (task.attempts >= task.maxAttempts || outcome.outcomeClass === 'failed') {
                    this._failTask(task, {
                        error: `Pós-validação sem evidência de sucesso (${outcome.reasonCode})`,
                        reasonCode: outcome.reasonCode ?? 'POST_VALIDATION_FAILED',
                        fatal: false,
                        outcomeClass: 'hard-fail',
                    });
                } else {
                    const waitMs = this._getValidationRescheduleMs(task, outcome);
                    this._reschedule(task, waitMs, outcome.reasonCode ?? 'POST_VALIDATION_INCONCLUSIVE');
                    this._audit.warn('TaskQueue',
                        `↺ [${task.id}] ${task.type} pós-validação inconclusiva (${task.attempts}/${task.maxAttempts}) — retry em ${Math.round(waitMs / 1000)}s`
                    );
                }
            }

            this._noiseScheduler.noteRealActionAndScheduleIfNeeded();

        } catch (err) {
            const consumeGuardAttempt = this._config.get('guardConsumesAttempt') !== false;
            const isGuardCancel = err instanceof GameError && err.type === 'GUARD_CANCEL';
            const isGuardError  = err instanceof GameError && err.guard;

            // Política de tentativa:
            // - GUARD_CANCEL nunca consome attempt.
            // - GUARD pode consumir ou não, conforme config.guardConsumesAttempt.
            // - Demais erros consomem attempt normalmente.
            const shouldConsumeAttempt = !isGuardCancel && (!isGuardError || consumeGuardAttempt);
            if (shouldConsumeAttempt) {
                task.attempts++;
            }

            if (isGuardCancel) {
                // GUARD_CANCEL: task já movida para histórico dentro do guard (ex: cidade já construindo).
                // Não incrementar tentativas, não re-agendar — CFO vai re-criar quando necessário.
                this._audit.info('TaskQueue',
                    `↷ [${task.id}] ${task.type} cancelado: ${err.message}`
                );
                this._recordTaskOutcome(task, this._createTaskOutcome(task, {
                    executionStartedAt,
                    outcomeClass: 'guard_cancel',
                    reasonCode: err?.code ?? 'GUARD_CANCEL',
                    evidence: [err.message],
                    nextStep: 'cancel',
                }));

            } else if (isGuardError) {
                // GUARD: pré-condição não atendida — task já reagendada dentro de _runGuards,
                // OU o GUARD veio de _dispatch (ex: endUpgradeTime=-1 no upgradeBuilding).
                // Se a task ainda está in-flight, reagendar com delay padrão.
                if (task.status === 'in-flight') {
                    this._reschedule(task, 30 * 60_000, err?.code ?? 'GUARD_PRECONDITION_NOT_MET'); // 30min — aguardar transporte ou fim de build
                }

                // Quando GUARD não consome attempt, controlar loop por guardAttempts separado.
                if (!consumeGuardAttempt) {
                    task.guardAttempts = (task.guardAttempts ?? 0) + 1;
                }

                const guardReasonCode = err?.code ?? task.reasonCode ?? 'GUARD_PRECONDITION_NOT_MET';
                task.lastBlockerCode = guardReasonCode;
                this._recordTaskOutcome(task, this._createTaskOutcome(task, {
                    executionStartedAt,
                    outcomeClass: 'guard_reschedule',
                    reasonCode: guardReasonCode,
                    evidence: [
                        err.message,
                        `attempts=${task.attempts}/${task.maxAttempts}`,
                        task.scheduledFor ? `nextScheduledFor=${new Date(task.scheduledFor).toISOString()}` : 'nextScheduledFor=N/A',
                    ],
                    nextStep: 'reschedule',
                }));
                this._captureHybridAttemptOutcome(task, {
                    actionType: task.type,
                    pathUsed: pathDecision.pathDecision,
                    prereqCheck: 'pass',
                    responseSignals: ['guard_error'],
                    outcomeClass: 'guard-reschedule',
                    nextStep: 'reschedule',
                    reasonCode: guardReasonCode,
                });

                const maxGuardAttempts = task.maxGuardAttempts ?? Math.max(task.maxAttempts * 4, 8);
                this._audit.debug('TaskQueue',
                    consumeGuardAttempt
                        ? `↷ [${task.id}] ${task.type} guard (${task.attempts}/${task.maxAttempts}): ${err.message}`
                        : `↷ [${task.id}] ${task.type} guard (${task.guardAttempts}/${maxGuardAttempts}, sem consumir attempt): ${err.message}`
                );

                const shouldFailByGuard = consumeGuardAttempt
                    ? (task.attempts >= task.maxAttempts)
                    : ((task.guardAttempts ?? 0) >= maxGuardAttempts);

                if (shouldFailByGuard) {
                    this._failTask(task, {
                        error: consumeGuardAttempt
                            ? `Guard esgotado após ${task.maxAttempts} tentativa(s): ${err.message}`
                            : `Guard esgotado após ${maxGuardAttempts} bloqueio(s) consecutivo(s): ${err.message}`,
                        reasonCode: guardReasonCode,
                        fatal: false,
                        outcomeClass: 'hard-fail',
                    });
                }
                this._persist();

            } else if (err instanceof GameError && err.fatal) {
                this._failTask(task, {
                    error: err.message,
                    reasonCode: err?.code ?? err?.type ?? 'FATAL_ERROR',
                    fatal: true,
                    outcomeClass: 'hard-fail',
                });
                this._recordTaskOutcome(task, this._createTaskOutcome(task, {
                    executionStartedAt,
                    outcomeClass: 'failed',
                    reasonCode: err?.code ?? err?.type ?? 'FATAL_ERROR',
                    evidence: [err.message],
                    nextStep: 'cancel',
                }));

            } else if (task.attempts >= task.maxAttempts) {
                this._failTask(task, {
                    error: err.message,
                    reasonCode: err?.code ?? 'ATTEMPTS_EXHAUSTED',
                    fatal: false,
                    outcomeClass: 'hard-fail',
                });
                this._recordTaskOutcome(task, this._createTaskOutcome(task, {
                    executionStartedAt,
                    outcomeClass: 'failed',
                    reasonCode: err?.code ?? 'ATTEMPTS_EXHAUSTED',
                    evidence: [err.message],
                    nextStep: 'cancel',
                }));

            } else {
                // RETRY: reagendar em 30s
                this._reschedule(task, 30_000, err?.code ?? 'RETRY_TRANSIENT_ERROR');
                this._audit.warn('TaskQueue',
                    `↺ [${task.id}] ${task.type} retry ${task.attempts}/${task.maxAttempts}: ${err.message}`
                );
                this._recordTaskOutcome(task, this._createTaskOutcome(task, {
                    executionStartedAt,
                    outcomeClass: 'inconclusive',
                    reasonCode: err?.code ?? 'RETRY_TRANSIENT_ERROR',
                    evidence: [
                        err.message,
                        `attempts=${task.attempts}/${task.maxAttempts}`,
                    ],
                    nextStep: 'retry',
                }));
            }

        } finally {
            this._executing = false;
            this._executingStartedAt = null;
        }
    }

    // ── Guards ────────────────────────────────────────────────────────────────

    async _runGuards(task) {
        await this._taskGuards.runGuards(task);
    }

    async _guardNavigate(cityId) {
        return this._taskGuards.guardNavigate(cityId);
    }

    async _guardBuild(task) {
        return this._taskGuards.guardBuild(task);
    }

    async _guardTransport(task) {
        return this._taskGuards.guardTransport(task);
    }

    // ── Dispatch ──────────────────────────────────────────────────────────────

    async _dispatch(task) {
        switch (task.type) {
            case TASK_TYPE.BUILD: {
                if (this._isBuildAlreadyUnderConstruction(task)) {
                    this._audit.info('TaskQueue',
                        `DISPATCH BUILD idempotente: cidade ${task.cityId} já está construindo no slot ${task.payload.position} — tratado como sucesso`
                    );
                    return {
                        ok: true,
                        idempotent: true,
                        reasonCode: 'BUILD_ALREADY_UNDER_CONSTRUCTION_IDEMPOTENT',
                    };
                }
                const result = await this._client.upgradeBuilding(
                    task.cityId,
                    task.payload.position,
                    task.payload.buildingView,
                    task.payload.currentLevel   // nível ATUAL antes da melhoria — confirmado via REC
                );
                // Probe imediato pós-build: força DC_SCREEN_DATA com constructionSite no slot.
                // StateManager atualiza city.underConstruction com o slot real.
                // Sem isso, CFO vê underConstruction=-1 e re-enfileira o mesmo build imediatamente.
                try {
                    await this._client.probeCityData(task.cityId);
                    this._audit.debug('TaskQueue', `BUILD: probe pós-build ok — cidade ${task.cityId} (underConstruction atualizado)`);
                } catch (probeErr) {
                    this._audit.warn('TaskQueue', `BUILD: probe pós-build falhou (não bloqueia): ${probeErr.message}`);
                }
                return result;
            }

            case TASK_TYPE.TRANSPORT:
                // Soma da carga para validação defensiva no GameClient.
                // Em caso de divergência entre payloads, o client recusa antes do POST.
                task.payload.expectedCargoTotal = Object.values(task.payload.cargo ?? {})
                    .reduce((s, v) => s + Math.max(0, Number(v) || 0), 0);
                this._audit.info('TaskQueue',
                    `DISPATCH TRANSPORT: de cidade ${task.payload.fromCityId} → cidade ${task.payload.toCityId} (island ${task.payload.toIslandId}), ${task.payload.boats} navios, carga=${JSON.stringify(task.payload.cargo)}${task.payload.wineEmergency ? ' [EMERGÊNCIA]' : ''}`
                );
                return this._client.sendTransport(
                    task.payload.fromCityId,
                    task.payload.toCityId,
                    task.payload.toIslandId,
                    task.payload.cargo,
                    task.payload.boats,
                    task.payload.expectedCargoTotal
                );

            case TASK_TYPE.RESEARCH:
                return this._client.startResearch(task.cityId, task.payload.researchId);

            case TASK_TYPE.WINE_ADJUST: {
                // Posição da taberna no grid da cidade — obrigatória no payload real (confirmado via REC)
                const tavernSlot = this._state.getCity(task.cityId)?.buildings
                    ?.find(b => b.building === 'tavern');
                if (!tavernSlot) {
                    throw new GameError('GUARD', `WINE_ADJUST: taberna não encontrada em cidade ${task.cityId} — buildings não carregados`);
                }
                this._audit.info('TaskQueue',
                    `DISPATCH WINE_ADJUST: cidade ${task.cityId} pos=${tavernSlot.position} → nível ${task.payload.wineLevel}${task.payload.wineEmergency ? ' [EMERGÊNCIA]' : ''}`
                );
                return this._client.setTavernWine(task.cityId, tavernSlot.position, task.payload.wineLevel);
            }

            case TASK_TYPE.NAVIGATE:
            case TASK_TYPE.NOISE:
                return this._client.navigate(task.cityId);

            case TASK_TYPE.WORKER_REALLOC: {
                // Payload confirmado via REC: screen=academy, s={qtd}
                // Outros tipos de realocação (madeira, luxo) usam populationManagement — não capturado.
                const { position, scientists } = task.payload;
                this._audit.info('TaskQueue',
                    `DISPATCH WORKER_REALLOC: cidade ${task.cityId} pos=${position} → ${scientists} cientistas`
                );
                return this._client.setScientists(task.cityId, position, scientists);
            }

            default:
                throw new GameError('FATAL', `Tipo de task desconhecido: ${task.type}`);
        }
    }

    // ── NOISE scheduling (mimetismo) ──────────────────────────────────────────

    _scheduleNoise() {
        return this._noiseScheduler._scheduleNoise();
    }

    _newNoiseThreshold() {
        return this._noiseScheduler._newNoiseThreshold();
    }

    _resolveTransportPurpose(payload = {}) {
        if (payload?.wineBootstrapRecovery) return 'wineBootstrap';
        if (payload?.wineRecovery) return 'wineRecovery';
        if (payload?.wineEmergency) return 'wineEmergency';
        if (payload?.jitBuild) return 'jitBuild';
        if (payload?.minStock) return 'minStock';
        if (payload?.overflowRelief) return 'overflowRelief';
        return payload?.logisticPurpose ?? 'generic';
    }

    _transportCargoSignature(cargo = {}) {
        return Object.entries(cargo)
            .filter(([, qty]) => Number(qty) > 0)
            .sort(([a], [b]) => String(a).localeCompare(String(b)))
            .map(([res, qty]) => `${res}:${Number(qty) || 0}`)
            .join('|');
    }

    _findDuplicateTransport(taskData, incomingPhase) {
        const incomingPayload = taskData?.payload ?? {};
        const incomingFrom = Number(incomingPayload?.fromCityId ?? taskData?.cityId ?? NaN);
        const incomingTo = Number(incomingPayload?.toCityId ?? NaN);
        const incomingCargoSig = this._transportCargoSignature(incomingPayload?.cargo ?? {});
        const incomingPurpose = this._resolveTransportPurpose(incomingPayload);

        const hasRichIdentity = Number.isFinite(incomingFrom)
            && Number.isFinite(incomingTo)
            && incomingCargoSig.length > 0;

        return this._queue.find((t) => {
            if (t.type !== TASK_TYPE.TRANSPORT) return false;
            if (t.phase !== incomingPhase) return false;
            if (t.status !== 'pending' && t.status !== 'in-flight') return false;

            const p = t.payload ?? {};
            if (!hasRichIdentity) {
                // Fallback defensivo para payloads incompletos
                return t.cityId === taskData.cityId;
            }

            const from = Number(p?.fromCityId ?? t.cityId ?? NaN);
            const to = Number(p?.toCityId ?? NaN);
            const cargoSig = this._transportCargoSignature(p?.cargo ?? {});
            const purpose = this._resolveTransportPurpose(p);

            return Number.isFinite(from)
                && Number.isFinite(to)
                && from === incomingFrom
                && to === incomingTo
                && purpose === incomingPurpose
                && cargoSig === incomingCargoSig;
        });
    }

    _findActiveTransportByIntentId(intentId) {
        if (!intentId) return null;
        return this._queue.find((t) =>
            t.type === TASK_TYPE.TRANSPORT
            && (t.status === 'pending' || t.status === 'in-flight' || t.status === 'blocked' || t.status === 'waiting_resources')
            && t.payload?.intentId === intentId
        ) ?? null;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _reschedule(task, delayMs, reasonCode = null) {
        task.status       = 'pending';
        task.scheduledFor = Date.now() + delayMs;
        task.lastRescheduleAt = Date.now();
        task.lastBlockerCode = reasonCode ?? task.lastBlockerCode ?? null;
        task.reasonCode = reasonCode ?? task.reasonCode;
        this._persist();
    }

    _isEssentialTransport(task) {
        const p = task?.payload ?? {};
        if (p.wineEmergency) return true;
        const moduleIsCoo = (task?.module ?? '') === 'COO';
        if (!moduleIsCoo) return false;
        return !!(p.jitBuild || p.minStock || p.overflowRelief);
    }

    _canRunDuringProbing(task) {
        if (!task) return false;
        if (task.type === TASK_TYPE.WINE_ADJUST && task.payload?.wineEmergency) return true;
        if (task.type === TASK_TYPE.TRANSPORT && task.payload?.wineEmergency) return true;
        return false;
    }

    _isBuildAlreadyUnderConstruction(task) {
        if (task?.type !== TASK_TYPE.BUILD) return false;
        const city = this._state.getCity?.(task.cityId);
        if (!city) return false;
        const uc = city.underConstruction;
        if (uc === -1 || uc === false || uc === null || Number(uc) === -1) return false;
        return Number(uc) === Number(task.payload?.position);
    }

    async _probeBeforeRedispatch(task, { validationBaseline = null, executionStartedAt } = {}) {
        const lastDispatchedAt = Number(task?.lastDispatchedAt ?? 0);
        if (!Number.isFinite(lastDispatchedAt) || lastDispatchedAt <= 0) return null;

        const elapsed = Date.now() - lastDispatchedAt;
        if (elapsed >= TaskQueue.REDISPATCH_PROBE_WINDOW_MS) return null;

        if (task.type === TASK_TYPE.BUILD) {
            try {
                await this._client.probeCityData(task.cityId);
            } catch (err) {
                this._audit.warn('TaskQueue', `BUILD probe pré re-dispatch falhou: ${err.message}`);
            }

            if (this._isBuildAlreadyUnderConstruction(task)) {
                return this._createTaskOutcome(task, {
                    executionStartedAt,
                    outcomeClass: 'success',
                    reasonCode: 'BUILD_ALREADY_UNDER_CONSTRUCTION_IDEMPOTENT',
                    evidence: [
                        `lastDispatchedAt=${new Date(lastDispatchedAt).toISOString()}`,
                        `redispatchWindowMs=${TaskQueue.REDISPATCH_PROBE_WINDOW_MS}`,
                        `elapsedMs=${elapsed}`,
                        `underConstructionConfirmed=true`,
                        `underConstructionBefore=${validationBaseline?.build?.underConstruction ?? 'N/A'}`,
                    ],
                    nextStep: 'none',
                });
            }
        }

        return null;
    }

    _getTaskTimeoutMs(task) {
        const byType = {
            [TASK_TYPE.WINE_ADJUST]: this._config.get('taskTimeoutWineAdjustMs') ?? 20 * 60_000,
            [TASK_TYPE.TRANSPORT]: this._config.get('taskTimeoutTransportMs') ?? 4 * 60 * 60_000,
            [TASK_TYPE.BUILD]: this._config.get('taskTimeoutBuildMs') ?? 8 * 60 * 60_000,
            [TASK_TYPE.RESEARCH]: this._config.get('taskTimeoutResearchMs') ?? 12 * 60 * 60_000,
            [TASK_TYPE.WORKER_REALLOC]: this._config.get('taskTimeoutWorkerReallocMs') ?? 30 * 60_000,
            [TASK_TYPE.NOISE]: this._config.get('taskTimeoutNoiseMs') ?? 30 * 60_000,
            [TASK_TYPE.NAVIGATE]: this._config.get('taskTimeoutNavigateMs') ?? 10 * 60_000,
        };
        return byType[task?.type] ?? (this._config.get('taskTimeoutDefaultMs') ?? 4 * 60 * 60_000);
    }

    _getTaskAgeMs(task) {
        const createdAt = Number(task?.createdAt ?? task?.scheduledFor ?? Date.now());
        return Math.max(0, Date.now() - createdAt);
    }

    _hasTaskTimedOut(task) {
        return this._getTaskAgeMs(task) > this._getTaskTimeoutMs(task);
    }

    _formatMs(ms) {
        const sec = Math.max(0, Math.round(ms / 1000));
        if (sec < 120) return `${sec}s`;
        const min = Math.round(sec / 60);
        if (min < 180) return `${min}min`;
        const h = (min / 60).toFixed(1);
        return `${h}h`;
    }

    _failTask(task, { error, reasonCode, fatal = false, outcomeClass = 'hard-fail' } = {}) {
        const terminalReasonCode = reasonCode ?? task.reasonCode ?? 'TASK_FAILED';
        task.status = 'failed';
        task.terminalReasonCode = terminalReasonCode;
        task.endedAt = Date.now();
        if (task.type === TASK_TYPE.TRANSPORT) {
            this._transportIntentRegistry?.markFailed?.(task.payload?.intentId, terminalReasonCode);
        }

        this._captureHybridAttemptOutcome(task, {
            actionType: task.type,
            pathUsed: task.pathDecision?.pathDecision ?? 'endpoint',
            prereqCheck: 'pass',
            responseSignals: [fatal ? 'fatal_error' : 'task_failed'],
            outcomeClass,
            nextStep: 'fail',
            reasonCode: terminalReasonCode,
        });

        this._audit.error('TaskQueue',
            `✗ [${task.id}] ${task.type} failed: ${error}`,
            { cityId: task.cityId, reasonCode: terminalReasonCode, fatal }
        );
        this._events.emit(this._events.E.QUEUE_TASK_FAILED, { task, error, fatal });
        this._moveToHistory(task);
        this._persist();
    }

    _applyBuildSchedulingPrecedence(taskData) {
        const city = this._state.getCity?.(taskData.cityId);
        const ucIdx = city?.underConstruction;
        const isUnderConstruction = ucIdx !== -1 && ucIdx !== false && ucIdx !== null && Number(ucIdx) !== -1;
        if (!isUnderConstruction) return taskData;

        const activeSlot = city?.buildings?.[ucIdx];
        const completesAtMs = activeSlot?.completed
            ? Number(activeSlot.completed) * 1000
            : Number(activeSlot?.completesAt ?? 0);

        if (!Number.isFinite(completesAtMs) || completesAtMs <= 0) return taskData;

        const precedenceTs = completesAtMs + 1000;
        const nextScheduledFor = precedenceTs;

        const evidence = Array.isArray(taskData.evidence) ? [...taskData.evidence] : [];
        evidence.push(`activeBuildComesFirst=true`);
        evidence.push(`activeBuildCompletesAt=${new Date(completesAtMs).toISOString()}`);
        evidence.push(`buildScheduledFor=${new Date(nextScheduledFor).toISOString()}`);

        return {
            ...taskData,
            scheduledFor: nextScheduledFor,
            reasonCode: taskData.reasonCode ?? 'BUILD_PRECEDENCE_ACTIVE_BUILD',
            evidence,
        };
    }

    _promoteWaitingBuilds(now = Date.now()) {
        for (const task of this._queue) {
            if (task.type !== TASK_TYPE.BUILD || task.status !== 'waiting_resources') continue;
            if ((task.scheduledFor ?? 0) > now) continue;
            if (!this._cfo || !task.payload?.cost) continue;

            const affordable = this._cfo.canAfford(task.cityId, task.payload.cost);
            if (!affordable) continue;

            const evidence = Array.isArray(task.evidence) ? [...task.evidence] : [];
            evidence.push('statusTransition=WAITING_RESOURCES->PENDING');
            evidence.push(`transitionAt=${new Date(now).toISOString()}`);

            task.status = 'pending';
            task.reasonCode = task.reasonCode ?? 'BUILD_RESOURCES_READY';
            task.evidence = evidence;
            this._audit.info('TaskQueue',
                `BUILD [${task.id}] recursos disponíveis — transição para pending (cidade ${task.cityId})`
            );
        }
    }

    _isUrgentTask(task) {
        if (!task) return false;
        if (task.type === TASK_TYPE.WINE_ADJUST && task.payload?.wineEmergency) return true;
        if (task.type === TASK_TYPE.TRANSPORT && task.payload?.wineEmergency) return true;
        if (task.type === TASK_TYPE.BUILD) {
            const threshold = this._config.get('urgentBuildRoiThreshold') ?? 8;
            const roi = Number(task.payload?.roi ?? 0);
            return Number.isFinite(roi) && roi >= threshold;
        }
        return false;
    }

    _applyUrgentReprioritization(incomingTask) {
        if (!this._isUrgentTask(incomingTask)) return;

        const urgentEvidence = [
            `urgentTaskId=${incomingTask.id}`,
            `urgentType=${incomingTask.type}`,
            `urgentCityId=${incomingTask.cityId}`,
        ];

        for (const task of this._queue) {
            if (task.id === incomingTask.id) continue;
            if (task.type !== TASK_TYPE.BUILD) continue;
            if (task.status !== 'pending') continue;

            task.status = 'waiting_resources';
            task.reasonCode = 'REPRIORITIZED_BY_URGENT_TASK';
            task.evidence = [
                ...(Array.isArray(task.evidence) ? task.evidence : []),
                ...urgentEvidence,
                'statusTransition=PENDING->WAITING_RESOURCES',
            ];
            task.reason = `TaskQueue: build repriorizada por urgência ${incomingTask.type}`;
            task.payload = {
                ...(task.payload ?? {}),
                waitingResources: true,
            };
            this._audit.info('TaskQueue',
                `Repriorização urgente: BUILD [${task.id}] voltou para WAITING_RESOURCES por ${incomingTask.type}`
            );
        }
    }

    _captureHybridPathDecision(task, decision) {
        return this._taskOutcomeTracker._captureHybridPathDecision(
            task,
            decision,
            (raw) => this._normalizeRouteConfidence(raw)
        );
    }

    _captureHybridAttemptOutcome(task, outcome = {}) {
        const normalized = {
            attemptId: outcome.attemptId ?? `tq_${Date.now()}_${++this._attemptSeq}`,
            taskId: task.id,
            actionType: outcome.actionType ?? task.type,
            pathUsed: outcome.pathUsed ?? task.pathDecision?.pathDecision ?? 'endpoint',
            prereqCheck: outcome.prereqCheck ?? 'pass',
            requestShapeHash: outcome.requestShapeHash ?? null,
            responseSignals: Array.isArray(outcome.responseSignals) ? outcome.responseSignals : [],
            outcomeClass: outcome.outcomeClass ?? 'success',
            nextStep: outcome.nextStep ?? 'none',
            reasonCode: outcome.reasonCode ?? null,
            ts: Date.now(),
        };

        task.lastAttemptOutcome = normalized;
        const ev = this._events?.E?.HYBRID_ATTEMPT_OUTCOME;
        if (ev) {
            this._events.emit(ev, {
                taskId: task.id,
                cityId: task.cityId,
                actionType: task.type,
                outcome: normalized,
            });
        }
        return normalized;
    }

    _normalizeRouteConfidence(raw) {
        const c = String(raw ?? '').toUpperCase();
        if (c === 'HIGH' || c === 'MEDIUM' || c === 'LOW') return c;
        return 'MEDIUM';
    }

    _isCriticalOutcomeTask(task) {
        return !!task && TaskQueue.CRITICAL_OUTCOME_TYPES.has(task.type);
    }

    _captureValidationBaseline(task) {
        if (!this._isCriticalOutcomeTask(task)) return null;

        const city = this._state.getCity?.(task.cityId) ?? null;
        const slot = city && Number.isFinite(Number(task.payload?.position))
            ? city.buildings?.find?.(b => Number(b?.position) === Number(task.payload?.position))
            : null;

        return {
            capturedAt: Date.now(),
            build: {
                underConstruction: city?.underConstruction ?? null,
                level: Number(slot?.level ?? -1),
                isUpgrading: !!slot?.isUpgrading,
            },
            wineLevel: Number(city?.tavern?.wineLevel ?? NaN),
            scientists: Number(city?.workers?.scientists ?? NaN),
            transportCount: this._countRelevantTransportMovements(task),
        };
    }

    async _postValidateTaskOutcome(task, { validationBaseline, executionStartedAt, dispatchResult = null } = {}) {
        return this._taskOutcomeTracker._postValidateTaskOutcome(task, {
            validationBaseline,
            executionStartedAt,
            dispatchResult,
        });
    }

    async _validateBuildOutcome(task, baseline, executionStartedAt) {
        const evidence = [];
        try {
            await this._client.probeCityData(task.cityId);
            evidence.push('probeCityData=ok');
        } catch (err) {
            evidence.push(`probeCityData=error:${err.message}`);
        }

        const city = this._state.getCity?.(task.cityId) ?? null;
        const expectedPos = Number(task.payload?.position);
        const slot = city?.buildings?.find?.(b => Number(b?.position) === expectedPos) ?? null;
        const nowUC = Number(city?.underConstruction ?? -1);
        const nowLevel = Number(slot?.level ?? -1);

        evidence.push(`underConstructionBefore=${baseline?.build?.underConstruction ?? 'N/A'}`);
        evidence.push(`underConstructionAfter=${city?.underConstruction ?? 'N/A'}`);
        evidence.push(`slotLevelBefore=${baseline?.build?.level ?? 'N/A'}`);
        evidence.push(`slotLevelAfter=${nowLevel}`);

        const hasUpgradeEvidence = (
            nowUC === expectedPos
            || slot?.isUpgrading === true
            || (Number.isFinite(nowLevel) && nowLevel > Number(baseline?.build?.level ?? -1))
        );

        if (hasUpgradeEvidence) {
            return this._createTaskOutcome(task, {
                executionStartedAt,
                outcomeClass: 'success',
                reasonCode: 'BUILD_STATE_CONFIRMED',
                evidence,
                nextStep: 'none',
            });
        }

        return this._createTaskOutcome(task, {
            executionStartedAt,
            outcomeClass: 'inconclusive',
            reasonCode: 'BUILD_POST_STATE_NOT_CONFIRMED',
            evidence,
            nextStep: 'retry',
        });
    }

    async _validateTransportOutcome(task, baseline, executionStartedAt) {
        const evidence = [];
        try {
            await this._client.fetchMilitaryAdvisor();
            evidence.push('fetchMilitaryAdvisor=ok');
        } catch (err) {
            evidence.push(`fetchMilitaryAdvisor=error:${err.message}`);
        }

        const before = Number(baseline?.transportCount ?? 0);
        const after = this._countRelevantTransportMovements(task);
        evidence.push(`transportCountBefore=${before}`);
        evidence.push(`transportCountAfter=${after}`);

        if (after > before) {
            return this._createTaskOutcome(task, {
                executionStartedAt,
                outcomeClass: 'success',
                reasonCode: 'TRANSPORT_MOVEMENT_CONFIRMED',
                evidence,
                nextStep: 'none',
            });
        }

        return this._createTaskOutcome(task, {
            executionStartedAt,
            outcomeClass: 'inconclusive',
            reasonCode: 'TRANSPORT_POST_STATE_NOT_CONFIRMED',
            evidence,
            nextStep: 'retry',
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

        try {
            await this._client.probeCityData(task.cityId);
            evidence.push('probeCityData=ok');
        } catch (err) {
            evidence.push(`probeCityData=error:${err.message}`);
        }

        const city = this._state.getCity?.(task.cityId) ?? null;
        const before = Number(baseline?.wineLevel ?? NaN);
        const after = Number(city?.tavern?.wineLevel ?? NaN);
        evidence.push(`wineLevelBefore=${Number.isFinite(before) ? before : 'N/A'}`);
        evidence.push(`wineLevelAfter=${Number.isFinite(after) ? after : 'N/A'}`);

        const stateChanged = Number.isFinite(before) && Number.isFinite(after) && before !== after;

        if (stateChanged && tokenRotated) {
            return this._createTaskOutcome(task, {
                executionStartedAt,
                outcomeClass: 'success',
                reasonCode: 'WINE_LEVEL_CHANGED_WITH_TOKEN_ROTATION',
                evidence,
                nextStep: 'none',
            });
        }

        const reasonCode = !stateChanged
            ? 'WINE_LEVEL_UNCHANGED'
            : 'WINE_ACTIONREQUEST_NOT_ROTATED';

        return this._createTaskOutcome(task, {
            executionStartedAt,
            outcomeClass: 'inconclusive',
            reasonCode,
            evidence,
            nextStep: 'retry',
        });
    }

    async _validateWorkerReallocOutcome(task, baseline, executionStartedAt, dispatchResult = null) {
        const evidence = [];
        const tokenRotated = !!dispatchResult?.tokenRotated;
        evidence.push(`actionRequestRotated=${tokenRotated}`);
        try {
            await this._client.probeCityData(task.cityId);
            evidence.push('probeCityData=ok');
        } catch (err) {
            evidence.push(`probeCityData=error:${err.message}`);
        }

        const city = this._state.getCity?.(task.cityId) ?? null;
        const before = Number(baseline?.scientists ?? NaN);
        const after = Number(city?.workers?.scientists ?? NaN);
        evidence.push(`scientistsBefore=${Number.isFinite(before) ? before : 'N/A'}`);
        evidence.push(`scientistsAfter=${Number.isFinite(after) ? after : 'N/A'}`);

        const stateChanged = Number.isFinite(before) && Number.isFinite(after) && before !== after;

        if (stateChanged && tokenRotated) {
            return this._createTaskOutcome(task, {
                executionStartedAt,
                outcomeClass: 'success',
                reasonCode: 'WORKER_ALLOCATION_CHANGED_WITH_TOKEN_ROTATION',
                evidence,
                nextStep: 'none',
            });
        }

        const reasonCode = !stateChanged
            ? 'WORKER_ALLOCATION_UNCHANGED'
            : 'WORKER_ACTIONREQUEST_NOT_ROTATED';

        return this._createTaskOutcome(task, {
            executionStartedAt,
            outcomeClass: 'inconclusive',
            reasonCode,
            evidence,
            nextStep: 'retry',
        });
    }

    _countRelevantTransportMovements(task) {
        if (task?.type !== TASK_TYPE.TRANSPORT) return 0;
        const fromCityId = Number(task?.payload?.fromCityId ?? task?.cityId ?? -1);
        const toCityId = Number(task?.payload?.toCityId ?? -1);
        if (!Number.isFinite(fromCityId) || !Number.isFinite(toCityId)) return 0;

        return (this._state.fleetMovements ?? []).filter((m) => {
            if (!m?.isOwn || m?.isReturn) return false;
            const from = Number(m.originCityId ?? m.sourceCityId ?? -1);
            const to = Number(m.targetCityId ?? m.destinationCityId ?? -1);
            return from === fromCityId && to === toCityId;
        }).length;
    }

    _getValidationRescheduleMs(task, outcome) {
        if (outcome?.outcomeClass === 'guard_reschedule') return 30_000;
        if (task.type === TASK_TYPE.BUILD) return 90_000;
        if (task.type === TASK_TYPE.TRANSPORT) return 60_000;
        if (task.type === TASK_TYPE.WINE_ADJUST) return 45_000;
        if (task.type === TASK_TYPE.WORKER_REALLOC) return 45_000;
        return 30_000;
    }

    _createTaskOutcome(task, {
        executionStartedAt,
        outcomeClass,
        reasonCode,
        evidence,
        nextStep,
    } = {}) {
        return this._taskOutcomeTracker._createTaskOutcome(task, {
            executionStartedAt,
            outcomeClass,
            reasonCode,
            evidence,
            nextStep,
        });
    }

    _recordTaskOutcome(task, outcome) {
        return this._taskOutcomeTracker._recordTaskOutcome(task, outcome);
    }

    _moveToHistory(task) {
        task.completedAt = Date.now();
        this._done.push(task);
        if (this._done.length > 50) this._done.shift();
        // Remover da fila ativa
        const idx = this._queue.indexOf(task);
        if (idx !== -1) this._queue.splice(idx, 1);
        // Persistir histórico para sobreviver reloads da extensão
        this._persistHistory();
    }

    _persist() {
        // Salvar tasks não-concluídas (done está em _done separado)
        const toSave = this._queue.filter(t => t.status !== 'done');
        this._safeStorage.set('taskQueue', toSave);
    }

    _persistHistory() {
        // Persistir as últimas 50 tasks concluídas — sobrevive reloads
        this._safeStorage.set('taskQueueDone', this._done.slice(-50));
    }
}
