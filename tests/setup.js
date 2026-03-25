// tests/setup.js — mocks globais para todos os testes

// ─── Chrome API mock ──────────────────────────────────────────────────────────
const _store = new Map();

globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn((keys, cb) => {
        const result = {};
        const ks = Array.isArray(keys) ? keys : [keys];
        ks.forEach(k => { result[k] = _store.get(k) ?? undefined; });
        if (cb) cb(result); else return Promise.resolve(result);
      }),
      set: vi.fn((obj, cb) => {
        Object.entries(obj).forEach(([k, v]) => _store.set(k, v));
        if (cb) cb(); else return Promise.resolve();
      }),
      remove: vi.fn((keys, cb) => {
        const ks = Array.isArray(keys) ? keys : [keys];
        ks.forEach(k => _store.delete(k));
        if (cb) cb(); else return Promise.resolve();
      }),
    },
  },
  notifications: {
    create: vi.fn(),
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn() },
  },
};

// Helper para resetar o store entre testes
globalThis._clearChromeStore = () => _store.clear();

// ─── window.ikariam mock base ─────────────────────────────────────────────────
globalThis.ikariam = {
  model: {
    avatarId: '42',
    relatedCityData: {
      selectedCity: { id: 101 },
    },
    backgroundId: 'someToken',
    headerData: {
      servertime: Math.floor(Date.now() / 1000),
    },
    updateBackgroundId: vi.fn(),
  },
};

// ─── window.location mock ─────────────────────────────────────────────────────
Object.defineProperty(globalThis, 'location', {
  value: { host: 's73-br.ikariam.gameforge.com' },
  writable: true,
});

// ─── postMessage bridge mock ──────────────────────────────────────────────────
// Simula content.js respondendo com chrome.storage
globalThis.window = globalThis;

const _origPost = globalThis.postMessage?.bind(globalThis) ?? (() => {});
let _msgIdCounter = 0;

globalThis.postMessage = vi.fn((msg) => {
  if (!msg || msg.type !== 'IA_BUILDER') return;
  const { cmd, key, value, id } = msg;
  let responseValue = null;

  if (cmd === 'storage_get') {
    responseValue = _store.has(key) ? _store.get(key) : null;
  } else if (cmd === 'storage_set') {
    _store.set(key, value);
  } else if (cmd === 'storage_remove') {
    _store.delete(key);
  }

  // Dispara evento de resposta como o content.js faria
  if (cmd === 'storage_get') {
    setTimeout(() => {
      globalThis.dispatchEvent(new MessageEvent('message', {
        source: globalThis,
        data: { type: 'IA_BUILDER_RESPONSE', id, value: responseValue },
      }));
    }, 0);
  }
});
