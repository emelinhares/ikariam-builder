// StateManager.js — fonte única de verdade do sistema ERP
// Não faz requests. Consome eventos do DataCollector e mantém o estado de todas as cidades.
// Coordena fetchAllCities pausando builds durante navegação entre cidades.

import { deepClone } from './utils.js';
import { humanDelay } from './utils.js';

// Formata número em K/M para logs compactos
function _fmtK(n) {
    if (n == null || isNaN(n)) return '?';
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return String(Math.round(n));
}

export class StateManager {
    constructor({ events, audit, config }) {
        this._events  = events;
        this._audit   = audit;
        this._config  = config;

        // Estado principal
        this.cities          = new Map();   // cityId → CityState
        this.research        = null;        // ResearchState
        this.fleetMovements  = [];

        // Tempo do servidor
        this.serverTimeOffset = 0;          // (Date.now()/1000) - serverTs
        this.lastFullRefresh  = 0;

        // Controle interno
        this._activeCityId    = null;
        this._probing         = false;      // true durante fetchAllCities

        // Inferência de underConstruction para cidades não-ativas
        // Map<cityId, { position, startedAt }>
        this._inferredBuilding = new Map();

        // Promessa que resolve após o 1º model refresh
        this._ready        = false;
        this._readyPromise = new Promise(r => { this._resolveReady = r; });
    }

    init() {
        const E = this._events.E;
        this._events.on(E.DC_HEADER_DATA,     this._onHeaderData.bind(this));
        this._events.on(E.DC_MODEL_REFRESH,   this._onModelRefresh.bind(this));
        this._events.on(E.DC_SCREEN_DATA,     this._onScreenData.bind(this));
        this._events.on(E.DC_FLEET_MOVEMENTS, this._onFleetMovements.bind(this));
        this._events.on(E.DC_TOWNHALL_DATA,   this._onTownhallData.bind(this));

        // Inferência de underConstruction
        this._events.on(E.QUEUE_TASK_STARTED, this._onTaskStarted.bind(this));
        this._events.on(E.QUEUE_TASK_DONE,    this._onTaskDone.bind(this));
        this._events.on(E.QUEUE_TASK_FAILED,  this._onTaskDone.bind(this));
    }

    // ── API pública ───────────────────────────────────────────────────────────

    /** Resolve após o primeiro DC_MODEL_REFRESH — use com await antes de qualquer operação. */
    waitReady() { return this._readyPromise; }

    getCity(cityId)       { return this.cities.get(cityId) ?? null; }
    getAllCities()         { return [...this.cities.values()]; }
    getAllCityIds()        { return [...this.cities.keys()]; }
    getActiveCityId()     { return this._activeCityId; }
    isProbing()           { return this._probing; }

    /** Força cidade ativa — chamado pelo GameClient após navigate bem-sucedido. */
    setActiveCityId(cityId) { this._activeCityId = cityId; }

    /** Tempo atual do servidor em segundos Unix. */
    getServerNow() {
        return Math.floor(Date.now() / 1000) - this.serverTimeOffset;
    }

    /** true se os dados da cidade têm mais de 5 minutos. */
    needsRefresh(cityId) {
        const city = this.cities.get(cityId);
        if (!city) return true;
        return (Date.now() - city.fetchedAt) > 300_000;
    }

    /** Nível de confiança nos dados de uma cidade. */
    getConfidence(cityId) {
        const city = this.cities.get(cityId);
        if (!city || city.fetchedAt === 0) return 'UNKNOWN';
        const age = Date.now() - city.fetchedAt;
        if (age < 60_000)   return 'HIGH';
        if (age < 300_000)  return 'MEDIUM';
        return 'LOW';
    }

