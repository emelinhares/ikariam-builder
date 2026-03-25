// WineBalance.js — monitora e reabastece vinho nas cidades
//
// Análise:
//   - Horas efetivas = (estoque + em_trânsito) / consumo_líquido
//   - Guarda 20% de reserva na cidade origem
//   - Prioridade no Port: wine_critical (< 6h) ou wine

import Game from './Game.js';
import ResourceCache from './ResourceCache.js';
import Port from './Port.js';
import Storage from './Storage.js';
import Events from './Events.js';
import { Resources, Buildings, WINE_USE } from '../data/const.js';

// ─── Configuração padrão ──────────────────────────────────────────────────────

const DEFAULTS = {
    enabled:       false,
    minHours:      24,       // enviar vinho quando restar menos de N horas
    targetHours:   72,       // encher até N horas de estoque
    checkMinutes:  30,       // intervalo de verificação em minutos
    sourceCityId:  null,     // cidade produtora (null = detectar auto)
};

const CRITICAL_HOURS  = 6;    // limiar crítico (prioridade wine_critical)
const SOURCE_RESERVE  = 0.20; // guarda 20% do armazém na cidade origem

const SK = 'wine_config';

// ─── Estado interno ───────────────────────────────────────────────────────────

let _config = { ...DEFAULTS };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _wineConsumption(cityId) {
    const level = Game.getBuildingLevel(cityId, Buildings.TAVERN);
    return WINE_USE[level] ?? 0;
}

function _wineHoursLeft(cityId) {
    const wine = ResourceCache.getCurrent(cityId, Resources.WINE);
    const consumption = _wineConsumption(cityId);
    if (consumption <= 0) return Infinity;
    return wine / consumption;
}

function _wineNeeded(cityId) {
    const consumption = _wineConsumption(cityId);
    const current     = ResourceCache.getCurrent(cityId, Resources.WINE);
    const cap         = ResourceCache.getCapacity(cityId);
    const target      = Math.min(cap, consumption * _config.targetHours);
    return Math.max(0, Math.ceil(target - current));
}

function _detectWineSource() {
    const cities = Game.getCities();
    let best = null, bestProd = -1;
    for (const city of cities) {
        const prod = ResourceCache.getProduction(city.id, Resources.WINE);
        if (prod > bestProd) { bestProd = prod; best = city; }
    }
    return best ?? null;
}

// ─── API pública ──────────────────────────────────────────────────────────────

const WineBalance = {

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

    // ── Diagnóstico por cidade ─────────────────────────────────────────────

    statusOf(cityId) {
        const consumption = _wineConsumption(cityId);
        const current     = ResourceCache.getCurrent(cityId, Resources.WINE);
        const hoursLeft   = _wineHoursLeft(cityId);
        const needed      = _wineNeeded(cityId);
        return {
            cityId,
            consumption,
            current,
            hoursLeft,
            needed,
            critical: hoursLeft < CRITICAL_HOURS,
            low:      hoursLeft < _config.minHours,
        };
    },

    allStatuses() {
        const source = this.getSourceCity();
        return Game.getCities()
            .filter(c => c.id !== source?.id)
            .map(c => this.statusOf(c.id));
    },

    // ── Verificação principal ──────────────────────────────────────────────

    /**
     * Verifica todas as cidades e enfileira transferências necessárias no Port.
     */
    check() {
        if (!_config.enabled) return [];

        const sourceCity = this.getSourceCity();
        if (!sourceCity) {
            console.warn('[WineBalance] Nenhuma cidade fonte de vinho encontrada.');
            return [];
        }

        ResourceCache.refresh(sourceCity.id);
        const sourceCap  = ResourceCache.getCapacity(sourceCity.id);
        const sourceWine = ResourceCache.getCurrent(sourceCity.id, Resources.WINE);
        const reserve    = Math.ceil(sourceCap * SOURCE_RESERVE);
        let available    = Math.max(0, sourceWine - reserve);

        const transfers = [];

        // Ordena: críticos primeiro
        const statuses = this.allStatuses()
            .filter(s => s.low)
            .sort((a, b) => a.hoursLeft - b.hoursLeft);

        for (const status of statuses) {
            if (available <= 0) break;
            if (status.needed <= 0) continue;

            const amount = Math.min(status.needed, available);
            const isCritical = status.critical;

            transfers.push({
                type:        isCritical ? 'wine_critical' : 'wine',
                fromCityId:  sourceCity.id,
                toCityId:    status.cityId,
                toIslandId:  ResourceCache.get(status.cityId)?.islandId
                             ?? Game.getCityIslandId(status.cityId),
                resource:    Resources.WINE,
                amount:      Math.ceil(amount),
                wineHoursLeft: status.hoursLeft,
            });
            available -= amount;
        }

        if (transfers.length) {
            Port.enqueue(transfers);
            Events.emit('wine:transfers_needed', { transfers });
        }

        return transfers;
    },

    hasCritical() {
        return this.allStatuses().some(s => s.critical);
    },

    // ── Cidade fonte ───────────────────────────────────────────────────────

    getSourceCity() {
        if (_config.sourceCityId) {
            const cities = Game.getCities();
            return cities.find(c => c.id === _config.sourceCityId) ?? _detectWineSource();
        }
        return _detectWineSource();
    },

    setSourceCityId(cityId) {
        this.setConfig({ sourceCityId: cityId });
    },
};

export default WineBalance;
