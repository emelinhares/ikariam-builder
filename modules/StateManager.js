// StateManager.js — fonte única de verdade do sistema ERP
// Não faz requests. Consome eventos do DataCollector e mantém o estado de todas as cidades.
// Coordena fetchAllCities pausando builds durante navegação entre cidades.

import { deepClone } from './utils.js';
import { humanDelay } from './utils.js';
import { createEmptyResources } from './resourceContracts.js';
import { CityIslandMapper } from './CityIslandMapper.js';
import { CityStateUpdater } from './CityStateUpdater.js';

const CITY_ISLAND_MAP_STORAGE_KEY = 'erp_state_city_island_map_v1';

const FIELD_SOURCE_RANK = Object.freeze({
    model: 1,
    calculated: 2,
    html_request: 3,
    html: 4,
});

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

        // Unificação de identidade cidade↔ilha (anti-duplicação em contexto de ilha)
        this._cityIslandMapper = new CityIslandMapper({ audit });
        this._cityToIsland = this._cityIslandMapper.cityToIsland; // compat legado
        this._islandToCity = this._cityIslandMapper.islandToCity; // compat legado
        this._cityStateUpdater = new CityStateUpdater({ audit });

        // Promessa que resolve após o 1º model refresh
        this._ready        = false;
        this._readyPromise = new Promise(r => { this._resolveReady = r; });
        this._unsubscribers = [];

        this._restoreCityIslandMap();
    }

    init() {
        const E = this._events.E;
        this._trackUnsub(this._events.on(E.DC_HEADER_DATA,     this._onHeaderData.bind(this)));
        this._trackUnsub(this._events.on(E.DC_MODEL_REFRESH,   this._onModelRefresh.bind(this)));
        this._trackUnsub(this._events.on(E.DC_SCREEN_DATA,     this._onScreenData.bind(this)));
        this._trackUnsub(this._events.on(E.DC_FLEET_MOVEMENTS, this._onFleetMovements.bind(this)));
        this._trackUnsub(this._events.on(E.DC_TOWNHALL_DATA,   this._onTownhallData.bind(this)));

        // Inferência de underConstruction
        this._trackUnsub(this._events.on(E.QUEUE_TASK_STARTED, this._onTaskStarted.bind(this)));
        this._trackUnsub(this._events.on(E.QUEUE_TASK_DONE,    this._onTaskDone.bind(this)));
        this._trackUnsub(this._events.on(E.QUEUE_TASK_FAILED,  this._onTaskDone.bind(this)));
    }

    shutdown() {
        for (const unsub of this._unsubscribers.splice(0)) {
            try { unsub(); } catch { /* best-effort */ }
        }
    }

    _trackUnsub(unsub) {
        if (typeof unsub === 'function') this._unsubscribers.push(unsub);
    }

    // ── API pública ───────────────────────────────────────────────────────────

    /** Resolve após o primeiro DC_MODEL_REFRESH — use com await antes de qualquer operação. */
    waitReady() { return this._readyPromise; }

    getCity(cityId)       {
        const city = this.cities.get(cityId);
        return city ? { ...city } : null;
    }
    getCityRef(cityId)    { return this.cities.get(cityId) ?? null; }
    getAllCities()         { return [...this.cities.values()]; }
    getAllCityIds()        { return [...this.cities.keys()]; }
    getActiveCityId()     { return this._activeCityId; }
    isProbing()           { return this._probing; }

    /** Registra/atualiza mapeamento bidirecional cidade↔ilha e persiste em storage local. */
    registerCityIslandMapping({ cityId, islandId } = {}) {
        const changed = this._cityIslandMapper.register({ cityId, islandId });
        const normCityId = Number(cityId);
        const normIslandId = Number(islandId);
        if (!changed) return false;

        // Se a cidade já existe no estado principal, manter islandId em sync.
        const city = this.cities.get(normCityId);
        if (city) {
            city.islandId = normIslandId;
            this._touchCityVersion(city);
        }

        this._persistCityIslandMap();
        return true;
    }

    /** Resolve cityId canônico por islandId (ou null se desconhecido). */
    resolveCityIdByIslandId(islandId) {
        return this._cityIslandMapper.resolveCityIdByIslandId(islandId);
    }

    /** Resolve islandId associado a cityId (ou null se desconhecido). */
    resolveIslandIdByCityId(cityId) {
        return this._cityIslandMapper.resolveIslandIdByCityId(cityId);
    }

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

    /** Idade dos dados da cidade em ms (null quando cidade não existe/sem coleta). */
    getDataAgeMs(cityId) {
        const city = this.cities.get(cityId);
        if (!city || !city.fetchedAt) return null;
        return Math.max(0, Date.now() - city.fetchedAt);
    }

    /** Provenance/freshness para decisões híbridas endpoint-first. */
    getHybridPrereqSnapshot(cityId, { token } = {}) {
        const confidence = this.getConfidence(cityId);
        const dataAgeMs = this.getDataAgeMs(cityId);
        const activeCityId = this.getActiveCityId();
        const city = this.getCity(cityId);

        return {
            cityId,
            activeCityId,
            contextLock: {
                locked: Number(activeCityId) === Number(cityId),
                selectedCityId: activeCityId,
            },
            tokenSnapshot: {
                present: !!token,
                source: token ? 'dc' : 'unknown',
            },
            routeConfidence: confidence === 'UNKNOWN' ? 'LOW' : confidence,
            freshness: {
                dataAgeMs,
                cityFetchedAt: city?.fetchedAt ?? null,
                stale: dataAgeMs == null ? true : dataAgeMs >= 300_000,
            },
            dataProvenance: ['endpoint', 'html-response'],
        };
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
                if (cityData.islandId) {
                    this.registerCityIslandMapping({ cityId, islandId: cityData.islandId });
                }
                if (cityData.name)     city.name     = cityData.name;
                if (cityData.tradegood !== undefined) {
                    city.tradegood = Number(cityData.tradegood);
                }

                this._touchCityVersion(city);
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
                const city = this.cities.get(cityId);
                city.lockedPositions = new Set(Object.keys(locked).map(Number));
                this._touchCityVersion(city);
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
        const cityId = evtCityId || this._activeCityId;
        const city = this._cityStateUpdater._onHeaderData(this, { headerData, cityId });
        if (!cityId || !city) return;
        this._touchCityVersion(city);
        this._events.emit(this._events.E.STATE_CITY_UPDATED, { cityId });
    }

    _onScreenData({ screenData, cityId: evtCityId }) {
        const cityId = evtCityId || this._activeCityId;
        const city = this._cityStateUpdater._onScreenData(this, { screenData, cityId });
        if (!cityId || !city) return;
        if (screenData?.islandId) this.registerCityIslandMapping({ cityId, islandId: screenData.islandId });
        this._touchCityVersion(city);
        this._events.emit(this._events.E.STATE_CITY_UPDATED, { cityId });
    }

    _onFleetMovements({ movements }) {
        this.fleetMovements = movements;
    }

    /**
     * Soma o cargo de todas as frotas próprias em trânsito com destino a cityId.
     * Inclui apenas movimentos de ida (isReturn=false) e da nossa conta (isOwn=true).
     * Movimentos em loading/A carregar também contam como cobertura comprometida.
     * Retorna { wood, wine, marble, glass, sulfur } — zeros para recursos sem transporte.
     */
    getInTransit(cityId) {
        const result = createEmptyResources();
        for (const m of this.fleetMovements) {
            if (!this._isInboundCommittedMovement(m)) continue;
            if (m.targetCityId !== cityId) continue;
            for (const [res, qty] of Object.entries(m.cargo ?? {})) {
                if (res in result) result[res] += Number(qty) || 0;
            }
        }
        return result;
    }

    _isInboundCommittedMovement(m) {
        if (!m || !m.isOwn || m.isReturn) return false;

        // Estados explícitos de loading (A carregar / 0%) são cobertura comprometida.
        const stateRaw = String(m.state ?? m.status ?? m.phase ?? '').toLowerCase();
        if (stateRaw.includes('loading') || stateRaw.includes('carregar')) return true;

        const progressPct = Number(m.progressPct ?? m.progress ?? NaN);
        if (Number.isFinite(progressPct) && progressPct === 0) return true;

        // Fallback: movimento próprio de ida com destino definido conta como comprometido.
        return true;
    }

    // DC_TOWNHALL_DATA — viewScriptParams do changeView:townHall
    // Espelha o townHall.controller.js do IKAEASY:
    //   priests, scientists, happinessLargeValue, populationGrowthValue,
    //   occupiedSpace, maxInhabitants, culturalGoods
    _onTownhallData({ cityId: evtCityId, params }) {
        const cityId = evtCityId || this._activeCityId;
        const city = this._cityStateUpdater._onTownhallData(this, { cityId, params });
        if (!cityId || !params || !city) return;
        this._touchCityVersion(city);
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

    _persistCityIslandMap() {
        this._cityIslandMapper.persist();
    }

    _restoreCityIslandMap() {
        this._cityIslandMapper.restore();
    }

    // ── Fábrica de estado vazio ───────────────────────────────────────────────

    _createEmptyCityState(id, data) {
        return {
            _version: 0,
            id,
            name:             data.name      ?? `City ${id}`,
            isCapital:        data.isCapital  ?? false,
            islandId:         Number(data.islandId  ?? 0),
            tradegood:        Number(data.tradegood ?? 0),
            coords:           data.coords
                ? [Number(data.coords.x), Number(data.coords.y)]
                : [0, 0],
            resources:        createEmptyResources(),
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
            workersByResource: {
                wood: 0,
                tradegood: 0,
                scientists: 0,
                priests: 0,
                citizens: 0,
            },
            typed: {
                _meta: {},
                _mismatches: [],
                inspectedViews: {
                    townHall: false,
                    townHallLastAt: 0,
                },
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

    _touchCityVersion(cityOrId) {
        const city = typeof cityOrId === 'object' && cityOrId !== null
            ? cityOrId
            : this.cities.get(cityOrId);
        if (!city) return;
        const current = Number(city._version ?? 0);
        city._version = Number.isFinite(current) ? current + 1 : 1;
    }

    _mergeTypedField(city, { field, value, source = 'model', confidence = 'medium' } = {}) {
        if (!city || !field || value === undefined || value === null) return false;

        if (!city.typed || typeof city.typed !== 'object') {
            city.typed = { _meta: {}, _mismatches: [], inspectedViews: { townHall: false, townHallLastAt: 0 } };
        }
        if (!city.typed._meta) city.typed._meta = {};
        if (!Array.isArray(city.typed._mismatches)) city.typed._mismatches = [];

        const isNumber = typeof value === 'number' || /^-?\d+(?:\.\d+)?$/.test(String(value));
        const normalized = isNumber ? Number(value) : value;
        if (typeof normalized === 'number' && !Number.isFinite(normalized)) return false;

        const currentValue = city.typed[field];
        const currentMeta = city.typed._meta[field] ?? null;
        const currentRank = FIELD_SOURCE_RANK[currentMeta?.source] ?? 0;
        const incomingRank = FIELD_SOURCE_RANK[source] ?? 0;

        if (currentMeta && currentMeta.source !== source && currentValue !== normalized) {
            city.typed._mismatches.push({
                ts: Date.now(),
                field,
                current: { value: currentValue, source: currentMeta.source },
                incoming: { value: normalized, source },
            });
            if (city.typed._mismatches.length > 100) {
                city.typed._mismatches.shift();
            }
        }

        if (currentMeta && incomingRank < currentRank && currentValue !== undefined && currentValue !== null) {
            return false;
        }

        city.typed[field] = normalized;
        city.typed._meta[field] = {
            source,
            confidence,
            updatedAt: Date.now(),
        };
        return true;
    }
}