    /**
     * Retorna underConstruction da cidade:
     * - Para a cidade ativa: lê screenData real
     * - Para cidades não-ativas: usa inferência por evento de task
     * Retorna -1 se nenhuma construção em andamento.
     */
    getUnderConstruction(cityId) {
        const city = this.cities.get(cityId);
        if (!city) return -1;

        // Cidade ativa: screenData ao vivo (sempre mais fresco)
        // Outras cidades: dados do fetchAllCities (city.underConstruction) têm prioridade
        // sobre _inferredBuilding, pois capturam builds iniciados manualmente pelo jogador.
        const fromState = city.underConstruction ?? -1;
        if (fromState !== -1) return fromState;

        // Fallback: inferência por task BUILD iniciada pelo ERP nesta sessão
        return this._inferredBuilding.has(cityId)
            ? this._inferredBuilding.get(cityId).position
            : -1;
    }

    /**
     * Snapshot imutável do estado completo (para Optimizer — Fase B/C).
     * lockedPositions (Set) é serializado como array.
     */
    snapshot() {
        return deepClone({
            cities: Object.fromEntries(
                [...this.cities.entries()].map(([k, v]) => [k, {
                    ...v,
                    lockedPositions: [...v.lockedPositions],
                }])
            ),
            research: this.research
                ? { ...this.research, investigated: [...this.research.investigated] }
                : null,
            fleetMovements: this.fleetMovements,
            serverNow: this.getServerNow(),
        });
    }

    /**
     * Navega por todas as cidades para atualizar estado completo.
     * Pausa BUILD tasks durante a navegação via flag _probing.
     * Emite STATE_ALL_FRESH ao concluir.
     * @param {GameClient} gameClient
     */
    async fetchAllCities(gameClient) {
        if (this._probing) {
            this._audit.warn('StateManager', 'fetchAllCities já em andamento — ignorado');
            return;
        }

        this._probing = true;
        const cityIds = this.getAllCityIds();
        // Cidade real no servidor antes do fetchAllCities (probeCityData não muda sessão)
        const serverCityBefore = Number(
            globalThis.ikariam?.model?.relatedCityData?.selectedCityId ?? 0
        ) || this._activeCityId;

        this._audit.info('StateManager', `fetchAllCities iniciado — ${cityIds.length} cidades`);

        // Session lock: impede que tasks do TaskQueue (navigate + action) se interponham
        // durante os probes. O lock é liberado apenas após navigate de retorno ao final.
        await gameClient.acquireSession(async () => {
            for (const cityId of cityIds) {
                try {
                    // probeCityData é um GET simples — NÃO altera a cidade ativa no servidor.
                    // Não atualizar _activeCityId aqui para não desincronizar do estado real do servidor.
                    await gameClient.probeCityData(cityId);
                    await humanDelay(1200, 2000);
                } catch (err) {
                    this._audit.error('StateManager', `fetchAllCities erro em cidade ${cityId}: ${err.message}`);
                }
            }

            // Probe do assessor militar — atualiza fleetMovements
            try {
                await gameClient.fetchMilitaryAdvisor();
            } catch (err) {
                this._audit.debug('StateManager', `fetchMilitaryAdvisor falhou (não crítico): ${err.message}`);
            }

            // Navigate de retorno — sincroniza servidor com a cidade onde estava antes.
            // Feito DENTRO do lock: só libera após o servidor estar na cidade correta,
            // garantindo que a próxima task encontre estado consistente.
            if (serverCityBefore) {
                try {
                    await gameClient.navigate(serverCityBefore);
                } catch {
                    // ignorar — não crítico para liberar o lock
                }
            }
        });

        this._probing = false;
        this.lastFullRefresh = Date.now();

        // Relatório de ciclo — snapshot técnico de todas as cidades
        this._emitCycleReport();

        this._audit.info('StateManager', 'fetchAllCities concluído');
        this._events.emit(this._events.E.STATE_ALL_FRESH, { ts: this.lastFullRefresh });
    }

    // ── Handlers de eventos DC ────────────────────────────────────────────────

