// Audit.js — log estruturado com buffer circular
// Sem dependência de módulos de negócio. Deps: Events, Storage, utils.

import { Events }  from './Events.js';
import { nanoid }  from './utils.js';
import StorageCompat from './Storage.js';
import Game from './Game.js';

const MAX_ENTRIES   = 200;
const MAX_ERROR_ENTRIES = 300;
const PERSIST_EVERY = 10;  // persistir a cada N novas entradas

export class Audit {
    constructor({ storage, events }) {
        this._storage  = storage;
        this._events   = events;
        this._buffer   = [];   // array circular, max MAX_ENTRIES
        this._errorBuffer = []; // array circular de erros, max MAX_ERROR_ENTRIES
        this._sinceLastPersist = 0;
        this._errorSeq = 0;
    }

    async init() {
        const saved = await this._storage.get('audit_log');
        if (Array.isArray(saved)) {
            // Restaurar apenas os últimos MAX_ENTRIES
            this._buffer = saved.slice(-MAX_ENTRIES);
        }

        const savedErrors = await this._storage.get('audit_errors');
        if (Array.isArray(savedErrors)) {
            this._errorBuffer = savedErrors.slice(-MAX_ERROR_ENTRIES);
            this._errorSeq = this._errorBuffer.length;
        }
    }

    // ── API pública ───────────────────────────────────────────────────────────

    log(level, module, message, data = null, cityId = null) {
        const normalizedLevel = String(level ?? 'info').toLowerCase();
        const entry = {
            id:      nanoid(6),
            ts:      Date.now(),
            level: normalizedLevel,   // 'debug' | 'info' | 'warn' | 'error'
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

        this._events?.emit?.(this._events.E.AUDIT_ENTRY_ADDED, { entry });

        // Canal dedicado de erros para análise em tempo real
        if (normalizedLevel === 'error') {
            const errorEntry = {
                ...entry,
                seq: ++this._errorSeq,
                fingerprint: this._fingerprint(entry),
            };
            this._errorBuffer.push(errorEntry);
            if (this._errorBuffer.length > MAX_ERROR_ENTRIES) this._errorBuffer.shift();

            // Persistência imediata dos erros (telemetria pós-morte)
            this._storage.set('audit_errors', this._errorBuffer).catch(() => {});

            this._events?.emit?.(this._events.E.AUDIT_ERROR_ADDED, { entry: errorEntry });
        }

        // Erros geram alerta na UI automaticamente
        if (normalizedLevel === 'error') {
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
        if      (normalizedLevel === 'error') _e(prefix, message, data ?? '');
        else if (normalizedLevel === 'warn')  _w(prefix, message, data ?? '');
        else if (normalizedLevel === 'debug') _d(prefix, message, data ?? '');
        else                        _l(prefix, message, data ?? '');

        return entry;
    }

    info(module, message, data, cityId)  { this.log('info',  module, message, data, cityId); }
    warn(module, message, data, cityId)  { this.log('warn',  module, message, data, cityId); }
    error(module, message, data, cityId) { this.log('error', module, message, data, cityId); }
    debug(module, message, data, cityId) { this.log('debug', module, message, data, cityId); }

    captureError(module, error, context = null, cityId = null, message = null) {
        const err = error instanceof Error
            ? error
            : new Error(typeof error === 'string' ? error : 'Erro desconhecido');

        const payload = {
            ...(context && typeof context === 'object' ? context : {}),
            errorName: err.name,
            stack: err.stack ?? null,
            cause: err.cause ?? null,
        };

        const msg = message
            ?? err.message
            ?? (typeof error === 'string' ? error : 'Erro desconhecido');

        return this.log('error', module, msg, payload, cityId);
    }

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

    getErrorEntries(filter = {}) {
        return this._errorBuffer.filter(e => {
            if (filter.module && e.module !== filter.module) return false;
            if (filter.cityId !== undefined && e.cityId !== filter.cityId) return false;
            if (filter.since && e.ts < filter.since) return false;
            if (filter.fingerprint && e.fingerprint !== filter.fingerprint) return false;
            return true;
        });
    }

    getErrorStats({ since } = {}) {
        const fromTs = Number.isFinite(since) ? since : 0;
        const rows = this._errorBuffer.filter(e => e.ts >= fromTs);
        const byModule = {};
        for (const e of rows) {
            byModule[e.module] = (byModule[e.module] ?? 0) + 1;
        }
        return {
            total: rows.length,
            byModule,
            lastTs: rows.length ? rows[rows.length - 1].ts : null,
        };
    }

    /** Limpa o buffer em memória e persiste vazio. */
    async clear() {
        this._buffer = [];
        this._errorBuffer = [];
        this._sinceLastPersist = 0;
        this._errorSeq = 0;
        await this._storage.set('audit_log', []);
        await this._storage.set('audit_errors', []);
    }

    _fingerprint(entry) {
        const base = `${entry.module}|${entry.message}|${entry.cityId ?? ''}`;
        let hash = 0;
        for (let i = 0; i < base.length; i++) {
            hash = ((hash << 5) - hash + base.charCodeAt(i)) | 0;
        }
        return `e_${Math.abs(hash)}`;
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
