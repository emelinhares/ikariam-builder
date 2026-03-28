// Game.js — adapter do ikariam.model
// Técnicas absorvidas do IkaEasy V3

import { CityType, PremiumFeatures } from '../data/const.js';

const W = window;

// ─── Helpers internos ─────────────────────────────────────────────────────────

function _model() {
    return W.ikariam?.model ?? null;
}

function _city(cityId) {
    const m = _model();
    if (!m) return null;
    const id = cityId ?? Game.getCityId();
    // Tenta cities[] primeiro, depois relatedCityData (chave pode ser "city_ID" ou ID numérico)
    return m.cities?.[id]
        ?? m.relatedCityData?.[id]
        ?? m.relatedCityData?.[`city_${id}`]
        ?? null;
}

// Cache de posições de edifícios por cidade (populado pelo ResourceCache.fetchAll via AJAX)
const _positionsCache = {};
// Cache de slots bloqueados por pesquisa: { cityId: { "13": "msg", ... } }
const _lockedCache = {};

// ─── API pública ──────────────────────────────────────────────────────────────

const Game = {

    // ── Estado do jogo ─────────────────────────────────────────────────────

    isReady() {
        try {
            return !!(W.ikariam?.model &&
                W.ikariam?.backgroundView?.screen?.data);
        } catch(e) { return false; }
    },

    waitReady(timeout = 30000) {
        return new Promise((resolve, reject) => {
            const deadline = Date.now() + timeout;
            function check() {
                if (Game.isReady()) return resolve();
                if (Date.now() >= deadline) return reject(new Error('[Game] Timeout'));
                setTimeout(check, 200);
            }
            check();
        });
    },

    getBgId() {
        return W.ikariam?.backgroundView?.id
            ?? document.body.id
            ?? 'unknown';
    },

    // ── Cidade atual ───────────────────────────────────────────────────────

    /**
     * Retorna o cityId da cidade atualmente selecionada.
     * Usa relatedCityData.selectedCity (técnica IkaEasy — mais confiável).
     */
    getCityId() {
        const rd = _model()?.relatedCityData;
        // Prefer numeric selectedCityId (direct, no string parsing needed)
        if (rd?.selectedCityId) return Number(rd.selectedCityId);
        // Fallback: parse "city_NNNN" string
        if (rd?.selectedCity) return parseInt(rd.selectedCity.replace('city_', ''), 10);
        return W.ikariam?.backgroundView?.screen?.screenId ?? null;
    },

    // ── Avatar / Jogador ───────────────────────────────────────────────────

    getAvatarId() {
        return _model()?.avatarId ?? null;
    },

    getAvatarName() {
        return _model()?.name ?? null;
    },

    // ── Tempo do servidor ──────────────────────────────────────────────────

    /**
     * Tempo do servidor em segundos (Unix).
     * offset = initialBrowserTime - initialServerTime (browser adiantado = positivo)
     */
    getServerTime() {
        const m = _model();
        if (!m) return Math.floor(Date.now() / 1000);

        // Normaliza serverTs para segundos (guard: às vezes o model entrega ms)
        let serverTs = Number(m.initialServerTime) || 0;
        if (serverTs > 1e10) serverTs = Math.floor(serverTs / 1000);
        if (!serverTs) serverTs = Math.floor(Date.now() / 1000);

        // Normaliza browserTs para ms (guard: às vezes o model entrega segundos)
        let browserTs = Number(m.initialBrowserTime) || 0;
        if (browserTs > 0 && browserTs < 1e10) browserTs *= 1000;
        if (!browserTs) browserTs = Date.now();

        const offset = browserTs - serverTs * 1000; // offset em ms
        return Math.floor((Date.now() - offset) / 1000);
    },

    // ── Token CSRF ─────────────────────────────────────────────────────────

    getToken() {
        return _model()?.actionRequest ?? '';
    },

    updateToken(t) {
        if (_model()) _model().actionRequest = t;
    },

    // ── Cidades ────────────────────────────────────────────────────────────

    /**
     * Retorna todas as cidades próprias.
     * Usa relatedCityData (técnica IkaEasy).
     */
    getCities() {
        const rd = _model()?.relatedCityData;
        if (!rd) return [];
        return Object.values(rd)
            .filter(c => c?.relationship === CityType.OWN)
            .map(c => ({
                id:        c.id,
                name:      c.name,
                tradegood: c.tradegood,
                islandId:  c.islandId,
            }));
    },

    getCity(cityId) {
        return _city(cityId);
    },

    getCityName(cityId) {
        return _city(cityId)?.name ?? null;
    },

    getCityIslandId(cityId) {
        return _city(cityId)?.islandId ?? null;
    },

    // ── Recursos ───────────────────────────────────────────────────────────

    /**
     * Retorna recursos da cidade ATUAL diretamente do ikariam.model.
     * Estrutura real: currentResources = {resource: wood, 1: wine, 2: marble, 3: glass, 4: sulfur}
     * resourceProduction = número (madeira/s), tradegoodProduction = número (especial/s)
     * producedTradegood = ordinal do recurso especial (1=wine,2=marble,3=glass,4=sulfur)
     */
    getCurrentCityData() {
        const m = _model();
        if (!m) return null;
        const cr  = m.currentResources ?? {};
        const tg  = Number(m.headerData?.producedTradegood ?? m.producedTradegood ?? 0) || null; // ordinal 1-4
        const TG_KEY = { 1: 'wine', 2: 'marble', 3: 'glass', 4: 'sulfur' };
        const tgKey = TG_KEY[tg] ?? null;

        // produção em /s → convertemos para /h
        const woodPerH = (m.resourceProduction  ?? 0) * 3600;
        const tgPerH   = (m.tradegoodProduction ?? 0) * 3600;

        // islandId e islandName vêm do screen.data da cidade atual
        const screenData = W.ikariam?.backgroundView?.screen?.data ?? {};

        return {
            resources: {
                wood:   cr.resource ?? 0,
                wine:   cr['1']     ?? 0,
                marble: cr['2']     ?? 0,
                glass:  cr['3']     ?? 0,
                sulfur: cr['4']     ?? 0,
            },
            production: {
                wood:   woodPerH,
                wine:   tgKey === 'wine'   ? tgPerH : 0,
                marble: tgKey === 'marble' ? tgPerH : 0,
                glass:  tgKey === 'glass'  ? tgPerH : 0,
                sulfur: tgKey === 'sulfur' ? tgPerH : 0,
            },
            maxResources:     m.maxResources?.resource ?? m.maxResources?.['0'] ?? Infinity,
            wineSpendings:    Number(m.headerData?.wineSpendings ?? m.wineSpendings ?? 0),
            upkeep:           m.upkeep           ?? 0,
            income:           m.income           ?? 0,
            scientistsUpkeep: m.scientistsUpkeep ?? 0,
            citizens:         cr.citizens        ?? 0,
            population:       cr.population      ?? 0,
            islandId:         screenData.islandId   ? Number(screenData.islandId)   : null,
            islandName:       screenData.islandName ?? '',
        };
    },

    getResources(cityId) {
        if (cityId === this.getCityId()) {
            const d = this.getCurrentCityData();
            return d ? d.resources : null;
        }
        return _city(cityId)?.resources ?? null;
    },

    getResource(cityId, resource) {
        return this.getResources(cityId)?.[resource] ?? 0;
    },

    // ── Edifícios ──────────────────────────────────────────────────────────

    /**
     * Retorna array de slots da cidade.
     * Cada item: { position, name, level, isUpgrading, constructionEnd, ... }
     *
     * Prioridades:
     *   1. Se for a cidade atual → screen.data.position (dado ao vivo)
     *   2. Cache de posições populado pelo fetchAll via AJAX (backgroundData.position)
     *   3. relatedCityData[id].position (raramente preenchido pelo jogo)
     */
    getBuildings(cityId) {
        const id = cityId ?? Game.getCityId();

        // 1. Cidade atual: usa screen.data.position (dado ao vivo, sempre disponível)
        if (id && id === Game.getCityId()) {
            const pos = W.ikariam?.backgroundView?.screen?.data?.position;
            if (Array.isArray(pos) && pos.length > 0) return pos;
        }

        // 2. Cache de posições populado pelo fetchAll (backgroundData de AJAX)
        const cached = _positionsCache[id];
        if (Array.isArray(cached) && cached.length > 0) return cached;

        // 3. Fallback: relatedCityData (raramente útil, mas preserva compatibilidade)
        return _city(id)?.position ?? [];
    },

    /** Armazena posições de edifícios obtidas via AJAX (fetchAll). */
    storePositions(cityId, positions) {
        if (Array.isArray(positions) && positions.length > 0) {
            _positionsCache[cityId] = positions;
        }
    },

    /** Armazena slots bloqueados por pesquisa obtidos via AJAX (fetchAll). */
    storeLockedPositions(cityId, locked) {
        if (locked && typeof locked === 'object') {
            _lockedCache[cityId] = locked;
        }
    },

    /**
     * Verifica se um slot está bloqueado por pesquisa.
     * backgroundData.lockedPosition = { "13": "msg" } — chave é string do slot.
     */
    isPositionLocked(cityId, position) {
        const locked = _lockedCache[cityId];
        if (!locked) return false;
        return String(position) in locked;
    },

    /**
     * Retorna o dado de um slot pelo número de posição.
     */
    getPosition(cityId, position) {
        return Game.getBuildings(cityId).find(b => b.position === position) ?? null;
    },

    getBuildingLevel(cityId, buildingType) {
        let max = 0;
        for (const b of Game.getBuildings(cityId)) {
            if (b.name === buildingType && b.level > max) max = b.level;
        }
        return max;
    },

    getBuildingSlots(cityId, buildingType) {
        return Game.getBuildings(cityId).filter(b => b.name === buildingType);
    },

    /**
     * Localiza o número de posição (slot) de um tipo de edifício na cidade.
     * Para edifícios múltiplos retorna o primeiro slot encontrado.
     */
    findPosition(cityId, buildingType) {
        const slot = Game.getBuildings(cityId).find(b => b.name === buildingType);
        return slot?.position ?? null;
    },

    // ── Fila de construção ─────────────────────────────────────────────────

    getConstructionQueue(cityId) {
        return _city(cityId)?.constructionList ?? [];
    },

    isBuilding(cityId) {
        // For the current city, screen.data.underConstruction is authoritative
        if (cityId === Game.getCityId()) {
            const uc = W.ikariam?.backgroundView?.screen?.data?.underConstruction;
            if (uc !== undefined) return uc !== -1 && uc !== false;
        }
        return Game.getConstructionQueue(cityId).length > 0;
    },

    getQueueFinishTime(cityId) {
        const queue = Game.getConstructionQueue(cityId);
        if (!queue.length) return 0;
        const last = queue[queue.length - 1];
        return (last.endUpgradeTime ?? last.endTime ?? last.constructionEnd ?? 0) * 1000;
    },

    // ── Pesquisa ───────────────────────────────────────────────────────────
    // model.research NÃO existe — pesquisas só estão disponíveis via AJAX
    // ao researchAdvisor. Cache interno populado por fetchResearch().

    _researchCache: new Set(),        // Set<researchId number>
    _researchCachedAt: 0,             // Unix ts (s) da última atualização
    _RESEARCH_TTL: 6 * 3600,         // 6 horas — pesquisas mudam raramente

    /**
     * Busca pesquisas concluídas de todas as categorias via AJAX.
     * Popula _researchCache com os IDs numéricos das pesquisas exploradas.
     *
     * Fluxo CONFIRMADO 2026-03-28:
     *   GET view=researchAdvisor&researchId={seedId} → templateData.load_js.params
     *   params.currResearchType = { nomePesquisa: { aHref, liClass } }
     *   liClass "selected explored" = selecionada, "explored" = concluída, "" = bloqueada
     *
     * Usa um researchId semente por categoria para abrir a lista da categoria.
     * Seeds: ID de qualquer pesquisa conhecida da categoria (usa a primeira pesquisa básica).
     */
    async fetchResearch() {
        // researchId semente por categoria — qualquer ID conhecido da categoria funciona
        // Confirmado: researchAdvisor&researchId=2150 abre Navegação Marítima
        const CATEGORY_SEEDS = {
            seafaring: 2150,   // Carpintaria (Navegação Marítima)
            economy:   2010,   // Enologia / qualquer pesquisa de Economia
            knowledge: 2030,   // qualquer pesquisa de Ciência
            military:  2040,   // qualquer pesquisa de Militar
            mythology: 2050,   // qualquer pesquisa de Mitologia
        };
        const investigated = new Set();
        const cityId = Game.getCityId();

        for (const [cat, seedId] of Object.entries(CATEGORY_SEEDS)) {
            try {
                const url = `/index.php?view=researchAdvisor&researchId=${seedId}` +
                    (cityId ? `&currentCityId=${cityId}` : '') + `&ajax=1`;
                const data = await Game.request(url);
                const templateData = data.find(d => d[0] === 'updateTemplateData')?.[1];
                const paramsStr = templateData?.load_js?.params;
                if (!paramsStr) continue;

                const params = JSON.parse(paramsStr);
                for (const entry of Object.values(params.currResearchType ?? {})) {
                    if (entry.liClass?.includes('explored')) {
                        const id = parseInt(entry.aHref.match(/researchId=(\d+)/)?.[1]);
                        if (id) investigated.add(id);
                    }
                }
            } catch (e) {
                console.warn(`[Game] fetchResearch(${cat}) falhou:`, e);
            }
            await new Promise(r => setTimeout(r, 300));
        }

        Game._researchCache = investigated;
        Game._researchCachedAt = Game.getServerTime();
        return investigated;
    },

    /**
     * Retorna Set<number> com IDs de pesquisas concluídas.
     * Usa cache se ainda válido, caso contrário dispara fetch em background.
     */
    getResearch() {
        const age = Game.getServerTime() - Game._researchCachedAt;
        if (Game._researchCache.size === 0 || age > Game._RESEARCH_TTL) {
            Game.fetchResearch().catch(e => console.warn('[Game] fetchResearch:', e));
        }
        return Game._researchCache;
    },

    /**
     * Verifica se uma pesquisa está concluída.
     * @param {number} researchId — usar constantes Research.* de const.js
     */
    hasResearch(researchId) {
        return Game.getResearch().has(Number(researchId));
    },

    /**
     * Força atualização imediata do cache de pesquisas e retorna o Set.
     */
    async refreshResearch() {
        return Game.fetchResearch();
    },

    // ── Governo ────────────────────────────────────────────────────────────

    getGovernment() {
        return _model()?.currentGovernmentType ?? null;
    },

    // ── Premium ────────────────────────────────────────────────────────────

    getPremiumFeatures() {
        return _model()?.premiumFeatures ?? [];
    },

    hasPremium(featureId) {
        return Game.getPremiumFeatures().includes(String(featureId));
    },

    hasDoubledStorage() { return Game.hasPremium(PremiumFeatures.DOUBLED_STORAGE_CAPACITY); },
    hasDoubledSafe()    { return Game.hasPremium(PremiumFeatures.DOUBLED_SAFE_CAPACITY); },
    hasPremiumAccount() { return Game.hasPremium(PremiumFeatures.PREMIUM_ACCOUNT); },

    // ── Desconto de construção ─────────────────────────────────────────────

    /**
     * Retorna multiplicadores de custo por recurso para uma cidade.
     * Inclui descontos de pesquisa (globais) e edifícios especializados (por cidade):
     *   - Carpentering: -1% madeira por nível
     *   - Architect: -1% mármore por nível
     * Retorna { wood, marble, glass, sulfur } — cada valor entre 0.0 e 1.0.
     */
    getBuildingCostMultiplier(cityId = null) {
        const investigated = _model()?.research?.investigated ?? [];

        // Pesquisa — aplicam globalmente a todos os recursos
        let globalDiscount = 0;
        if (investigated.includes(2020)) globalDiscount += 0.02; // Pulley
        if (investigated.includes(2060)) globalDiscount += 0.04; // Geometry
        if (investigated.includes(2100)) globalDiscount += 0.08; // Spirit Level

        // Edifícios especializados — específicos por recurso e cidade
        let woodDiscount   = globalDiscount;
        let marbleDiscount = globalDiscount;

        if (cityId !== null) {
            const carpLevel = Game.getBuildingLevel(cityId, 'carpentering');
            const archLevel = Game.getBuildingLevel(cityId, 'architect');
            woodDiscount   += carpLevel * 0.01; // -1% madeira por nível
            marbleDiscount += archLevel * 0.01; // -1% mármore por nível
        }

        return {
            wood:   Math.max(0, 1 - woodDiscount),
            marble: Math.max(0, 1 - marbleDiscount),
            glass:  Math.max(0, 1 - globalDiscount),
            sulfur: Math.max(0, 1 - globalDiscount),
        };
    },

    // ── HTTP ───────────────────────────────────────────────────────────────

    /**
     * Requisição HTTP unificada (XHR com X-Requested-With: XMLHttpRequest).
     * Retorna o array JSON de comandos do servidor.
     * Sempre atualiza o token CSRF após a resposta.
     */
    request(url, body = null, method = null) {
        const httpMethod = method ?? (body ? 'POST' : 'GET');
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(httpMethod, location.origin + url, true);
            xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            if (body) xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
            xhr.onload = () => {
                try {
                    const data = JSON.parse(xhr.responseText);
                    const g = data.find(d => d[0] === 'updateGlobalData');
                    if (g?.[1]?.actionRequest) Game.updateToken(g[1].actionRequest);
                    resolve(data);
                } catch (e) { reject(e); }
            };
            xhr.onerror = () => reject(new Error('[Game] XHR error'));
            xhr.send(body || null);
        });
    },

    /**
     * Busca o custo de upgrade de um edifício pelo slot (position).
     * Faz parse do HTML retornado, removendo .accesshint antes de ler números.
     * Retry 2x em falha (STATE.md).
     */
    /**
     * Busca dados completos de uma cidade via AJAX.
     * Retorna o array de comandos do servidor (inclui updateGlobalData com headerData).
     * Usado pelo ResourceCache.fetchAll() para atualizar recursos sem o usuário navegar.
     */
    async fetchCityData(cityId) {
        const token = Game.getToken();
        const url = `/index.php?view=city&cityId=${cityId}` +
            `&backgroundView=city&currentCityId=${cityId}&ajax=1` +
            (token ? `&actionRequest=${encodeURIComponent(token)}` : '');
        try {
            return await Game.request(url);
        } catch (e) {
            console.error(`[Game] fetchCityData(${cityId}) falhou:`, e);
            return null;
        }
    },

    async fetchCosts(cityId, position) {
        const pos = Game.getPosition(cityId, position);
        if (!pos) return null;

        const view = (pos.name ?? pos.building ?? '').split(' ')[0];
        const url = `/index.php?view=${view}&cityId=${cityId}&position=${position}` +
            `&backgroundView=city&currentCityId=${cityId}&ajax=1`;

        for (let attempt = 0; attempt <= 2; attempt++) {
            try {
                const data = await Game.request(url);
                const html = data.find(d => d[0] === 'changeView')?.[1]?.[1] ?? '';
                if (!html) throw new Error('No HTML in changeView response');

                const doc = new DOMParser().parseFromString(html, 'text/html');
                const costs = {};

                doc.querySelectorAll('ul.resources li').forEach(li => {
                    const cls = li.className.trim().split(' ')[0];
                    if (!cls || cls === 'time') return;
                    li.querySelector('.accesshint')?.remove(); // CRÍTICO: remove label
                    const val = parseInt(
                        li.textContent.trim().replace(/\./g, '').replace(/\s/g, ''),
                        10
                    );
                    if (!isNaN(val) && val > 0) costs[cls] = val;
                });

                return Object.keys(costs).length > 0 ? costs : null;
            } catch (err) {
                if (attempt === 2) {
                    console.error(`[Game] fetchCosts falhou (pos ${position}):`, err);
                    return null;
                }
                await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
            }
        }
        return null;
    },
};

export default Game;
