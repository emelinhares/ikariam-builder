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
let _log, _warn, _error, _debug;
try {
    _log   = console.log.bind(console);
    _warn  = console.warn.bind(console);
    _error = console.error.bind(console);
    _debug = (console.debug ?? console.log).bind(console);
    // Testar se funciona
    _log;
} catch(_) {
    _log = _warn = _error = _debug = () => {};
}
window.__erpLog   = _log;
window.__erpWarn  = _warn;
window.__erpError = _error;
window.__erpDebug = _debug;

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
import { TransportIntentRegistry } from '../modules/TransportIntentRegistry.js';
import { CFO }           from '../modules/CFO.js';
import { COO }           from '../modules/COO.js';
import { HR }            from '../modules/HR.js';
import { CTO }           from '../modules/CTO.js';
import { CSO }           from '../modules/CSO.js';
import { MnA }           from '../modules/MnA.js';
import { Planner }       from '../modules/Planner.js';
import { Lifecycle }     from '../modules/Lifecycle.js';
import { UIBridge }      from '../modules/UIBridge.js';
import { HealthCheckRunner } from '../modules/HealthCheckRunner.js';
import { initPanel }     from '../ui/panel.js';
import { initRecPanel }  from '../ui/rec-panel.js';

// ─── MODO REC-ONLY ────────────────────────────────────────────────────────────
// true  → apenas DataCollector ativo, REC ligado automaticamente, painel mínimo
// false → ERP completo (automação, fila, painel completo)
const ERP_VERSION = '1.4.0'; // 2026-03-29: CFO urgency-based score (warehouse/townhall/port/academy/tavern), producer-priority source

const REC_ONLY = false;

