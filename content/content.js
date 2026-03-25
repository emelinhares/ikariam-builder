// content.js — content script (document_start)
// Três responsabilidades:
//   1. Injetar inject.js em page context
//   2. Bridge chrome.storage ↔ page context (protocolo __erpBridge)
//   3. Bridge para background (notificações)

// ─── 1. Injetar inject.js ───────────────────────────────────────────────────
// document_start: <head> pode não existir ainda — usar <html>
// Passar a URL base da extensão via dataset — inject.js não tem acesso ao chrome API
const script = document.createElement('script');
script.src  = chrome.runtime.getURL('inject/inject.js');
script.type = 'module';
script.dataset.extUrl = chrome.runtime.getURL('');  // ex: chrome-extension://abc123/
(document.head ?? document.documentElement).appendChild(script);

// ─── 2. Bridge chrome.storage ↔ page context ────────────────────────────────
window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.__erpBridge !== true || e.data.__response) return;
    const { id, op, key, value } = e.data;
    let response;

    try {
        if (op === 'set') {
            await chrome.storage.local.set({ [key]: value });
            response = { ok: true };
        } else if (op === 'get') {
            const result = await chrome.storage.local.get(key);
            response = { value: result[key] ?? null };
        } else if (op === 'remove') {
            await chrome.storage.local.remove(key);
            response = { ok: true };
        } else if (op === 'getAll') {
            const result = await chrome.storage.local.get(null);
            response = { value: result };
        } else {
            response = { error: `Unknown op: ${op}` };
        }
    } catch (err) {
        response = { error: err.message };
    }

    window.postMessage({ __erpBridge: true, __response: true, id, ...response }, '*');
});

// ─── 3. Bridge para background (notificações) ────────────────────────────────
window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.__erpNotify !== true) return;
    chrome.runtime.sendMessage(e.data.payload).catch(() => {});
});
