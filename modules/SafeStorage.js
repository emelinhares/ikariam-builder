// SafeStorage.js — wrapper resiliente para operações de storage

function _warn(module, op, key, err, audit = null, warn = null) {
    const message = `[${module}] Storage ${op} falhou para "${key}"`;
    const payload = { op, key, error: err?.message ?? String(err) };
    const warnFn = warn ?? globalThis.__erpWarn ?? console.warn;
    warnFn(message, err);
    audit?.warn?.(module, message, payload);
}

export function createSafeStorage(storage, { module = 'SafeStorage', audit = null, warn = null } = {}) {
    return {
        async get(key, fallback = null) {
            if (!storage?.get) return fallback;
            try {
                return await storage.get(key);
            } catch (err) {
                _warn(module, 'get', key, err, audit, warn);
                return fallback;
            }
        },

        async set(key, value) {
            if (!storage?.set) return false;
            try {
                await storage.set(key, value);
                return true;
            } catch (err) {
                _warn(module, 'set', key, err, audit, warn);
                return false;
            }
        },

        async remove(key) {
            if (!storage?.remove) return false;
            try {
                await storage.remove(key);
                return true;
            } catch (err) {
                _warn(module, 'remove', key, err, audit, warn);
                return false;
            }
        },
    };
}