    _onModelRefresh({ model }) {
        // Atualizar offset de tempo do servidor a cada refresh (corrige drift)
        const serverTs = Number(model.serverTime ?? 0);
        if (serverTs > 0) {
            this.serverTimeOffset = Math.floor(Date.now() / 1000) - serverTs;
        }

        // Atualizar cidade ativa e lista de cidades conhecidas
        const relatedData = model.relatedCityData;
        if (relatedData) {
            const rawSelected = relatedData.selectedCity ?? relatedData.selectedCityId ?? '';
            const selectedId  = Number(String(rawSelected).replace('city_', ''));
            // Não sobrescrever _activeCityId durante fetchAllCities (_probing = true):
            // o loop de probing gerencia _activeCityId diretamente e o model nativo
            // pode ainda apontar para a cidade original enquanto navegamos entre cidades.
            if (selectedId > 0 && !this._probing) this._activeCityId = selectedId;

            for (const [key, cityData] of Object.entries(relatedData)) {
                // chaves podem ser "city_6580" ou "6580"
                const cityId = Number(String(key).replace('city_', ''));
                if (isNaN(cityId) || cityId === 0) continue;
                // Ignorar cidades desconhecidas sem tradegood — são cidades de outros jogadores
                // na mesma ilha. Cidades próprias sempre têm tradegood definido no relatedCityData.
                if (!this.cities.has(cityId) && !('tradegood' in (cityData ?? {}))) continue;

                if (!this.cities.has(cityId)) {
                    this.cities.set(cityId, this._createEmptyCityState(cityId, cityData));
                }

                const city = this.cities.get(cityId);
                if (cityData.coords) {
                    // formato "[61:78] " ou {x,y}
                    if (typeof cityData.coords === 'string') {
                        const m = cityData.coords.match(/(\d+):(\d+)/);
                        if (m) city.coords = [Number(m[1]), Number(m[2])];
                    } else {
                        city.coords = [Number(cityData.coords.x), Number(cityData.coords.y)];
                    }
                }
                if (cityData.islandId) city.islandId = Number(cityData.islandId);
                if (cityData.name)     city.name     = cityData.name;
                if (cityData.tradegood !== undefined) {
                    city.tradegood = Number(cityData.tradegood);
                }
            }
        }

        // Pesquisa
        if (model.research) {
            this.research = {
                investigated:  new Set(model.research.investigated ?? []),
                inProgress:    model.research.inProgress ?? null,
                pointsPerHour: Number(model.research.pointsPerHour ?? 0),
                fetchedAt:     Date.now(),
            };
            this._events.emit(this._events.E.STATE_RESEARCH, { research: this.research });
        }

        // lockedPositions da cidade ativa (da view de cidade)
        if (model.backgroundView?.lockedPosition) {
            const cityId = this._activeCityId;
            if (cityId && this.cities.has(cityId)) {
                const locked = model.backgroundView.lockedPosition;
                this.cities.get(cityId).lockedPositions =
                    new Set(Object.keys(locked).map(Number));
            }
        }

        // Resolver waitReady() após o primeiro refresh
        if (!this._ready) {
            this._ready = true;
            this._resolveReady();
            this._events.emit(this._events.E.STATE_READY, {});
            this._audit.info('StateManager', 'estado pronto — 1º model refresh recebido');
        }
    }

