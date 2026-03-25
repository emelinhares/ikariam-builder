// GameClient.js — único ponto de saída para requests ao jogo
// Fila interna de Promises garante serialização + humanDelay entre cada request.
// Nenhum módulo de negócio faz fetch/XHR diretamente — tudo passa aqui.

import { humanDelay } from './utils.js';

// ─── Taxonomia de erros ───────────────────────────────────────────────────────
// Usado pelo TaskQueue para decidir retry vs fatal vs guard
export class GameError extends Error {
    constructor(type, message) {
        super(message);
        this.name = 'GameError';
        this.type = type;
        // RETRY : erro transiente (HTTP_ERROR, GAME_ERROR temporário) — tentar novamente
        // FATAL : erro permanente (PARSE_ERROR) — não tentar novamente
        // GUARD : pré-condição não atendida — não é erro de rede, reagendar
        this.fatal = (type === 'PARSE_ERROR' || type === 'FATAL');
        this.guard = (type === 'GUARD');
    }
}

export class GameClient {
    constructor({ events, audit, config, state, dc }) {
        this._events = events;
        this._audit  = audit;
        this._config = config;
        this._state  = state;
        this._dc     = dc;

        // Fila interna — toda chamada encadeia aqui, serialização garantida
        this._queue = Promise.resolve();

        // Session lock — mutex de promise para operações compostas que alteram cidade ativa.
        // Garante que fetchAllCities e tasks do TaskQueue nunca se interponham durante
        // uma sequência navigate → action.
        this._sessionLock = Promise.resolve();
    }

    /**
     * Adquire o session lock e executa `fn` com exclusividade.
     * Qualquer outro acquireSession que chegar durante a execução de fn
     * ficará suspenso até fn retornar ou lançar.
     *
     * O lock é liberado mesmo em caso de erro — fn deve propagar erros normalmente.
     */
    acquireSession(fn) {
        const result = this._sessionLock.then(fn);
        // Encadeia um handler que nunca rejeita — garante que erros em fn
        // não travam o lock para os próximos chamadores.
        this._sessionLock = result.then(() => {}, () => {});
        return result;
    }

    // ── API pública ───────────────────────────────────────────────────────────

