// TaskQueue.js — fila JIT de tarefas, executor sequencial
// Respeita OperationMode (FULL-AUTO / SEMI / MANUAL / SAFE).
// Guards por tipo de task. Persistência no Storage.
// NOISE scheduling delegado pelo CSO, executado aqui.

import { nanoid, humanDelay } from './utils.js';
import { GameError }          from './GameClient.js';

export class TaskQueue {
    constructor({ events, audit, config, state, client, storage }) {
        this._events  = events;
        this._audit   = audit;
        this._config  = config;
        this._state   = state;
        this._client  = client;
        this._storage = storage;

        // Referência ao CFO injetada após construção (evitar dependência circular)
        this._cfo = null;

        this._queue      = [];   // Task[]
        this._done       = [];   // últimas 50 tasks concluídas (histórico UI)
        this._executing  = false;

        // NOISE counter
        this._noiseCounter = 0;
        this._nextNoiseAt  = this._newNoiseThreshold();
    }

    /** Injetar referência ao CFO após construção (evitar circular). */
    setCFO(cfo) { this._cfo = cfo; }

    async init() {
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
            const EPHEMERAL_TYPES = new Set(['BUILD', 'RESEARCH']);
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
                    zombies++;
                    return { ...t, status: 'pending', scheduledFor: Date.now() + 5_000 };
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

    // ── API pública ───────────────────────────────────────────────────────────

    /** Adiciona uma task à fila. Rejeita duplicatas pendentes do mesmo tipo+cidade. */
    add(taskData) {
        // Deduplicação global: não adicionar se já há task pendente/in-flight do mesmo tipo+cidade
        // Exceções: NOISE (por design tem múltiplas) e tasks com payload diferente relevante
        if (taskData.type !== 'NOISE') {
            const duplicate = this._queue.find(t =>
                t.type   === taskData.type &&
                t.cityId === taskData.cityId &&
                (t.status === 'pending' || t.status === 'in-flight')
            );
            if (duplicate) {
                const schedIn = duplicate.scheduledFor > Date.now()
                    ? `em ${Math.round((duplicate.scheduledFor - Date.now()) / 1000)}s`
                    : 'imediata';
                this._audit.debug('TaskQueue',
                    `Task duplicada ignorada: ${taskData.type} cidade ${taskData.cityId} — já existe [${duplicate.id}] status=${duplicate.status} tentativas=${duplicate.attempts}/${duplicate.maxAttempts} exec=${schedIn}`
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
        };
        this._queue.push(task);
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

    /** Verifica se há BUILD pendente para uma cidade. */
    hasPendingBuild(cityId) {
        return this._queue.some(t =>
            t.type === 'BUILD' && t.cityId === cityId &&
            (t.status === 'pending' || t.status === 'in-flight')
        );
    }

    /** Verifica se há task de um tipo pendente para uma cidade. */
    hasPendingType(type, cityId) {
        return this._queue.some(t =>
            t.type === type && t.cityId === cityId &&
            (t.status === 'pending' || t.status === 'in-flight')
        );
    }

    /** Retorna histórico das últimas 50 tasks concluídas. */
    getHistory() { return [...this._done]; }

    /** Muda OperationMode e emite evento. */
    async setMode(mode) {
        await this._config.set('operationMode', mode);
        this._events.emit(this._events.E.QUEUE_MODE_CHANGED, { mode });
        this._audit.info('TaskQueue', `OperationMode alterado para ${mode}`);
    }

    // ── Loop principal ────────────────────────────────────────────────────────

    _tick() {
        const now  = Date.now();
        const mode = this._config.get('operationMode');

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

        if (!this._executing && mode !== 'MANUAL' && !this._state.isProbing()) {
            const ready = this._queue
                .filter(t => t.status === 'pending' && t.scheduledFor <= now)
                .sort((a, b) => a.priority - b.priority || a.scheduledFor - b.scheduledFor);

            if (ready.length > 0) {
                this._execute(ready[0]).catch(err => {
                    this._audit.error('TaskQueue', `_execute uncaught: ${err.message}`);
                });
            }
        }

        // Loop com setTimeout recursivo (não setInterval — armadilha documentada)
        const delay = document.visibilityState === 'hidden' ? 5_000 : 1_000;
        setTimeout(() => this._tick(), delay);
    }

    // ── Execução ──────────────────────────────────────────────────────────────

    async _execute(task) {
        this._executing = true;
        this._executingStartedAt = Date.now();
        task.status     = 'in-flight';
        this._persist();
        this._events.emit(this._events.E.QUEUE_TASK_STARTED, { task });

        this._audit.info('TaskQueue',
            `▶ [${task.id}] ${task.type} cidade ${task.cityId} tentativa ${task.attempts + 1}/${task.maxAttempts} — ${task.reason ?? ''}`);

        try {
            // 1. OperationMode
            const mode = this._config.get('operationMode');
            if (mode === 'MANUAL') {
                task.status = 'blocked';
                this._persist();
                return;
            }
            if (mode === 'SAFE' && task.confidence !== 'HIGH') {
                task.status = 'blocked';
                this._audit.warn('TaskQueue',
                    `SAFE MODE: task ${task.id} suspensa — confiança ${task.confidence}`,
                    { cityId: task.cityId }
                );
                this._persist();
                return;
            }

            // 2. Verificar probing (fetchAllCities em andamento)
            // TODOS os tipos pausam durante probing — não só BUILD.
            // Razão: probes usam GameClient._enqueue. Se um TRANSPORT ou WINE_ADJUST
            // também enfileirar via _enqueue durante probing, o dispatch fica preso
            // esperando todos os probes completarem (serialização da chain interna).
            if (this._state.isProbing()) {
                // NOISE: atrasar menos (é baixa prioridade, não crítico)
                const delayMs = task.type === 'NOISE' ? 10_000 : 30_000;
                this._reschedule(task, delayMs);
                this._audit.debug('TaskQueue',
                    `Task [${task.id}] ${task.type} pausada durante fetchAllCities — reagendando em ${delayMs / 1000}s`
                );
                return;
            }

            // 3. Adquirir session lock — garante exclusividade durante navigate + action.
            // fetchAllCities também adquire este lock, então nunca se interpõe entre
            // o navigate do guard e o dispatch da task.
            await this._client.acquireSession(async () => {
                // 3a. Guards específicos por tipo (navigate acontece aqui dentro)
                await this._runGuards(task);

                // 3b. Executar via GameClient
                await this._dispatch(task);
            });

            // 5. Sucesso
            task.status = 'done';
            this._persist();
            this._events.emit(this._events.E.QUEUE_TASK_DONE, { task });
            const elapsed = Date.now() - this._executingStartedAt;
            this._audit.info('TaskQueue',
                `✓ [${task.id}] ${task.type} concluído em ${elapsed}ms`);
            this._moveToHistory(task);

            // Incrementar contador de noise
            this._noiseCounter++;
            if (this._noiseCounter >= this._nextNoiseAt) {
                this._scheduleNoise();
            }

        } catch (err) {
            task.attempts++;

            if (err instanceof GameError && err.type === 'GUARD_CANCEL') {
                // GUARD_CANCEL: task já movida para histórico dentro do guard (ex: cidade já construindo).
                // Não incrementar tentativas, não re-agendar — CFO vai re-criar quando necessário.
                this._audit.info('TaskQueue',
                    `↷ [${task.id}] ${task.type} cancelado: ${err.message}`
                );

            } else if (err instanceof GameError && err.guard) {
                // GUARD: pré-condição não atendida — task já reagendada dentro de _runGuards,
                // OU o GUARD veio de _dispatch (ex: endUpgradeTime=-1 no upgradeBuilding).
                // Se a task ainda está in-flight, reagendar com delay padrão.
                if (task.status === 'in-flight') {
                    this._reschedule(task, 30 * 60_000); // 30min — aguardar transporte ou fim de build
                }
                // Attempts SÃO incrementados para evitar loops infinitos.
                // Se atingir maxAttempts via guard repetido, cancelar a task.
                this._audit.debug('TaskQueue',
                    `↷ [${task.id}] ${task.type} guard (${task.attempts}/${task.maxAttempts}): ${err.message}`
                );
                if (task.attempts >= task.maxAttempts) {
                    task.status = 'failed';
                    this._audit.warn('TaskQueue',
                        `✗ [${task.id}] ${task.type} cancelado após ${task.maxAttempts}× guard sem sucesso — ${err.message}`,
                        { cityId: task.cityId }
                    );
                    this._events.emit(this._events.E.QUEUE_TASK_FAILED, { task, error: err.message, fatal: false });
                    this._moveToHistory(task);
                }
                this._persist();

            } else if (err instanceof GameError && err.fatal) {
                task.status = 'failed';
                const elapsed = Date.now() - this._executingStartedAt;
                this._audit.error('TaskQueue',
                    `✗ [${task.id}] ${task.type} FATAL em ${elapsed}ms: ${err.message}`,
                    { type: err.type, cityId: task.cityId }
                );
                this._events.emit(this._events.E.QUEUE_TASK_FAILED, { task, error: err.message, fatal: true });
                this._persist();

            } else if (task.attempts >= task.maxAttempts) {
                task.status = 'failed';
                const elapsed = Date.now() - this._executingStartedAt;
                this._audit.error('TaskQueue',
                    `✗ [${task.id}] ${task.type} falhou ${task.maxAttempts}× em ${elapsed}ms: ${err.message}`,
                    { cityId: task.cityId }
                );
                this._events.emit(this._events.E.QUEUE_TASK_FAILED, { task, error: err.message, fatal: false });
                this._persist();

            } else {
                // RETRY: reagendar em 30s
                this._reschedule(task, 30_000);
                this._audit.warn('TaskQueue',
                    `↺ [${task.id}] ${task.type} retry ${task.attempts}/${task.maxAttempts}: ${err.message}`
                );
            }

        } finally {
            this._executing = false;
            this._executingStartedAt = null;
        }
    }

    // ── Guards ────────────────────────────────────────────────────────────────

    async _runGuards(task) {
        switch (task.type) {
            case 'BUILD':
                await this._guardBuild(task);
                break;
            case 'TRANSPORT':
                await this._guardTransport(task);
                break;
            case 'WINE_ADJUST':
            case 'RESEARCH':
            case 'NOISE':
                // Todas as ações POST exigem estar na cidade correta
                await this._guardNavigate(task.cityId);
                break;
        }
    }

    /** Navega para a cidade se não for a ativa. Usado por guards que não têm lógica própria. */
    async _guardNavigate(cityId) {
        if (cityId && this._state.getActiveCityId() !== cityId) {
            await this._client.navigate(cityId);
        }
    }

    async _guardBuild(task) {
        const city = this._state.getCity(task.cityId);
        if (!city) {
            throw new GameError('GUARD', `Cidade ${task.cityId} não encontrada no estado`);
        }

        // Verificar slot já em construção — usar APENAS estado real da probe (city.underConstruction).
        // NÃO usar getUnderConstruction() pois este inclui _inferredBuilding, que é setado pelo
        // próprio QUEUE_TASK_STARTED antes do guard rodar, causando auto-bloqueio da task.
        // TaskQueue é sequencial: quando essa task roda, não há outra em paralelo para esta cidade.
        const uc = city.underConstruction ?? -1;
        if (uc !== -1 && uc !== false && uc !== null && Number(uc) !== -1) {
            const currentBuild = city.buildings?.[uc];
            const buildName    = currentBuild?.building ?? '?';
            const completedAt  = currentBuild?.completed;
            const etaMin       = completedAt ? Math.round((completedAt - Date.now() / 1000) / 60) : '?';
            task.status = 'cancelled';
            this._moveToHistory(task);
            this._persist();
            throw new GameError('GUARD_CANCEL',
                `GUARD BUILD: ${city.name} já construindo ${buildName} (slot ${uc}, ETA ${etaMin}min) — task cancelada`
            );
        }

        // Verificar slot bloqueado por pesquisa
        if (city.lockedPositions.has(task.payload.position)) {
            this._reschedule(task, 3_600_000);
            throw new GameError('GUARD', `GUARD BUILD: slot ${task.payload.position} bloqueado por pesquisa em ${city.name} — reagendando em 1h`);
        }

        // Navegar para a cidade se necessário (currentCityId no payload deve ser cidade ativa)
        const activeBefore = this._state.getActiveCityId();
        if (activeBefore !== task.cityId) {
            this._audit.debug('TaskQueue', `GUARD BUILD: navigate ${activeBefore} → ${task.cityId} (${city.name})`);
            await this._client.navigate(task.cityId);
        }

        // Verificar ouro suficiente (se CFO disponível)
        if (this._cfo && task.payload.cost) {
            if (!this._cfo.canAfford(task.cityId, task.payload.cost)) {
                this._reschedule(task, 3_600_000);
                throw new GameError('GUARD', `GUARD BUILD: recursos insuficientes para ${task.payload.building} em ${city.name} — aguardando transporte (1h)`);
            }
        }

        this._audit.debug('TaskQueue', `GUARD BUILD: ok — ${city.name} pos=${task.payload.position} building=${task.payload.buildingView}`);
    }

    async _guardTransport(task) {
        const origin = this._state.getCity(task.payload.fromCityId);
        if (!origin) {
            throw new GameError('GUARD', `GUARD TRANSPORT: cidade origem ${task.payload.fromCityId} não encontrada no estado`);
        }

        // Navegar para cidade origem — servidor exige currentCityId ativo (armadilha documentada)
        const activeBefore = this._state.getActiveCityId();
        if (activeBefore !== task.payload.fromCityId) {
            this._audit.debug('TaskQueue',
                `GUARD TRANSPORT: navigate ${activeBefore} → ${task.payload.fromCityId} (${origin.name})`
            );
            await this._client.navigate(task.payload.fromCityId);
        }

        // Ler freeTransporters APÓS navigate (estado atualizado pelo DC_HEADER_DATA da resposta)
        const freeT = this._state.getCity(task.payload.fromCityId)?.freeTransporters ?? 0;
        const maxT  = this._state.getCity(task.payload.fromCityId)?.maxTransporters  ?? 0;
        this._audit.debug('TaskQueue',
            `GUARD TRANSPORT: ${origin.name} transportadores ${freeT}/${maxT} livres, precisa ${task.payload.boats}, carga=${JSON.stringify(task.payload.cargo)}, wineEmergency=${!!task.payload.wineEmergency}`
        );

        if (!task.payload.wineEmergency && freeT < task.payload.boats) {
            const waitMs = (task.payload.estimatedReturnS ?? 3600) * 1000;
            this._reschedule(task, waitMs);
            throw new GameError('GUARD',
                `GUARD TRANSPORT: sem barcos livres em ${origin.name}: ${freeT} livre(s) < ${task.payload.boats} necessário(s) — aguardando ${Math.round(waitMs / 60000)}min`
            );
        }

        // Verificar fator de carga mínimo (exceto emergência de vinho)
        // Capacidade real: cada navio carrega 500 unidades de UM recurso.
        // Para transporte de N recursos, o gargalo é o recurso que precisa mais navios.
        if (!task.payload.wineEmergency) {
            const boatsActual   = task.payload.boats;
            // Capacidade por recurso: boatsActual × 500 (1 navio = 1 coluna = 500 unidades)
            const perResCapacity = boatsActual * 500;
            const largestCargo   = Math.max(
                ...Object.values(task.payload.cargo).map(v => Number(v) || 0)
            );
            const loadFactor = perResCapacity > 0 ? largestCargo / perResCapacity : 0;
            const minFactor  = this._config.get('transportMinLoadFactor');

            if (loadFactor < minFactor) {
                const waitMs = (task.payload.estimatedReturnS ?? 3600) * 1000;
                this._reschedule(task, waitMs);
                throw new GameError('GUARD',
                    `GUARD TRANSPORT: carga ${(loadFactor * 100).toFixed(0)}% < mínimo ${(minFactor * 100).toFixed(0)}% em ${origin.name} (maior recurso=${largestCargo}, navios=${boatsActual}, cap/recurso=${perResCapacity}) — aguardando`
                );
            }
        }

        this._audit.debug('TaskQueue',
            `GUARD TRANSPORT: ok — ${origin.name} → cidade ${task.payload.toCityId}, ${task.payload.boats} navios, carga=${JSON.stringify(task.payload.cargo)}`
        );
    }

    // ── Dispatch ──────────────────────────────────────────────────────────────

    async _dispatch(task) {
        switch (task.type) {
            case 'BUILD': {
                await this._client.upgradeBuilding(
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
                return;
            }

            case 'TRANSPORT':
                this._audit.info('TaskQueue',
                    `DISPATCH TRANSPORT: de cidade ${task.payload.fromCityId} → cidade ${task.payload.toCityId} (island ${task.payload.toIslandId}), ${task.payload.boats} navios, carga=${JSON.stringify(task.payload.cargo)}${task.payload.wineEmergency ? ' [EMERGÊNCIA]' : ''}`
                );
                return this._client.sendTransport(
                    task.payload.fromCityId,
                    task.payload.toCityId,
                    task.payload.toIslandId,
                    task.payload.cargo,
                    task.payload.boats
                );

            case 'RESEARCH':
                return this._client.startResearch(task.cityId, task.payload.researchId);

            case 'WINE_ADJUST': {
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

            case 'NAVIGATE':
            case 'NOISE':
                return this._client.navigate(task.cityId);

            case 'WORKER_REALLOC': {
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
        this._noiseCounter = 0;
        this._nextNoiseAt  = this._newNoiseThreshold();

        const views  = ['embassy', 'barracks', 'museum', 'academy', 'temple'];
        const view   = views[Math.floor(Math.random() * views.length)];
        const cities = this._state.getAllCities();
        if (!cities.length) return;

        const city = cities[Math.floor(Math.random() * cities.length)];

        this.add({
            type:         'NOISE',
            priority:     50,
            cityId:       city.id,
            payload:      { view },
            scheduledFor: Date.now() + 5_000 + Math.random() * 25_000, // 5–30s
            reason:       `Mimetismo: visita aleatória a ${view}`,
            module:       'CSO',
            confidence:   'HIGH',
            maxAttempts:  1,
        });
    }

    _newNoiseThreshold() {
        const min = this._config.get('noiseFrequencyMin') ?? 8;
        const max = this._config.get('noiseFrequencyMax') ?? 15;
        return min + Math.floor(Math.random() * (max - min));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _reschedule(task, delayMs) {
        task.status       = 'pending';
        task.scheduledFor = Date.now() + delayMs;
        this._persist();
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
        this._storage?.set?.('taskQueue', toSave).catch(() => {});
    }

    _persistHistory() {
        // Persistir as últimas 50 tasks concluídas — sobrevive reloads
        this._storage?.set?.('taskQueueDone', this._done.slice(-50)).catch(() => {});
    }
}
