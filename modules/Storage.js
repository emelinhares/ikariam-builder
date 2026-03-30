// Storage.js — wrapper sobre chrome.storage via postMessage bridge
// Prefixo de chave automático por servidor+mundo+avatar para isolamento de conta.

export class Storage {
    constructor() {
        this._pending = new Map(); // id → { resolve, reject }
        this._prefix  = null;     // montado na init()
        window.addEventListener('message', this._onMessage.bind(this));
    }

    async init() {
        await this._waitForModel();
        const host   = location.host.match(/(s\d+)-?([a-z]+)?\.ikariam/i);
        const world  = host?.[1] ?? 's0';
        const server = host?.[2] ?? 'xx';
        const avatar = window.ikariam?.model?.avatarId ?? '0';
        this._prefix = `IA_ERP_${server}_${world}_${avatar}_`;
    }

    _key(name) {
        return this._prefix + name;
    }

    get(name)        { return this._send('get',    this._key(name)); }
    set(name, value) { return this._send('set',    this._key(name), value); }
    remove(name)     { return this._send('remove', this._key(name)); }

    _send(op, key, value) {
        return new Promise((resolve, reject) => {
            const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
            this._pending.set(id, { resolve, reject });
            window.postMessage({ __erpBridge: true, id, op, key, value }, '*');
            setTimeout(() => {
                if (this._pending.has(id)) {
                    this._pending.delete(id);
                    reject(new Error(`Storage timeout: ${op} ${key}`));
                }
            }, 5000);
        });
    }

    _onMessage(e) {
        if (e.source !== window || !e.data?.__erpBridge || !e.data.__response) return;
        const { id, value, ok, error } = e.data;
        const p = this._pending.get(id);
        if (!p) return;
        this._pending.delete(id);
        if (error) p.reject(new Error(error));
        else       p.resolve(value ?? ok ?? null);
    }

    _waitForModel(timeout = 10_000) {
        return new Promise((resolve, reject) => {
            const check = () => { if (window.ikariam?.model?.avatarId) { resolve(); return true; } };
            if (check()) return;
            const iv = setInterval(() => { if (check()) clearInterval(iv); }, 100);
            setTimeout(() => { clearInterval(iv); reject(new Error('[Storage] model timeout')); }, timeout);
        });
    }
}

// ── Compat layer (testes legados) ─────────────────────────────────────────────

function _compatPrefix() {
    const host   = location?.host?.match?.(/(s\d+)-?([a-z]+)?\.ikariam/i);
    const world  = host?.[1] ?? 's0';
    const server = host?.[2] ?? 'xx';
    const avatar = window?.ikariam?.model?.avatarId ?? '0';
    return `IA_${server}_${world}_${avatar}_`;
}

export function _key(name) {
    return _compatPrefix() + name;
}

const _syncCache = new Map();

const StorageCompat = {
    async get(name) {
        const key = _key(name);
        const result = await chrome.storage.local.get(key);
        return result?.[key] ?? null;
    },

    set(name, value) {
        const key = _key(name);
        _syncCache.set(key, value);
        return chrome.storage.local.set({ [key]: value });
    },

    remove(name) {
        const key = _key(name);
        _syncCache.delete(key);
        return chrome.storage.local.remove(key);
    },

    getSync(name, fallback = null) {
        const key = _key(name);
        return _syncCache.has(key) ? _syncCache.get(key) : fallback;
    },

    setSync(name, value) {
        const key = _key(name);
        _syncCache.set(key, value);
    },
};

export default StorageCompat;