    _onHeaderData({ headerData, cityId: evtCityId }) {
        // Preferir cityId do evento (vem de backgroundData.id — autoritativo)
        const cityId = evtCityId || this._activeCityId;
        if (!cityId) return;

        if (!this.cities.has(cityId)) {
            this.cities.set(cityId, this._createEmptyCityState(cityId, {}));
        }
        const city = this.cities.get(cityId);

        // Recursos — chaves numéricas: 'resource'=wood, '1'=wine, '2'=marble, '3'=glass, '4'=sulfur
        const res = headerData.currentResources;
        if (res) {
            city.resources.wood   = Number(res.resource ?? res.wood   ?? city.resources.wood);
            city.resources.wine   = Number(res['1']     ?? res.wine   ?? city.resources.wine);
            city.resources.marble = Number(res['2']     ?? res.marble ?? city.resources.marble);
            city.resources.glass  = Number(res['3']     ?? res.glass  ?? city.resources.glass);
            city.resources.sulfur = Number(res['4']     ?? res.sulfur ?? city.resources.sulfur);
            if (res.citizens !== undefined) city.economy.citizens = Number(res.citizens);
            if (res.population !== undefined) city.economy.population = Number(res.population);
        }

        // maxResources — mesmo formato de chaves
        const maxRes = headerData.maxResources;
        if (maxRes) {
            city.maxResources = Number(maxRes.resource ?? maxRes['0'] ?? city.maxResources);
        } else if (headerData.maxStorage !== undefined) {
            city.maxResources = Number(headerData.maxStorage);
        }

        if (headerData.freeTransporters !== undefined)
            city.freeTransporters = Number(headerData.freeTransporters);
        if (headerData.maxTransporters !== undefined)
            city.maxTransporters  = Number(headerData.maxTransporters);
        if (headerData.wineSpendings !== undefined)
            city.production.wineSpendings = Number(headerData.wineSpendings);

        // producedTradegood chega como STRING — forçar Number()
        if (headerData.producedTradegood !== undefined)
            city.tradegood = Number(headerData.producedTradegood);

        // Produção /h — derivada do model (resourceProduction × 3600)
        // DataCollector já calcula woodPerHour/tradegoodPerHour; fallback via raw × 3600
        if (headerData.woodPerHour !== undefined)
            city.production.wood = Number(headerData.woodPerHour);
        else if (headerData.resourceProduction !== undefined)
            city.production.wood = Math.floor(Number(headerData.resourceProduction) * 3600);

        if (headerData.tradegoodPerHour !== undefined)
            city.production.tradegood = Number(headerData.tradegoodPerHour);
        else if (headerData.tradegoodProduction !== undefined)
            city.production.tradegood = Math.floor(Number(headerData.tradegoodProduction) * 3600);

        // tavernWineLevel — derivado de wineSpendings via WINE_USE.indexOf (IKAEASY padrão)
        // Só atualizar se o valor é ≥ 0 (0 = taberna desligada; -1 = não encontrado = não sobreescrever)
        if (headerData._tavernWineLevel !== undefined && headerData._tavernWineLevel >= 0)
            city.tavern.wineLevel = headerData._tavernWineLevel;

        if (headerData.income !== undefined)
            city.economy.goldPerHour = Number(headerData.income);
        if (headerData.gold !== undefined)
            city.economy.goldPerHour = Number(headerData.gold);

        if (headerData.maxActionPoints !== undefined)
            city.economy.actionPoints = Number(headerData.maxActionPoints);

        city.fetchedAt = Date.now();
        this._events.emit(this._events.E.STATE_CITY_UPDATED, { cityId });
    }

