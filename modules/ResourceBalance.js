// ResourceBalance.js — balanceia madeira e bens de troca entre cidades
//
// Usa projeção temporal do ResourceCache para encontrar doadores com excedente.
// Enfileira transferências diretamente no Port.

import Game from './Game.js';
import ResourceCache from './ResourceCache.js';
import Port from './Port.js';
import Storage from './Storage.js';
import Events from './Events.js';
import { Resources } from '../data/const.js';

// Recursos balanceáveis (não inclui wine — WineBalance cuida disso)
const TRADEABLE = [
    Resources.WOOD,
    Resources.MARBLE,
    Resources.CRYSTAL,
    Resources.SULFUR,
];

// ─── Configuração padrão ──────────────────────────────────────────────────────

const DEFAULTS = {
    enabled:       false,
    minReserve:    500,    // unidades mínimas a manter na cidade fonte
    checkMinutes:  60,
    sources:       {},     // { [resource]: cityId } — null = auto-detect
};

const SK = 'rebalance_config';

// ─── Estado interno ───────────────────────────────────────────────────────────

let _config = { ...DEFAULTS };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detecta a cidade com mais estoque projetado de um recurso.
 */
function _detectSource(resource, excludeId = null) {
    const cities = Game.getCities().filter(c => c.id !== excludeId);
    let best = null, bestAmt = -1;
    for (const city of cities) {
        const proj = ResourceCache.projectResources(city.id);
        const amt  = proj[resource] ?? 0;
        if (amt > bestAmt) { bestAmt = amt; best = city; }
    }
    return best;
}

function _sourceFor(resource, excludeId = null) {
    const explicit = _config.sources?.[resource];
    if (explicit) {
        const cities = Game.getCities();
        return cities.find(c => c.id === explicit) ?? _detectSource(resource, excludeId);
    }
    return _detectSource(resource, excludeId);
}

function _available(sourceCityId, resource) {
    const proj = ResourceCache.projectResources(sourceCityId);
    return Math.max(0, (proj[resource] ?? 0) - _config.minReserve);
}

// ─── API pública ──────────────────────────────────────────────────────────────

const ResourceBalance = {

    // ── Configuração ───────────────────────────────────────────────────────

    async loadConfig() {
        const saved = await Storage.get(SK);
        _config = { ...DEFAULTS, ...(saved ?? {}) };
        return _config;
    },

    saveConfig() { Storage.set(SK, _config); },
    getConfig()  { return { ..._config }; },

    setConfig(patch) {
        _config = { ..._config, ...patch };
        this.saveConfig();
    },

    isEnabled() { return _config.enabled; },

    // ── Diagnóstico ────────────────────────────────────────────────────────

    statusOf(cityId) {
        ResourceCache.refresh(cityId);
        const resources = {};
        const proj = ResourceCache.projectResources(cityId);
        const cap  = ResourceCache.getCapacity(cityId);
        for (const res of TRADEABLE) {
            resources[res] = {
                current:    ResourceCache.getCurrent(cityId, res),
                projected:  proj[res] ?? 0,
                production: ResourceCache.getProduction(cityId, res),
                capacity:   cap,
            };
        }
        return { cityId, resources };
    },

    // ── Cálculo de transferências ──────────────────────────────────────────

    /**
     * Para os custos de construção `costs` numa cidade destino,
     * enfileira transferências no Port para suprir o que falta.
     * Usa projeção temporal para avaliar doadores.
     */
    transfersFor(toCityId, costs = {}) {
        if (!_config.enabled) return [];

        ResourceCache.refresh(toCityId);
        const transfers = [];
        const toIslandId = ResourceCache.get(toCityId)?.islandId
                         ?? Game.getCityIslandId(toCityId);

        for (const resource of TRADEABLE) {
            const needed  = costs[resource] ?? 0;
            if (needed <= 0) continue;

            const current = ResourceCache.getCurrent(toCityId, resource);
            const deficit = needed - current;
            if (deficit <= 0) continue;

            const source = _sourceFor(resource, toCityId);
            if (!source) continue;

            const avail = _available(source.id, resource);
            if (avail <= 0) continue;

            transfers.push({
                type:        'rebalance',
                fromCityId:  source.id,
                toCityId,
                toIslandId,
                resource,
                amount:      Math.ceil(Math.min(deficit, avail)),
                deficit:     Math.ceil(deficit),
            });
        }

        if (transfers.length) Port.enqueue(transfers);
        return transfers;
    },

    /**
     * Verifica todas as cidades com custos pendentes e enfileira transferências.
     * pendingCosts: { [cityId]: { wood: N, marble: N, ... } }
     */
    checkAll(pendingCosts = {}) {
        if (!_config.enabled) return [];

        const all = [];
        for (const [cityId, costs] of Object.entries(pendingCosts)) {
            const transfers = this.transfersFor(Number(cityId), costs);
            all.push(...transfers);
        }

        if (all.length) {
            Events.emit('rebalance:transfers_needed', { transfers: all });
        }

        return all;
    },

    hasDeficit(pendingCosts = {}) {
        for (const [cityId, costs] of Object.entries(pendingCosts)) {
            for (const resource of TRADEABLE) {
                const needed  = costs[resource] ?? 0;
                const current = ResourceCache.getCurrent(Number(cityId), resource);
                if (needed > current) return true;
            }
        }
        return false;
    },

    getSourceFor(resource) { return _sourceFor(resource); },

    setSourceFor(resource, cityId) {
        this.setConfig({ sources: { ..._config.sources, [resource]: cityId } });
    },
};

export default ResourceBalance;