    /**
     * Navega para uma cidade e garante que a sessão do servidor está na cidade correta.
     *
     * Estratégia dual:
     *   Path 1 — form nativo (ajaxHandlerCallFromForm): disponível apenas na view de cidade.
     *             Atualiza ikariam.model.relatedCityData.selectedCityId nativamente.
     *   Path 2 — AJAX direto: funciona em qualquer tela, sem dependência de DOM.
     *             Patcha ikariam.model manualmente para evitar que o monitor DC sobrescreva.
     *
     * Em ambos os caminhos: chama state.setActiveCityId(cityId) ao final.
     */
    /**
     * Navega para uma cidade simulando o que uma pessoa faz:
     * abre o porto da cidade alvo (GET view=port cityId=X currentCityId=X).
     *
     * Isso força o servidor a estabelecer X como cidade ativa — sem depender
     * de changeCurrentCity que requer currentCityId correto e falha com location:5.
     *
     * Confirmação: headerData.selectedCityId na resposta JSON do GET.
     * Tenta até 3x com pausa crescente.
     */
    navigate(cityId) {
        return this._enqueue(async () => {
            if (this._state.getActiveCityId() === cityId) return;

            const MAX_ATTEMPTS = 3;

            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                this._audit.debug('GameClient',
                    `navigate (${attempt}/${MAX_ATTEMPTS}): → ${cityId}`);

                let serverCity = null;
                try {
                    // Abrir o porto da cidade alvo — mesmo request que o jogo faz
                    // quando o usuário clica na aba do porto. O servidor aceita sempre
                    // porque cityId e currentCityId são a mesma cidade (sem estado anterior).
                    const fromCity = this._state.getCity(cityId);
                    const portSlot = fromCity?.buildings?.find(b => b.building === 'port')?.position ?? 1;
                    const text = await this._get(
                        `/index.php?view=port&cityId=${cityId}&position=${portSlot}` +
                        `&backgroundView=city&currentCityId=${cityId}&activeTab=tabSendTransporter&ajax=1`
                    );
                    const data = JSON.parse(text.trim());
                    if (Array.isArray(data)) {
                        const g = data.find(c => Array.isArray(c) && c[0] === 'updateGlobalData');
                        if (g?.[1]?.actionRequest) this._dc.setToken(g[1].actionRequest);
                        // backgroundData.id é a fonte confirmada nos RECs (cityId:XXXX na resposta)
                        // headerData.selectedCityId é fallback — pode não vir em todas as respostas
                        serverCity = Number(g?.[1]?.backgroundData?.id ?? g?.[1]?.headerData?.selectedCityId ?? 0) || null;
                    }
                } catch (err) {
                    this._audit.warn('GameClient', `navigate tentativa ${attempt} erro: ${err.message}`);
                }

                if (serverCity === cityId) {
                    // Confirmado pelo servidor
                    this._state.setActiveCityId(cityId);
                    this._audit.info('GameClient',
                        `navigate: ✓ cidade ${cityId} confirmada pelo servidor${attempt > 1 ? ` (tentativa ${attempt})` : ''}`);
                    return;
                }

                if (serverCity && serverCity !== cityId) {
                    // Servidor está em cidade diferente — atualizar estado local e tentar novamente
                    this._audit.warn('GameClient',
                        `navigate tentativa ${attempt}: servidor em ${serverCity}, esperado ${cityId}`);
                    this._state.setActiveCityId(serverCity);
                } else {
                    // Sem confirmação — parse falhou ou selectedCityId ausente na resposta
                    this._audit.warn('GameClient',
                        `navigate tentativa ${attempt}: sem confirmação do servidor (selectedCityId ausente)`);
                }

                if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 2000 * attempt));
            }