    _onScreenData({ screenData, cityId: evtCityId }) {
        const cityId = evtCityId || this._activeCityId;
        if (!cityId) return;

        if (!this.cities.has(cityId)) {
            this.cities.set(cityId, this._createEmptyCityState(cityId, {}));
        }
        const city = this.cities.get(cityId);

        // Posições de edifícios da cidade
        // position[] vem com {name, building, level, completed, isBusy, ...}
        // O campo building pode ser "constructionSite" (vazio), "constructionSiteAcademy" (prefix)
        // OU "vineyard constructionSite" (suffix) — o servidor usa os dois formatos.
        if (Array.isArray(screenData.position)) {
            city.buildings = screenData.position.map((b, idx) => {
                const raw = b.building ?? '';
                // isUpgrading: true se "constructionSite" aparece em QUALQUER posição do campo.
                // isBusy NÃO é usado — captura produção de navios/soldados, não upgrades.
                const isUpgrading = /constructionSite/i.test(raw);
                return {
                    position:    idx,
                    building:    raw.replace(/\s*constructionSite\s*/gi, '').trim() || raw,
                    level:       Number(b.level ?? 0),
                    isBusy:      !!b.isBusy,
                    isUpgrading,
                    completed:   b.completed ? Number(b.completed) : null,
                };
            });

            // underConstruction: índice do slot em upgrade.
            // Fallback para screenData.underConstruction (campo top-level do backgroundData)
            // que o servidor sempre envia e é a fonte mais confiável.
            let upgIdx = city.buildings.findIndex(b => b.isUpgrading);
            if (upgIdx === -1 && screenData.underConstruction != null && screenData.underConstruction !== false) {
                const uc = Number(screenData.underConstruction);
                if (uc >= 0) {
                    upgIdx = uc;
                    this._audit.debug('StateManager',
                        `underConstruction via top-level: cidade ${cityId} slot ${upgIdx}`
                    );
                }
            }
            city.underConstruction = upgIdx;
        }

        // islandId: só sobrescrever se ainda não confirmado.
        // Views como 'transport' retornam islandId do destino em bgData — corromperia a cidade origem.
        if (screenData.islandId && !city.islandId) city.islandId = Number(screenData.islandId);

        if (screenData.citizens !== undefined) {
            city.economy.citizens = Number(screenData.citizens);
        }

        if (screenData.inhabitants !== undefined) {
            city.economy.population = Number(screenData.inhabitants);
        }

        if (screenData.maxInhabitants !== undefined) {
            city.economy.maxInhabitants = Number(screenData.maxInhabitants);
        }

        if (screenData.satisfaction !== undefined) {
            city.economy.satisfaction = Number(screenData.satisfaction);
        }

        if (screenData.corruption !== undefined) {
            city.economy.corruption = Number(screenData.corruption);
        }

        // Taberna — wineLevel é derivado de wineSpendings via WINE_USE (ver _onHeaderData).
        // Não sobrescrever aqui: model.city.tavernWineLevel = 0 por padrão, não confiável.

        // Slots bloqueados (pesquisa em andamento)
        if (screenData.lockedPosition) {
            city.lockedPositions = new Set(
                Object.keys(screenData.lockedPosition).map(Number)
            );
        }

        this._events.emit(this._events.E.STATE_CITY_UPDATED, { cityId });
    }

    _onFleetMovements({ movements }) {
        this.fleetMovements = movements;
    }

    /**
     * Soma o cargo de todas as frotas próprias em trânsito com destino a cityId.
     * Inclui apenas movimentos de ida (isReturn=false) e da nossa conta (isOwn=true).
     * Retorna { wood, wine, marble, glass, sulfur } — zeros para recursos sem transporte.
     */
    getInTransit(cityId) {
        const result = { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 };
        for (const m of this.fleetMovements) {
            if (!m.isOwn || m.isReturn) continue;
            if (m.targetCityId !== cityId) continue;
            for (const [res, qty] of Object.entries(m.cargo ?? {})) {
                if (res in result) result[res] += Number(qty) || 0;
            }
        }
        return result;
    }

    // DC_TOWNHALL_DATA — viewScriptParams do changeView:townHall
    // Espelha o townHall.controller.js do IKAEASY:
    //   priests, scientists, happinessLargeValue, populationGrowthValue,
    //   occupiedSpace, maxInhabitants, culturalGoods
    _onTownhallData({ cityId: evtCityId, params }) {
        const cityId = evtCityId || this._activeCityId;
        if (!cityId || !params) return;

        if (!this.cities.has(cityId)) {
            this.cities.set(cityId, this._createEmptyCityState(cityId, {}));
        }
        const city = this.cities.get(cityId);

        if (params.priests           !== undefined) city.workers.priests    = Number(params.priests);
        if (params.scientists        !== undefined) city.workers.scientists = Number(params.scientists);
        if (params.happinessLargeValue !== undefined) city.economy.satisfaction = Number(params.happinessLargeValue);
        if (params.populationGrowthValue !== undefined) city.economy.growthPerHour = Number(params.populationGrowthValue);
        if (params.occupiedSpace     !== undefined) city.economy.population  = Number(params.occupiedSpace);
        if (params.maxInhabitants    !== undefined) city.economy.maxInhabitants = Number(params.maxInhabitants);
        if (params.culturalGoods     !== undefined) city.economy.culturalGoods = Number(params.culturalGoods);

        this._audit.debug('StateManager',
            `townHall data: cidade ${cityId} priests=${params.priests} scientists=${params.scientists} growth=${params.populationGrowthValue}`
        );
        this._events.emit(this._events.E.STATE_CITY_UPDATED, { cityId });
    }

