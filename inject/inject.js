// inject.js — page context
// CRÍTICO: o interceptor XHR/fetch DEVE ser instalado de forma SÍNCRONA aqui,
// antes de qualquer import. Imports de módulos ES são assíncronos — se o
// interceptor ficasse dentro de DataCollector.js chegaria tarde e perderia
// os primeiros requests do jogo.

// ═══ Salvar console nativo antes do jogo sobrescrever ════════════════════════
// Usar referências diretas dos protótipos — imune a sobrescrita do console pelo jogo
const _nativeLog = Function.prototype.bind.call(
    Function.prototype.call, console.log ?? function(){}
);
// Fallback: criar logger simples baseado em DOM se console estiver morto
let _log, _warn, _error;
try {
    _log   = console.log.bind(console);
    _warn  = console.warn.bind(console);
    _error = console.error.bind(console);
    // Testar se funciona
    _log;
} catch(_) {
    _log = _warn = _error = () => {};
}
window.__erpLog   = _log;
window.__erpWarn  = _warn;
window.__erpError = _error;

// ═══ INTERCEPTOR — primeira coisa executada, síncrono ═══════════════════════
window.__erpInterceptCallback = null;
// Callback de gravação (REC mode) — recebe (method, url, requestBody, responseText)
window.__erpRecCallback = null;

const _OrigXHR = window.XMLHttpRequest;
window.XMLHttpRequest = function () {
    const xhr  = new _OrigXHR();
    const _open = xhr.open.bind(xhr);
    const _send = xhr.send.bind(xhr);

    xhr.open = function (method, url, ...rest) {
        this.__erpUrl    = url;
        this.__erpMethod = method;
        return _open(method, url, ...rest);
    };

    xhr.send = function (body) {
        const url    = this.__erpUrl;
        const method = this.__erpMethod ?? 'GET';
        const reqBody = body ?? '';
        this.addEventListener('load', function () {
            window.__erpInterceptCallback?.(url, this.responseText);
            window.__erpRecCallback?.(method, url, reqBody, this.responseText);
        });
        return _send(body);
    };

    return xhr;
};

const _origFetch = window.fetch;
window.fetch = async function (...args) {
    const method  = args[1]?.method ?? 'GET';
    const reqBody = args[1]?.body ?? '';
    const url     = args[0]?.toString?.() ?? '';
    const response = await _origFetch(...args);
    response.clone().text().then(text => {
        window.__erpInterceptCallback?.(url, text);
        window.__erpRecCallback?.(method, url, reqBody, text);
    }).catch(() => {});
    return response;
};
// ═══ fim do interceptor ═════════════════════════════════════════════════════

// ═══ HOOKS DE CAPTURA EXPANDIDA ═════════════════════════════════════════════
// Instalados aqui (síncronos) para capturar o mais cedo possível.
// Callbacks preenchidos pelo DataCollector.initFullCapture() após init().

// Callback para cliques
window.__erpClickCallback = null;
document.addEventListener('click', function (e) {
    window.__erpClickCallback?.(e);
}, true); // capture phase — antes dos handlers do jogo

// Callback para console do jogo
window.__erpConsoleCallback = null;
;(function () {
    const levels = ['log', 'warn', 'error', 'info', 'debug'];
    for (const lvl of levels) {
        const orig = console[lvl]?.bind?.(console) ?? (() => {});
        console[lvl] = function (...args) {
            orig(...args);
            try { window.__erpConsoleCallback?.(lvl, args); } catch (_) {}
        };
    }
})();

// Callback para erros JS não capturados
window.__erpErrorCallback = null;
window.addEventListener('error', function (e) {
    window.__erpErrorCallback?.(e);
});
window.addEventListener('unhandledrejection', function (e) {
    window.__erpErrorCallback?.(e);
});
// ═══ fim dos hooks de captura expandida ═════════════════════════════════════

// Guarda de re-inicialização
if (window.__IKA_ERP_INIT__) { throw new Error('[ERP] Already initialized'); }
window.__IKA_ERP_INIT__ = true;

// ─── Imports assíncronos (depois do interceptor) ────────────────────────────
import { Events }        from '../modules/Events.js';
import { Storage }       from '../modules/Storage.js';
import { Config }        from '../modules/Config.js';
import { Audit }         from '../modules/Audit.js';
import { DataCollector } from '../modules/DataCollector.js';
import { StateManager }  from '../modules/StateManager.js';
import { GameClient }    from '../modules/GameClient.js';
import { TaskQueue }     from '../modules/TaskQueue.js';
import { CFO }           from '../modules/CFO.js';
import { COO }           from '../modules/COO.js';
import { HR }            from '../modules/HR.js';
import { CTO }           from '../modules/CTO.js';
import { CSO }           from '../modules/CSO.js';
import { MnA }           from '../modules/MnA.js';
import { UIBridge }      from '../modules/UIBridge.js';
import { initPanel }     from '../ui/panel.js';
import { initRecPanel }  from '../ui/rec-panel.js';

// ─── MODO REC-ONLY ────────────────────────────────────────────────────────────
// true  → apenas DataCollector ativo, REC ligado automaticamente, painel mínimo
// false → ERP completo (automação, fila, painel completo)
const REC_ONLY = false;

// ─── MVP FLAGS (ignorado quando REC_ONLY = true) ──────────────────────────────
const MVP = {
    cfo: true,
    coo: true,
    hr:  true,
    cto: true,
    cso: true,
    mna: true,
};