            throw new GameError('GAME_ERROR', `navigate: falhou ${MAX_ATTEMPTS}× para cidade ${cityId}`);
        });
    }

    /**
     * Busca dados completos de uma cidade via port.
     * view=port retorna backgroundData com position[] (todos os edifícios) + headerData.
     * view=townHall retorna apenas os dados do próprio townHall — sem position[].
     */
    probeCityData(cityId) {
        return this._enqueue(() => {
            const city     = this._state.getCity(cityId);
            const portSlot = city?.buildings?.find(b => b.building === 'port')?.position ?? 1;
            return this._get(
                `/index.php?view=port&cityId=${cityId}&position=${portSlot}` +
                `&backgroundView=city&currentCityId=${cityId}&activeTab=tabSendTransporter&ajax=1`
            );
        });
    }

    /**
     * Inicia upgrade de um edifício existente.
     *
     * Simula o jogador: primeiro abre o edifício (GET view=buildingView),
     * depois envia o POST UpgradeExistingBuilding.
     * `currentLevel` = nível ATUAL do edifício (antes da melhoria).
     */
    upgradeBuilding(cityId, position, buildingView, currentLevel) {
        return this._enqueue(async () => {
            // activeTab = "tab" + buildingView com primeira letra maiúscula
            // Confirmado via REC: view=safehouse → activeTab=tabSafehouse
            const activeTab = 'tab' + buildingView.charAt(0).toUpperCase() + buildingView.slice(1);
            const { text, endUpgradeTime } = await this._postWithContext(
                `/index.php?view=${buildingView}&cityId=${cityId}&position=${position}` +
                `&backgroundView=city&currentCityId=${cityId}&ajax=1`,
                {
                    action:        'UpgradeExistingBuilding',
                    cityId:        String(cityId),
                    position:      String(position),
                    level:         String(currentLevel),
                    activeTab,
                    currentCityId: String(cityId),
                },
                `upgradeBuilding ${buildingView} cidade ${cityId}`
            );

            if (!endUpgradeTime || endUpgradeTime <= 0) {
                this._audit.warn('GameClient',
                    `upgradeBuilding: endUpgradeTime=${endUpgradeTime} — rejeitado silenciosamente`);
                throw new GameError('GUARD', `Build rejeitada — endUpgradeTime=${endUpgradeTime}`);
            }

            const eta = new Date(endUpgradeTime * 1000).toLocaleTimeString('pt-BR');
            this._audit.info('GameClient', `✓ Build aceita — conclui às ${eta}`);
            await new Promise(r => setTimeout(r, 300));
            return text;
        });
    }

    /** Envia transportadores com carga para outra cidade. */
    sendTransport(fromCityId, toCityId, toIslandId, cargo, boats) {
        return this._enqueue(async () => {
            const fromCity = this._state.getCity(fromCityId);
            const portSlot = fromCity?.buildings?.find(b => b.building === 'port')?.position ?? 1;
            const contextUrl =
                `/index.php?view=transport&destinationCityId=${toCityId}` +
                `&position=${portSlot}&currentCityId=${fromCityId}&ajax=1`;

            this._audit.info('GameClient',
                `sendTransport: from=${fromCityId} to=${toCityId} island=${toIslandId} boats=${boats} cargo=${JSON.stringify(cargo)}`
            );

            const MAX_ATTEMPTS = 3;
            let lastErr;
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                try {
                    await this._get(contextUrl);
                    await new Promise(r => setTimeout(r, 300));

                    const result = await this._post({
                        action:                'transportOperations',
                        function:              'loadTransportersWithFreight',
                        destinationCityId:     toCityId,
                        islandId:              toIslandId,
                        oldView:               '',
                        position:              '',
                        avatar2Name:           '',
                        city2Name:             '',
                        type:                  '',
                        activeTab:             '',
                        transportDisplayPrice: 0,
                        premiumTransporter:    0,
                        normalTransportersMax: boats,
                        transporters:          boats,
                        capacity:              5,
                        max_capacity:          5,
                        jetPropulsion:         0,
                        cargo_resource:        cargo.wood   ?? 0,
                        cargo_tradegood1:      cargo.wine   ?? 0,
                        cargo_tradegood2:      cargo.marble ?? 0,
                        cargo_tradegood3:      cargo.glass  ?? 0,
                        cargo_tradegood4:      cargo.sulfur ?? 0,
                        currentCityId:         String(fromCityId),
                        currentTab:            'tabSendTransporter',
                        actionRequest:         this._token(),
                        ajax:                  1,
                    });

                    // Confirmar via fleetMoveList ou provideFeedback type:10
                    let confirmed = false;
                    try {
                        const data = JSON.parse(result.text.trim());
                        if (Array.isArray(data)) {
                            const fleetCmd = data.find(c => Array.isArray(c) && c[0] === 'fleetMoveList');
                            if (fleetCmd) {
                                const entries = Array.isArray(fleetCmd[1])
                                    ? fleetCmd[1] : Object.values(fleetCmd[1] ?? {});
                                confirmed = true;
                                for (const m of entries) {
                                    const origin = m.originCityName ?? m.originCityId ?? fromCityId;
                                    const target = m.targetCityName ?? m.targetCityId ?? toCityId;
                                    const cargoStr = m.cargo
                                        ? Object.entries(m.cargo).filter(([,v])=>Number(v)>0).map(([k,v])=>`${v} ${k}`).join(', ')
                                        : JSON.stringify(cargo);
                                    this._audit.info('GameClient',
                                        `✓ FROTA: ${origin} → ${target} | ${cargoStr} | ETA: ${m.eventTime ? new Date(m.eventTime*1000).toLocaleTimeString('pt-BR') : '?'}`);
                                }
                            }
                            if (!confirmed) {
                                const fb = data.find(c => Array.isArray(c) && c[0] === 'provideFeedback');
                                if (Array.isArray(fb?.[1]) && fb[1].find(f => f?.type === 10)) {
                                    confirmed = true;
                                    this._audit.info('GameClient',
                                        `✓ sendTransport aceito via provideFeedback — from=${fromCityId} to=${toCityId}`);
                                }
                            }
                        }
                    } catch { /* parse não crítico */ }

                    if (!confirmed) {
                        throw new GameError('GAME_ERROR',
                            `fleetMoveList ausente — from=${fromCityId} to=${toCityId}`);
                    }
                    return result;

                } catch (err) {
                    lastErr = err;
                    if (err.fatal) throw err;
                    if (attempt < MAX_ATTEMPTS) {
                        this._audit.warn('GameClient',
                            `sendTransport tentativa ${attempt}/${MAX_ATTEMPTS} falhou: ${err.message} — aguardando ${2*attempt}s`);
                        await new Promise(r => setTimeout(r, 2000 * attempt));
                    }
                }
            }
            throw lastErr;
        });
    }

    /**
     * Aloca cientistas na academia.
     * Abre a academy primeiro (simula clique do jogador), depois envia workerPlan.
     * 3 tentativas via _postWithContext.
     */
    setScientists(cityId, academyPosition, count) {
        return this._enqueue(() => this._postWithContext(
            `/index.php?view=academy&cityId=${cityId}&position=${academyPosition}` +
            `&backgroundView=city&currentCityId=${cityId}&ajax=1`,
            {
                action:        'IslandScreen',
                function:      'workerPlan',
                screen:        'academy',
                position:      String(academyPosition),
                s:             String(count),
                cityId:        String(cityId),
                currentCityId: String(cityId),
                ajax:          1,
            },
            `setScientists cidade ${cityId}`
        ));
    }

    /**
     * Inicia uma pesquisa.
     * Abre a academy primeiro para estabelecer contexto.
     * 3 tentativas via _postWithContext.
     */
    startResearch(cityId, researchId) {
        return this._enqueue(() => {
            const city = this._state.getCity(cityId);
            const academyPos = city?.buildings?.find(b => b.buildingId === 4)?.position ?? 10;
            return this._postWithContext(
                `/index.php?view=academy&cityId=${cityId}&position=${academyPos}` +
                `&backgroundView=city&currentCityId=${cityId}&ajax=1`,
                {
                    action:        'CityScreen',
                    function:      'startResearch',
                    researchId:    String(researchId),
                    cityId:        String(cityId),
                    currentCityId: String(cityId),
                    ajax:          1,
                },
                `startResearch ${researchId} cidade ${cityId}`
            );
        });
    }

    /**
     * Ajusta o nível de vinho da taberna.
     * Abre a taberna primeiro (simula clique do jogador), depois envia assignWinePerTick.
     * 3 tentativas via _postWithContext.
     */
    setTavernWine(cityId, tavernPosition, wineLevel) {
        return this._enqueue(() => this._postWithContext(
            `/index.php?view=tavern&cityId=${cityId}&position=${tavernPosition}` +
            `&backgroundView=city&currentCityId=${cityId}&ajax=1`,
            {
                action:        'CityScreen',
                function:      'assignWinePerTick',
                position:      String(tavernPosition),
                amount:        String(wineLevel),
                cityId:        String(cityId),
                currentCityId: String(cityId),
                ajax:          1,
            },
            `setTavernWine cidade ${cityId}`
        ));
    }

    /** Busca custos reais de um edifício (parse HTML do servidor). */
    async fetchBuildingCosts(cityId, position, buildingView) {
        const html = await this._enqueue(() => this._get(
            `/index.php?view=${buildingView}&cityId=${cityId}&position=${position}` +
            `&backgroundView=city&currentCityId=${cityId}&ajax=1`
        ));
        return this._parseCosts(html);
    }

    /** Busca view do assessor militar — atualiza fleetMovements via DC_FLEET_MOVEMENTS. */
    fetchMilitaryAdvisor() {
        return this._enqueue(() => this._post({
            view:          'militaryAdvisor',
            oldView:       'city',
            currentCityId: String(this._state.getActiveCityId() ?? ''),
            actionRequest: this._token(),
            ajax:          1,
        }));
    }

    /**
     * Probe de journeyTime para uma rota específica.
     * #journeyTime é um elemento do DOM vivo da página — não vem na response AJAX.
     * O jogo atualiza este elemento quando o porto está aberto com a rota selecionada.
     * Requer que o game DOM esteja renderizando a view de transporte correta.
     *
     * Fluxo: acionar a view de transporte via POST (igual ao jogo faz),
     * aguardar o DOM renderizar, ler o elemento.
     */
    async probeJourneyTime(fromCityId, toCityId) {
        // Acionar a view de transporte para forçar o jogo a calcular e renderizar #journeyTime
        await this._enqueue(() => this._post({
            view:              'transport',
            cityId:            String(fromCityId),
            destinationCityId: String(toCityId),
            position:          '1',
            activeTab:         'tabSendTransporter',
            currentCityId:     String(fromCityId),
            actionRequest:     this._token(),
            ajax:              1,
        }));

        // Aguardar DOM renderizar (o jogo processa changeView de forma assíncrona)
        await new Promise(r => setTimeout(r, 800));

        // Ler do DOM vivo da página
        const el = document.getElementById('journeyTime');
        if (!el) {
            this._audit.warn('GameClient', `probeJourneyTime: #journeyTime não encontrado (${fromCityId}→${toCityId})`);
            return null;
        }
        const seconds = parseInt(el.textContent.trim(), 10);
        if (isNaN(seconds)) {
            this._audit.warn('GameClient', `probeJourneyTime: #journeyTime="${el.textContent.trim()}" não é número`);
            return null;
        }
        this._audit.debug('GameClient', `probeJourneyTime: ${fromCityId}→${toCityId} = ${seconds}s`);
        return seconds;
    }

    // ── Internos ──────────────────────────────────────────────────────────────

    /**
     * Enfileira uma função na fila interna com humanDelay antes de executar.
     * Garante serialização (nunca dois requests simultâneos).
     *
     * IMPORTANTE: retorna a promise desta operação específica (opPromise),
     * NÃO this._queue. Se retornasse this._queue, o chamador aguardaria TODAS
     * as operações futuras enfileiradas depois (ex: probes do fetchAllCities),
     * causando esperas de até 30s+ desnecessárias.
     *
     * Isolamento de erros: this._queue é resetado para resolved após cada op,
     * independente de sucesso ou falha. Evita cascata de falhas onde um navigate
     * com erro bloquearia todos os probeCityData subsequentes.
     */
    _enqueue(fn) {
        const opPromise = this._queue
            .then(() => humanDelay(
                this._config.get('humanDelayMinMs'),
                this._config.get('humanDelayMaxMs')
            ))
            .then(fn);

        // Chain interna sempre continua, mesmo se esta op falhar
        this._queue = opPromise.then(
            () => Promise.resolve(),
            () => Promise.resolve()
        );

        return opPromise; // chamador recebe apenas a promise desta operação
    }

    /**
     * Abre uma view (GET) para estabelecer contexto no servidor,
     * depois executa um POST. Tenta até MAX_ATTEMPTS vezes com pausa crescente.
     *
     * @param {string} contextUrl  — URL do GET de contexto (view=academy, view=port, etc.)
     * @param {object} postPayload — payload do POST a executar após o GET
     * @param {string} label       — nome da operação para o log
     */
    async _postWithContext(contextUrl, postPayload, label = 'action') {
        const MAX_ATTEMPTS = 3;
        let lastErr;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                await this._get(contextUrl);
                await new Promise(r => setTimeout(r, 300));
                // Atualizar token no payload antes de cada tentativa
                postPayload.actionRequest = this._token();
                return await this._post(postPayload);
            } catch (err) {
                lastErr = err;
                if (err.fatal) throw err; // PARSE_ERROR não adianta retry
                if (attempt < MAX_ATTEMPTS) {
                    this._audit.warn('GameClient',
                        `${label} tentativa ${attempt}/${MAX_ATTEMPTS} falhou: ${err.message} — aguardando ${2 * attempt}s`);
                    await new Promise(r => setTimeout(r, 2000 * attempt));
                }
            }
        }
        throw lastErr;
    }

    _token() {
        const token = this._dc.getToken();
        if (!token) {
            this._audit.warn('GameClient', 'actionRequest token nulo — request pode ser rejeitado pelo servidor');
        }
        return token ?? '';
    }

    async _get(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        let resp;
        try {
            resp = await fetch(url, { credentials: 'include', signal: controller.signal });
        } catch (err) {
            throw new GameError('HTTP_ERROR', `GET ${url}: ${err.message}`);
        } finally {
            clearTimeout(timer);
        }
        if (!resp.ok) {
            throw new GameError('HTTP_ERROR', `GET ${url} → HTTP ${resp.status}`);
        }
        return resp.text();
    }

    async _post(payload) {
        // Remover campos undefined/null do payload
        const cleanPayload = Object.fromEntries(
            Object.entries(payload).filter(([, v]) => v !== undefined && v !== null)
        );

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        let resp;
        try {
            resp = await fetch('/index.php', {
                method:      'POST',
                credentials: 'include',
                headers:     { 'Content-Type': 'application/x-www-form-urlencoded' },
                body:        new URLSearchParams(cleanPayload).toString(),
                signal:      controller.signal,
            });
        } catch (err) {
            throw new GameError('HTTP_ERROR', `POST: ${err.message}`);
        } finally {
            clearTimeout(timer);
        }

        if (!resp.ok) {
            throw new GameError('HTTP_ERROR', `POST → HTTP ${resp.status}`);
        }

        const text = await resp.text();

        // Verificar resposta JSON do jogo (erros de token, sessão, etc.)
        let data;
        try {
            const trimmed = text.trim();
            if (trimmed.startsWith('[')) {
                data = JSON.parse(trimmed);
            }
        } catch {
            throw new GameError('PARSE_ERROR', `Resposta não-JSON: ${text.slice(0, 80)}`);
        }

        if (Array.isArray(data)) {
            const cmdNames = data.filter(c => Array.isArray(c)).map(c => c[0]).join(', ');

            // Erro explícito do servidor
            const errorCmd = data.find(c => Array.isArray(c) && c[0] === 'errorWindow');
            if (errorCmd) {
                const msg = errorCmd[1]?.message ?? errorCmd[1]?.title ?? JSON.stringify(errorCmd[1]).slice(0, 100);
                this._audit.error('GameClient', `errorWindow: ${msg}`);
                throw new GameError('GAME_ERROR', msg);
            }

            // Sessão expirada
            const redirectCmd = data.find(c => Array.isArray(c) && c[0] === 'redirect');
            if (redirectCmd) {
                this._audit.error('GameClient', `Sessão expirada — redirect: ${redirectCmd[1]}`);
                throw new GameError('GAME_ERROR', 'Sessão expirada — redirect detectado');
            }

            // Token CSRF atualizado
            const globalCmd = data.find(c => Array.isArray(c) && c[0] === 'updateGlobalData');
            if (globalCmd?.[1]?.actionRequest) {
                this._dc.setToken(globalCmd[1].actionRequest);
            }

            // popupData — presente em TODA resposta do Ikariam (null = sem popup).
            // Non-null = erro silencioso: "Já em construção", "Recursos insuficientes", etc.
            const popupCmd = data.find(c => Array.isArray(c) && c[0] === 'popupData');
            if (popupCmd && popupCmd[1] !== null) {
                const popup = popupCmd[1];
                const popupText = typeof popup === 'string'
                    ? popup
                    : (popup?.message ?? popup?.content ?? popup?.title ?? JSON.stringify(popup).slice(0, 200));
                this._audit.error('GameClient', `popupData — servidor recusou ação: ${popupText}`);
                throw new GameError('GAME_ERROR', `Servidor recusou: ${popupText}`);
            }

            // provideFeedback — type:10 = sucesso confirmado, location:5 = rejeição do servidor.
            // "Cuidado: a última acção não foi válida" → location:5 → navigate/action falhou.
            // "Os teus barcos já estão no teu porto" → locakey com SOURCEPORT_EQUAL → transporte inválido.
            // NOTA: location:5 indica erro independente do campo `type` — não usar `type == null`.
            const feedbackCmd = data.find(c => Array.isArray(c) && c[0] === 'provideFeedback');
            if (feedbackCmd) {
                const entries = Array.isArray(feedbackCmd[1]) ? feedbackCmd[1] : [];
                this._audit.debug('GameClient', `provideFeedback raw: ${JSON.stringify(entries).slice(0, 300)}`);
                const okEntry  = entries.find(f => f?.type === 10);
                // Erro real = locakey com ERROR ou SOURCEPORT_EQUAL.
                // location:5 sozinho NÃO é critério — aparece tanto em avisos de navegação
                // (type:null, "última acção não foi válida") quanto em erros reais (type:11,
                // "Não tens material suficiente"). Usar locakey como discriminador.
                const errEntry = entries.find(f =>
                    f?.locakey?.includes('ERROR')            // erros explícitos (recursos, validação)
                    || f?.locakey?.includes('SOURCEPORT_EQUAL') // "barcos já no porto"
                );
                if (okEntry && !errEntry) {
                    this._audit.info('GameClient', `✓ Servidor confirmou ação: "${okEntry.text}"`);
                } else if (errEntry) {
                    const msg = errEntry.text ?? errEntry.locakey ?? JSON.stringify(errEntry).slice(0, 100);
                    this._audit.error('GameClient', `provideFeedback erro: ${msg}`);
                    throw new GameError('GAME_ERROR', `Servidor recusou: ${msg}`);
                }
            }

            // fleetMoveList — confirma que barcos foram despachados
            const fleetCmd = data.find(c => Array.isArray(c) && c[0] === 'fleetMoveList');
            if (fleetCmd) {
                const fleet = fleetCmd[1];
                const count = Array.isArray(fleet) ? fleet.length : Object.keys(fleet ?? {}).length;
                this._audit.info('GameClient', `fleetMoveList: ${count} movimento(s) de frota confirmado(s)`);
            }

            // endUpgradeTime — quando o build termina (Unix timestamp em segundos)
            // Presente em updateGlobalData.backgroundData após UpgradeExistingBuilding.
            const globalCmd2 = data.find(c => Array.isArray(c) && c[0] === 'updateGlobalData');
            const endUpgradeTime = globalCmd2?.[1]?.backgroundData?.endUpgradeTime ?? null;
            if (endUpgradeTime) {
                this._audit.debug('GameClient', `endUpgradeTime: ${endUpgradeTime} (em ${Math.round((endUpgradeTime - Date.now()/1000)/60)}min)`);
            }

            this._audit.debug('GameClient', `POST: resposta — comandos=[${cmdNames}]${fleetCmd ? ' ✓ FROTA' : ''}`);

            // Expor endUpgradeTime no retorno para que o caller possa agendar re-avaliação
            return { text, endUpgradeTime };
        }

        return { text, endUpgradeTime: null };
    }

    /**
     * Parse de custos do HTML de um edifício.
     * Remove .accesshint antes de ler números — armadilha documentada.
     */
    _parseCosts(html) {
        const doc  = new DOMParser().parseFromString(html, 'text/html');
        const lis  = [...doc.querySelectorAll('ul.costs li, ul.resources li')];
        const cost = {};

        for (const li of lis) {
            // OBRIGATÓRIO: remover .accesshint ou os números ficam errados
            li.querySelector('.accesshint')?.remove();
            const text = li.textContent.trim().replace(/[.\s]/g, '');
            const val  = parseInt(text, 10);
            const cls  = [...li.classList].find(c => c !== 'costs' && c !== 'resources');
            if (cls && !isNaN(val) && val > 0) cost[cls] = val;
        }

        return cost;
    }
}
