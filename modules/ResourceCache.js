// ResourceCache.js — cache multi-cidade com projeção temporal
//
// Estrutura de um item de cache:
// {
//   cityId, cityName, islandId, islandName, coords,
//   portPosition,        // índice do slot do porto na cidade
//   resources:  { wood, wine, marble, glass, sulfur },
//   maxResources,        // capacidade do armazém (igual para todos os recursos)
//   production: { wood, wine, marble, glass, sulfur }, // por hora
//   tradegood,           // 1=vinho 2=mármore 3=glass 4=enxofre
//   population: { citizens, total },
//   finance:    { income, upkeep, scientistsUpkeep, wineSpendings, gold },
//   freeTransporters,    // barcos livres — vem do headerData, NÃO do model
//   maxTransporters,
//   updatedAt            // timestamp Unix (Game.getServerTime())
// }

import Game from './Game.js';
import Events from './Events.js';

const W = window;

// Mapeamento de recurso no headerData → chave interna
// res.resource → wood | res['1'] → wine | res['2'] → marble
// res['3'] → glass | res['4'] → sulfur
const RES_KEYS = ['wood', 'wine', 'marble', 'glass', 'sulfur'];

const RESOURCE_MAP = {
    resource: 'wood',
    '1': 'wine',
    '2': 'marble',
    '3': 'glass',
    '4': 'sulfur',
};

// ─── Cache interno ────────────────────────────────────────────────────────────
// Map<cityId, CacheItem>
const _cache = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _emptyResources() {
    return { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 };
}

function _buildFromModel(cityId) {
    const city = Game.getCity(cityId);
    if (!city) return null;

    // Se for a cidade atual, lê direto do ikariam.model (estrutura real do jogo)
    const isCurrentCity = cityId === Game.getCityId();
    const live = isCurrentCity ? Game.getCurrentCityData() : null;

    const resources   = live?.resources   ?? { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 };
    const production  = live?.production  ?? { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 };
    const maxResources = live?.maxResources ?? Infinity;

    return {
        cityId,
        cityName:          city.name              ?? '',
        islandId:          live?.islandId         ?? city.islandId  ?? null,
        islandName:        live?.islandName       ?? city.islandName ?? '',
        coords:            city.coords  ?? null,
        portPosition:      Game.findPosition(cityId, 'port'),
        resources,
        maxResources,
        production,
        tradegood:         city.tradegood ?? null,
        population: {
            citizens: live?.citizens  ?? 0,
            total:    live?.population ?? 0,
        },
        finance: {
            income:           live?.income           ?? 0,
            upkeep:           live?.upkeep           ?? 0,
            scientistsUpkeep: live?.scientistsUpkeep ?? 0,
            wineSpendings:    live?.wineSpendings     ?? 0,
            gold:             0,
        },
        freeTransporters: isCurrentCity ? (W.ikariam?.model?.headerData?.freeTransporters ?? 0) : 0,
        maxTransporters:  isCurrentCity ? (W.ikariam?.model?.headerData?.maxTransporters  ?? 0) : 0,
        updatedAt: Game.getServerTime(),
    };
}

// ─── API pública ──────────────────────────────────────────────────────────────

