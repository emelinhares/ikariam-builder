// Audit.js — log estruturado com buffer circular
// Sem dependência de módulos de negócio. Deps: Events, Storage, utils.

import { Events }  from './Events.js';
import { nanoid }  from './utils.js';
import StorageCompat from './Storage.js';
import Game from './Game.js';

const MAX_ENTRIES   = 200;
const PERSIST_EVERY = 10;  // persistir a cada N novas entradas

export class Audit {
    constructor({ storage, events }) {
        this._storage  = storage;
        this._events   = events;
        this._buffer   = [];   // array circular, max MAX_ENTRIES
        this._sinceLastPersist = 0;
    }

    async init() {
        const saved = await this._storage.get('audit_log');
        if (Array.isArray(saved)) {
            // Restaurar apenas os últimos MAX_ENTRIES
            this._buffer = saved.slice(-MAX_ENTRIES);
        }
    }

    // ── API pública ───────────────────────────────────────────────────────────

    log(level, module, message, data = null, cityId = null) {
        const entry = {
            id:      nanoid(6),
            ts:      Date.now(),
            level,   // 'debug' | 'info' | 'warn' | 'error'
            module,
            message,
            cityId:  cityId ?? null,
            data:    data   ?? null,
        };

        // Buffer circular
        this._buffer.push(entry);
        if (this._buffer.length > MAX_ENTRIES) this._buffer.shift();

        // Persistência batched
        this._sinceLastPersist++;
        if (this._sinceLastPersist >= PERSIST_EVERY) {
            this._sinceLastPersist = 0;
            this._storage.set('audit_log', this._buffer).catch(() => {});
        }

        // Erros geram alerta na UI automaticamente
        if (level === 'error') {
            this._events.emit(this._events.E.UI_ALERT_ADDED, {
                id:       entry.id,
                level:    'P1',
                ts:       entry.ts,
                module,
                message,
                cityId,
            });
        }

        // Log no console para debug — usar referências salvas em inject.js (imunes a sobrescrita)
        const prefix = `[ERP:${module}]`;
        const _e = window.__erpError ?? console.error;
        const _w = window.__erpWarn  ?? console.warn;
        const _d = window.__erpDebug ?? console.debug ?? console.log;
        const _l = window.__erpLog   ?? console.log;
        if      (level === 'error') _e(prefix, message, data ?? '');
        else if (level === 'warn')  _w(prefix, message, data ?? '');
        else if (level === 'debug') _d(prefix, message, data ?? '');
        else                        _l(prefix, message, data ?? '');
    }

    info(module, message, data, cityId)  { this.log('info',  module, message, data, cityId); }
    warn(module, message, data, cityId)  { this.log('warn',  module, message, data, cityId); }
    error(module, message, data, cityId) { this.log('error', module, message, data, cityId); }
    debug(module, message, data, cityId) { this.log('debug', module, message, data, cityId); }

    /**
     * Retorna entradas filtradas.
     * @param {{ module?: string, level?: string, cityId?: number, since?: number }} filter
     */
    getEntries(filter = {}) {
        return this._buffer.filter(e => {
            if (filter.module && e.module !== filter.module) return false;
            if (filter.level  && e.level  !== filter.level)  return false;
            if (filter.cityId !== undefined && e.cityId !== filter.cityId) return false;
            if (filter.since  && e.ts < filter.since)        return false;
            return true;
        });
    }

    /** Limpa o buffer em memória e persiste vazio. */
    async clear() {
        this._buffer = [];
        this._sinceLastPersist = 0;
        await this._storage.set('audit_log', []);
    }
}

// ── Compat layer (testes legados) ─────────────────────────────────────────────

export const REASON = Object.freeze({
    WAITING_LOCAL:     'waiting_local',
    WINE_CRITICAL:     'wine_critical',
    GOAL_ENQUEUED:     'goal_enqueued',
    PATROL_SCHEDULED:  'patrol_scheduled',
    XHR_SYNC:          'xhr_sync',
    TRANSPORT_SKIP:    'transport_skip',
    WINE_NORMAL:       'wine_normal',
});

const _legacy = {
    _log: [],
    _stats: {
        transportsAvoided: 0,
        goldSaved: 0,
        xhrSyncs: 0,
        heartbeats: 0,
        heartbeatAvgS: null,
        lastHeartbeatTs: null,
        startedAt: null,
    },

    async init() {
        this._stats.startedAt = Game.getServerTime();
        return this;
    },

    async reset() {
        this._log = [];
        this._stats = {
            transportsAvoided: 0,
            goldSaved: 0,
            xhrSyncs: 0,
            heartbeats: 0,
            heartbeatAvgS: null,
            lastHeartbeatTs: null,
            startedAt: null,
        };
    },

    reason(type, msg, data) {
        const entry = {
            type,
            msg,
            ts: Game.getServerTime(),
            ...(data !== undefined ? { data } : {}),
        };
        this._log.push(entry);
        if (this._log.length > 200) this._log = this._log.slice(-200);
    },

    getLog(limit = null) {
        if (typeof limit === 'number') {
            return this._log.slice(-limit);
        }
        return [...this._log];
    },

    clearLog() {
        this._log = [];
    },

    incTransportAvoided(goldSaved = 0) {
        this._stats.transportsAvoided += 1;
        this._stats.goldSaved += Number(goldSaved) || 0;
        this.reason(REASON.TRANSPORT_SKIP, `Transporte evitado (+${goldSaved} ouro)`);
    },

    incXhrSync() {
        this._stats.xhrSyncs += 1;
        this.reason(REASON.XHR_SYNC, 'XHR sync');
    },

    recordHeartbeat() {
        const now = Game.getServerTime();
        this._stats.heartbeats += 1;
        if (this._stats.lastHeartbeatTs != null) {
            const dt = now - this._stats.lastHeartbeatTs;
            this._stats.heartbeatAvgS = this._stats.heartbeatAvgS == null
                ? dt
                : (this._stats.heartbeatAvgS * 0.8 + dt * 0.2);
        }
        this._stats.lastHeartbeatTs = now;
    },

    getStats() {
        return { ...this._stats };
    },

    // Mantém método para compat; não usado nos testes atuais.
    async persist() {
        await StorageCompat.set('audit_legacy', { log: this._log, stats: this._stats });
    },
};

export default _legacy;