// ─── Boot ────────────────────────────────────────────────────────────────────
async function boot() {
    // ── Camada 0: infraestrutura ──────────────────────────────────────────────
    window.__ERP_BOOT_STAGE = 'storage.init';
    const storage = new Storage();
    await storage.init();

    window.__ERP_BOOT_STAGE = 'audit.init';
    const audit = new Audit({ storage, events: Events });
    await audit.init();

    // ── Modo REC-ONLY: apenas DataCollector + painel mínimo ───────────────────
    if (REC_ONLY) {
        audit.info('inject', '⏺ REC-ONLY boot — toda automação desativada');

        const dc = new DataCollector({ events: Events, audit });
        dc.init();
        dc.setRecMode(true);      // sempre ligado ao iniciar
        dc.initFullCapture();     // hooks de captura expandida

        await initRecPanel({ events: Events, dc });

        window.__ERP = { Events, storage, audit, dc, REC_ONLY: true };
        window.__ERP_BOOT_STAGE = 'done';
        _log('[ERP] REC-ONLY ativo. window.__ERP.dc disponível.');
        return;
    }

    // ── ERP completo (REC_ONLY = false) ───────────────────────────────────────
    audit.info('inject', 'ERP boot iniciado (MVP mode)');

    window.__ERP_BOOT_STAGE = 'config.init';
    const config = new Config(storage);
    await config.init();

    // ── Camada 2: aquisição e estado ──────────────────────────────────────────
    window.__ERP_BOOT_STAGE = 'dc+state.init';
    const dc    = new DataCollector({ events: Events, audit });
    const state = new StateManager({ events: Events, audit, config });

    dc.init();
    state.init();

    window.__ERP_BOOT_STAGE = 'waitReady';
    audit.info('inject', 'Aguardando 1º model refresh...');
    await state.waitReady();
    audit.info('inject', 'Estado pronto — modelo Ikariam disponível');

    // ── Camada 3: execução ────────────────────────────────────────────────────
    window.__ERP_BOOT_STAGE = 'queue.init';
    const client = new GameClient({ events: Events, audit, config, state, dc });
    const queue  = new TaskQueue({ events: Events, audit, config, state, client, storage });
    await queue.init();

    // ── Camada 4: módulos de negócio ──────────────────────────────────────────
    const cfo = new CFO({ events: Events, audit, config, state, queue });
    const coo = new COO({ events: Events, audit, config, state, queue, client, storage });
    const hr  = new HR ({ events: Events, audit, config, state, queue });
    const cto = new CTO({ events: Events, audit, config, state, queue });
    const cso = new CSO({ events: Events, audit, config, state, queue });
    const mna = new MnA({ events: Events, audit, config, state, queue, storage });

    queue.setCFO(cfo);

    if (MVP.cfo) cfo.init(); else audit.info('inject', 'CFO: desativado');
    if (MVP.coo) coo.init(); else audit.info('inject', 'COO: desativado');
    if (MVP.hr)  hr.init();  else audit.info('inject', 'HR: desativado');
    if (MVP.cto) cto.init(); else audit.info('inject', 'CTO: desativado');
    if (MVP.cso) cso.init(); else audit.info('inject', 'CSO: desativado');
    if (MVP.mna) mna.init(); else audit.info('inject', 'MnA: desativado');

    // ── Camada 5: UI ──────────────────────────────────────────────────────────
    window.__ERP_BOOT_STAGE = 'ui.init';
    const bridge = new UIBridge({ events: Events, state, queue, audit, config, dc });
    bridge.init();
    const extUrl = document.querySelector('script[data-ext-url]')?.dataset.extUrl ?? '';
    await initPanel({ events: Events, config, extUrl });
    bridge._schedRebuild();

    // ── Camada 6: fetchAllCities + heartbeat ──────────────────────────────────
    Events.once(Events.E.STATE_ALL_FRESH, () => {
        audit.info('inject', 'STATE_ALL_FRESH — replan dos módulos ativos');
        if (MVP.cfo) cfo.replan();
        if (MVP.coo) coo.replan();
        if (MVP.hr)  hr.replan();
        if (MVP.cto) cto.replan();
        if (MVP.cso) cso.replan();
        if (MVP.mna) mna.replan();
    });

    state.fetchAllCities(client).catch(err => {
        audit.error('inject', `fetchAllCities inicial: ${err.message}`);
    });

    const scheduleRefresh = () => {
        const delay = document.visibilityState === 'hidden'
            ? config.get('heartbeatBackgroundMs')
            : config.get('heartbeatFocusMs');

        setTimeout(async () => {
            try { await state.fetchAllCities(client); }
            catch (err) { audit.error('inject', `Heartbeat fetchAllCities: ${err.message}`); }
            scheduleRefresh();
        }, delay);
    };
    scheduleRefresh();

    window.__ERP = {
        Events, storage, config, audit,
        dc, state, client, queue,
        cfo, coo, hr, cto, cso, mna, bridge,
        MVP,
    };

    _log('[ERP] window.__ERP atribuído:', typeof window.__ERP, Object.keys(window.__ERP));
    window.__ERP_BOOT_STAGE = 'done';
    audit.info('inject', `ERP v1.0 MVP pronto. Ativos: ${Object.entries(MVP).filter(([,v])=>v).map(([k])=>k.toUpperCase()).join(', ')}`);
    _log('[ERP] MVP pronto. window.__ERP disponível para debug.');
}

boot().catch(err => {
    window.__ERP_BOOT_ERROR = { message: err.message, stack: err.stack, ts: Date.now() };
    _error('[ERP] Boot falhou:', err.message);
    _error('[ERP] Stack:', err.stack);
});