const ResourceCache = {

    /**
     * Lê o estado atual da cidade do model e atualiza o cache.
     */
    refresh(cityId) {
        const snap = _buildFromModel(cityId);
        if (!snap) return null;
        // Preserva freeTransporters do cache anterior (vem do headerData)
        const prev = _cache.get(cityId);
        if (prev) {
            snap.freeTransporters = prev.freeTransporters;
            snap.maxTransporters  = prev.maxTransporters;
        }
        _cache.set(cityId, snap);
        Events.emit('resources:updated', { cityId, resources: snap.resources });
        return snap;
    },

    get(cityId) {
        if (!_cache.has(cityId)) this.refresh(cityId);
        return _cache.get(cityId) ?? null;
    },

    /**
     * Atualiza o cache a partir de uma resposta AJAX do servidor.
     * `g` = objeto updateGlobalData[1]
     * `forceCityId` — se fornecido, usa este cityId em vez de Game.getCityId()
     *   (necessário para fetch proativo de cidades que não são a atual).
     */
    updateFromResponse(g, forceCityId = null) {
        if (!g) return;
        const cityId = forceCityId ?? Game.getCityId();
        if (!_cache.has(cityId)) this.refresh(cityId); // garante entrada no cache
        const cached = _cache.get(cityId);
        if (!cached) return;

        const hd = g.headerData;
        if (!hd) return;

        // Recursos atuais
        const res = hd.currentResources;
        if (res) {
            for (const [serverKey, localKey] of Object.entries(RESOURCE_MAP)) {
                if (res[serverKey] !== undefined) {
                    cached.resources[localKey] = Number(res[serverKey]);
                }
            }
        }

        // Transportadores livres — NÃO vem do ikariam.model, só do headerData
        if (hd.freeTransporters !== undefined) {
            cached.freeTransporters = Number(hd.freeTransporters);
        }
        if (hd.maxTransporters !== undefined) {
            cached.maxTransporters = Number(hd.maxTransporters);
        }

        // Capacidade do armazém
        if (hd.maxStorage !== undefined) {
            cached.maxResources = Number(hd.maxStorage);
        }

        cached.updatedAt = Game.getServerTime();
        _cache.set(cityId, cached);

        Events.emit('resources:updated', { cityId, resources: cached.resources });
    },

    getProduction(cityId, resource) {
        return this.get(cityId)?.production[resource] ?? 0;
    },

    getCapacity(cityId) {
        return this.get(cityId)?.maxResources ?? Infinity;
    },

    getCurrent(cityId, resource) {
        return this.get(cityId)?.resources[resource] ?? 0;
    },

    getFreeTransporters(cityId) {
        return this.get(cityId)?.freeTransporters ?? 0;
    },

    // ── Projeção temporal ──────────────────────────────────────────────────

    /**
     * Projeta os recursos de uma cidade num timestamp futuro (Unix, segundos).
     * Vinho pode ir a zero (não é limitado pelo armazém, mas não fica negativo).
     * Os demais são limitados por maxResources.
     */
    projectResources(cityId, atTimestamp = null) {
        const cached = this.get(cityId);
        if (!cached) return _emptyResources();

        const now      = atTimestamp ?? Game.getServerTime();
        const elapsedH = (now - cached.updatedAt) / 3600;
        const proj     = {};
        const cap      = cached.maxResources;

        for (const k of RES_KEYS) {
            const cur  = cached.resources[k]  ?? 0;
            const rate = cached.production[k] ?? 0;
            proj[k] = k === 'wine'
                ? Math.max(0, cur + rate * elapsedH)
                : Math.min(cap, Math.max(0, cur + rate * elapsedH));
        }

        return proj;
    },

    /**
     * Horas até a produção local cobrir `costs` (objeto { wood: N, ... }).
     * Retorna 0 se já tem. Retorna Infinity se não produz ou excede capacidade.
     */
    hoursUntilResources(cityId, costs = {}) {
        const cached = this.get(cityId);
        if (!cached) return Infinity;

        const now      = Game.getServerTime();
        const elapsedH = (now - cached.updatedAt) / 3600;
        let maxHours   = 0;

        for (const [res, needed] of Object.entries(costs)) {
            if (!needed) continue;
            const cur  = cached.resources[res]  ?? 0;
            const rate = cached.production[res] ?? 0;
            const cap  = cached.maxResources;

            // Quantidade atual projetada (desde o último snapshot)
            const projected = res === 'wine'
                ? Math.max(0, cur + rate * elapsedH)
                : Math.min(cap, Math.max(0, cur + rate * elapsedH));

            if (projected >= needed) continue;

            if (rate <= 0 || needed > cap) return Infinity;

            const hoursFromNow = (needed - projected) / rate;
            if (hoursFromNow > maxHours) maxHours = hoursFromNow;
        }

        return maxHours;
    },

    /**
     * Horas até ter todos os recursos de `costs` simultaneamente.
     */
    hoursUntilAllCosts(cityId, costs = {}) {
        return this.hoursUntilResources(cityId, costs);
    },

    /**
     * Faz fetch proativo de dados de todas as cidades próprias via AJAX.
     * Popula recursos reais sem o usuário precisar navegar em cada cidade.
     * Usa um delay de 400ms entre requests para não sobrecarregar o servidor.
     */
    async fetchAll() {
        const cities = Game.getCities();
        for (const city of cities) {
            try {
                const data = await Game.fetchCityData(city.id);
                if (data) {
                    const g = data.find(d => Array.isArray(d) && d[0] === 'updateGlobalData');
                    if (g?.[1]) {
                        this.updateFromResponse(g[1], city.id);
                        // Extrai posições de edifícios da resposta AJAX e armazena no Game
                        const bg = g[1].backgroundData ?? g[1].cityData ?? null;
                        const positions = bg?.position ?? g[1].position ?? null;
                        if (Array.isArray(positions) && positions.length > 0) {
                            Game.storePositions(city.id, positions);
                        }
                        const locked = bg?.lockedPosition ?? g[1].lockedPosition ?? null;
                        if (locked) {
                            Game.storeLockedPositions(city.id, locked);
                        }
                    } else {
                        this.refresh(city.id);
                    }
                } else {
                    this.refresh(city.id);
                }
            } catch (e) {
                console.warn(`[ResourceCache] fetchAll falhou (city ${city.id}):`, e);
                this.refresh(city.id);
            }
            await new Promise(r => setTimeout(r, 400));
        }
    },

    getAll() {
        return Game.getCities().map(c => this.get(c.id)).filter(Boolean);
    },

    invalidate(cityId) {
        _cache.delete(cityId);
    },

    invalidateAll() {
        _cache.clear();
    },
};

export default ResourceCache;