    // ── Inferência de underConstruction ──────────────────────────────────────

    _onTaskStarted({ task }) {
        if (task.type !== 'BUILD') return;
        this._inferredBuilding.set(task.cityId, {
            position:  task.payload.position,
            startedAt: Date.now(),
        });
        this._audit.debug('StateManager',
            `underConstruction inferido: cidade ${task.cityId} pos ${task.payload.position}`
        );
    }

    _onTaskDone({ task }) {
        if (task.type !== 'BUILD') return;
        this._inferredBuilding.delete(task.cityId);
        // A próxima visita à cidade atualizará underConstruction via screenData real
    }

    // ── Relatório de ciclo ────────────────────────────────────────────────────

    _emitCycleReport() {
        const cities = this.getAllCities();
        if (!cities.length) return;

        const lines = cities.map(c => {
            const conf = this.getConfidence(c.id);
            const uc   = this.getUnderConstruction(c.id);
            const ucStr = uc !== -1
                ? `🔨${(c.buildings?.[uc]?.building ?? '?').replace(/^constructionSite/i,'')}`
                : '';
            const overflow = c.maxResources > 0
                ? Object.entries(c.resources)
                    .filter(([, v]) => v > c.maxResources * 0.95)
                    .map(([k]) => `⚠${k}`)
                    .join('')
                : '';
            return `${c.name}[${conf}] ` +
                `🪵${_fmtK(c.resources.wood)} ` +
                `🍷${_fmtK(c.resources.wine)} ` +
                `🪨${_fmtK(c.resources.marble)} ` +
                `💎${_fmtK(c.resources.glass)} ` +
                `💥${_fmtK(c.resources.sulfur)} ` +
                `🚢${c.freeTransporters} ` +
                `gold+${_fmtK(c.economy.goldPerHour)}/h` +
                (ucStr    ? ` ${ucStr}` : '') +
                (overflow ? ` ${overflow}` : '');
        });

        this._audit.info('StateManager', `=== CICLO COMPLETO ===`);
        for (const line of lines) {
            this._audit.info('StateManager', line);
        }
    }

    // ── Fábrica de estado vazio ───────────────────────────────────────────────

    _createEmptyCityState(id, data) {
        return {
            id,
            name:             data.name      ?? `City ${id}`,
            isCapital:        data.isCapital  ?? false,
            islandId:         Number(data.islandId  ?? 0),
            tradegood:        Number(data.tradegood ?? 0),
            coords:           data.coords
                ? [Number(data.coords.x), Number(data.coords.y)]
                : [0, 0],
            resources:        { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 },
            maxResources:     0,
            freeTransporters: 0,
            maxTransporters:  0,
            production:       { wood: 0, tradegood: 0, wineSpendings: 0 },
            buildings:        [],          // array de { position, buildingId, level }
            underConstruction: -1,         // posição do slot em construção, -1 = livre
            lockedPositions:  new Set(),   // slots bloqueados por pesquisa
            workers: {
                wood:       0,
                tradegood:  0,
                scientists: 0,
                priests:    0,
            },
            economy: {
                population:     0,
                maxInhabitants: 0,
                citizens:       0,
                goldPerHour:    0,
                corruption:     0,
                satisfaction:   null, // null = não inicializado (jogo não reportou ainda)
                growthPerHour:  0,
                actionPoints:   0,
                culturalGoods:  0,
            },
            tavern: {
                wineLevel:   0,
                winePerHour: 0,
            },
            fetchedAt: 0,
        };
    }
}