// ─── MVP FLAGS (ignorado quando REC_ONLY = true) ──────────────────────────────
const MVP = {
    cfo:     true,
    coo:     true,
    hr:      true,
    cto:     true,
    cso:     true,
    mna:     true,
    planner: true,
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

    // Telemetria de erros em tempo real (runtime JS)
    window.addEventListener('error', (ev) => {
        try {
            audit.captureError(
                'runtime',
                ev?.error ?? ev?.message ?? 'window.error',
                {
                    source: 'window.error',
                    filename: ev?.filename ?? null,
                    lineno: ev?.lineno ?? null,
                    colno: ev?.colno ?? null,
                }
            );
        } catch {}
    });

    window.addEventListener('unhandledrejection', (ev) => {
        try {
            const reason = ev?.reason;
            audit.captureError(
                'runtime',
                reason instanceof Error ? reason : new Error(String(reason ?? 'Unhandled Promise rejection')),
                { source: 'unhandledrejection' }
            );
        } catch {}
    });

    // ── Modo REC-ONLY: apenas DataCollector + painel mínimo ───────────────────
    if (REC_ONLY) {
        audit.info('inject', '⏺ REC-ONLY boot — toda automação desativada');

        const dc = new DataCollector({ events: Events, audit });
        const lifecycle = new Lifecycle({ audit });
        dc.init();
        dc.setRecMode(true);      // sempre ligado ao iniciar
        dc.initFullCapture();     // hooks de captura expandida
        lifecycle.register('DataCollector', dc);

        const onBeforeUnload = () => lifecycle.shutdown('beforeunload');
        window.addEventListener('beforeunload', onBeforeUnload, { once: true });

        await initRecPanel({ events: Events, dc });

        window.__ERP = { Events, storage, audit, dc, lifecycle, REC_ONLY: true };
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
    const lifecycle = new Lifecycle({ audit });

    dc.init();
    state.init();

    window.__ERP_BOOT_STAGE = 'waitReady';
    audit.info('inject', 'Aguardando 1º model refresh...');
    await state.waitReady();
    audit.info('inject', 'Estado pronto — modelo Ikariam disponível');

    // ── Camada 3: execução ────────────────────────────────────────────────────
    window.__ERP_BOOT_STAGE = 'queue.init';
    const client = new GameClient({ events: Events, audit, config, state, dc });
    const transportIntentRegistry = new TransportIntentRegistry({ storage, audit, state });
    await transportIntentRegistry.init();
    const queue  = new TaskQueue({ events: Events, audit, config, state, client, storage, transportIntentRegistry });
    await queue.init();

    // ── Camada 4: módulos de negócio ──────────────────────────────────────────
    const cfo = new CFO({ events: Events, audit, config, state, queue });
    const coo = new COO({ events: Events, audit, config, state, queue, client, storage, transportIntentRegistry });
    const hr  = new HR ({ events: Events, audit, config, state, queue });
    const cto = new CTO({ events: Events, audit, config, state, queue });
    const cso = new CSO({ events: Events, audit, config, state, queue });
    const mna = new MnA({ events: Events, audit, config, state, queue, storage });
    const planner = new Planner({ events: Events, audit, config, state, queue, hr, cfo, coo, cto, cso, mna });

    lifecycle.register('Planner', planner);
    lifecycle.register('CFO', cfo);
    lifecycle.register('COO', coo);
    lifecycle.register('HR', hr);
    lifecycle.register('TaskQueue', queue);
    lifecycle.register('StateManager', state);
    lifecycle.register('DataCollector', dc);

    const onBeforeUnload = () => lifecycle.shutdown('beforeunload');
    window.addEventListener('beforeunload', onBeforeUnload, { once: true });

    queue.setCFO(cfo);
    queue.setTransportIntentRegistry(transportIntentRegistry);

    // Módulos registram apenas seus listeners reativos (DC_HEADER_DATA, QUEUE_TASK_DONE, etc.)
    // STATE_ALL_FRESH é registrado exclusivamente pelo Planner
    if (MVP.cfo) cfo.init(); else audit.info('inject', 'CFO: desativado');
    if (MVP.coo) coo.init(); else audit.info('inject', 'COO: desativado');
    if (MVP.hr)  hr.init();  else audit.info('inject', 'HR: desativado');
    if (MVP.cto) cto.init(); else audit.info('inject', 'CTO: desativado');
    if (MVP.cso) cso.init(); else audit.info('inject', 'CSO: desativado');
    if (MVP.mna) mna.init(); else audit.info('inject', 'MnA: desativado');
    if (MVP.planner) planner.init(); else audit.info('inject', 'Planner: desativado');

    const healthCheck = new HealthCheckRunner({
        events: Events,
        state,
        queue,
        audit,
        config,
        storage,
        client,
    });
    await healthCheck.init();

    // ── Camada 5: UI ──────────────────────────────────────────────────────────
    window.__ERP_BOOT_STAGE = 'ui.init';
    const bridge = new UIBridge({ events: Events, state, queue, audit, config, dc, healthCheck, planner, coo });
    bridge.init();
    const extUrl = document.querySelector('script[data-ext-url]')?.dataset.extUrl ?? '';
    await initPanel({ events: Events, config, extUrl });
    bridge._schedRebuild();

    // ── Camada 6: fetchAllCities + heartbeat ──────────────────────────────────
    // Planner.init() registrou STATE_ALL_FRESH — ele orquestra os replans na ordem correta
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
        transportIntentRegistry,
        cfo, coo, hr, cto, cso, mna, planner, bridge,
        healthCheck,
        lifecycle,
        MVP,
    };

    _log('[ERP] window.__ERP atribuído:', typeof window.__ERP, Object.keys(window.__ERP));
    window.__ERP_BOOT_STAGE = 'done';
    audit.info('inject', `ERP v${ERP_VERSION} pronto. Ativos: ${Object.entries(MVP).filter(([,v])=>v).map(([k])=>k.toUpperCase()).join(', ')}`);
    _log('[ERP] MVP pronto. window.__ERP disponível para debug.');
}

boot().catch(err => {
    window.__ERP_BOOT_ERROR = { message: err.message, stack: err.stack, ts: Date.now() };
    _error('[ERP] Boot falhou:', err.message);
    _error('[ERP] Stack:', err.stack);
});
