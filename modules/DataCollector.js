// DataCollector.js — captura de dados do jogo via XHR interceptado
// Roda em page context. Não faz requests próprios.
// O interceptor XHR/fetch já está instalado em inject.js (síncrono, antes dos imports).
// Estrutura confirmada pelo IKAEASY:
//   updateGlobalData → { headerData: {...}, backgroundData: { id, position, islandId, ... } }
//   changeView       → [viewName, htmlString, { viewScriptParams: {...} }]
//   Não existe updateBackgroundData separado — tudo vem em updateGlobalData.

import { WINE_USE } from '../data/wine.js';

// Ações a ignorar no REC (muito frequentes, sem valor de aprendizado)
const REC_SKIP_ACTIONS = new Set(['CityScreen', 'Premium', null, undefined]);
const REC_SKIP_VIEWS   = new Set(['researchAdvisor', 'tradeAdvisor',
    'diplomacyAdvisor', 'city', 'model']);

// Chaves localStorage — prefixo erp_ é filtrado pelo _hookStorage para não auto-capturar
const LS_LOG  = 'erp_rec_log';
const LS_MODE = 'erp_rec_mode';
const LS_SEQ  = 'erp_rec_seq';

// Limite de tamanho para persistência (4 MB — localStorage tem ~5-10 MB)
const LS_MAX_BYTES = 4_000_000;

// Tamanho máximo de HTML/DOM por entrada no storage (evita explodir o limite)
const LS_MAX_HTML = 8_000;

export class DataCollector {
    constructor({ events, audit }) {
        this._events    = events;
        this._audit     = audit;
        this._lastToken = null;
        this._recMode   = false;

        // Log ilimitado de capturas REC — independente do buffer circular do Audit
        this._recLog          = [];
        this._recCounter      = 0;
        this._persistTimer    = null;
    }

    init() {
        window.__erpInterceptCallback = this._onResponse.bind(this);
        window.__erpRecCallback       = this._onRecCapture.bind(this);

        // Restaurar log e estado REC do localStorage (sobrevive a reloads de página)
        const wasActive = this._restoreFromStorage();
        if (wasActive) {
            this._recMode = true;
            this._audit.info('DataCollector',
                `⏺ REC restaurado do localStorage — ${this._recLog.length} capturas anteriores`);
        }

        this._startModelMonitor();
        this._audit.info('DataCollector', 'init() — interceptor registrado');
    }

    getToken()       { return this._lastToken; }
    setToken(token)  { this._lastToken = token; }
    isRecMode()      { return this._recMode; }

    setRecMode(active) {
        this._recMode = !!active;
        this._audit.info('DataCollector', active ? '⏺ REC ligado — gravando todas as ações' : '⏹ REC desligado');
        // Persistir estado imediatamente (para sobreviver ao próximo reload)
        try { localStorage.setItem(LS_MODE, String(this._recMode)); } catch { /* ignorar */ }
    }

    // ── API de captura ────────────────────────────────────────────────────────

    /** Retorna todas as capturas REC acumuladas. */
    getRecLog() { return this._recLog; }

    /** Apaga o log REC (memória + localStorage). */
    clearRecLog() {
        this._recLog = [];
        this._recCounter = 0;
        try {
            localStorage.removeItem(LS_LOG);
            localStorage.removeItem(LS_SEQ);
        } catch { /* ignorar */ }
        this._audit.info('DataCollector', 'Log REC limpo');
    }

    /**
     * Exporta o log REC completo como texto plano.
     * Inclui todos os tipos: NET, VIEW, CLICK, DOM, CONSOLE, ERROR, MODEL, STORAGE.
     */
    exportRecLog() {
        if (!this._recLog.length) return '(nenhuma captura)';
        const SEP = '─'.repeat(80);
        return this._recLog.map((e, i) => {
            const t   = new Date(e.ts).toLocaleTimeString('pt-BR', { hour12: false });
            const idx = `[${String(i + 1).padStart(4, '0')}]`;
            const cat = `[${(e.cat ?? 'NET').padEnd(7)}]`;

            switch (e.cat) {
                case 'CLICK':
                    return `${idx} ${t} ${cat} ${e.target.tag}#${e.target.id||'?'}.${e.target.classes||'?'} "${e.target.text||''}" href=${e.target.href||''}\n  data: ${e.target.data||'{}'}`;

                case 'VIEW':
                    return `${idx} ${t} ${cat} ${e.viewName}\n` +
                        (e.viewScriptParams ? `  viewScriptParams: ${JSON.stringify(e.viewScriptParams, null, 2).replace(/\n/g, '\n  ')}\n` : '') +
                        (e.viewHtml ? `  HTML (${e.viewHtml.length} chars):\n  ${e.viewHtml.replace(/\n/g, '\n  ')}` : '');

                case 'DOM':
                    return `${idx} ${t} ${cat} ${e.mutation.type} on <${e.mutation.target}> added=${e.mutation.added} removed=${e.mutation.removed}\n  ${e.mutation.summary}`;

                case 'CONSOLE':
                    return `${idx} ${t} ${cat} [${e.level}] ${e.message}`;

                case 'ERROR':
                    return `${idx} ${t} ${cat} ${e.message}\n  ${e.stack || '(no stack)'}`;

                case 'MODEL':
                    return `${idx} ${t} ${cat} ${e.summary}\n  ${JSON.stringify(e.diff, null, 2).replace(/\n/g, '\n  ')}`;

                case 'STORAGE':
                    return `${idx} ${t} ${cat} [${e.storageType}] ${e.op} ${e.key} = ${e.value ?? '(removed)'}`;

                default: { // NET
                    const hdr = `${idx} ${t} ${cat} ${e.method} ${e.action}`;
                    const req = e.reqSummary  ? `  REQ: ${e.reqSummary}` : '';
                    const cmd = e.commands    ? `  ← [${e.commands}]` : '';
                    const ext = e.extras      ? `  ${e.extras}` : '';
                    const vsp = e.viewScriptParams
                        ? `  viewScriptParams: ${JSON.stringify(e.viewScriptParams, null, 2).replace(/\n/g, '\n  ')}`
                        : '';
                    const flt = (e.fleets ?? []).map(f =>
                        `  fleet: ${f.from} → ${f.to} | type=${f.type} ships=${f.ships} cargo=[${f.cargo}] eta=${f.eta}`
                    ).join('\n');
                    return [hdr, req, cmd, ext, vsp, flt].filter(Boolean).join('\n');
                }
            }
        }).join('\n' + SEP + '\n');
    }

    // ── Captura expandida — tudo além de XHR/fetch ────────────────────────────

    /**
     * Ativa captura de cliques, DOM, console, erros JS, model diffs e localStorage.
     * Chamar após init(). Requer os hooks síncronos em inject.js.
     */
    initFullCapture() {
        this._hookClicks();
        this._hookConsole();
        this._hookErrors();
        this._hookDOM();
        this._hookStorage();
        this._startModelDiffMonitor();
        this._audit.info('DataCollector', 'initFullCapture() — captura total ativa');
    }

    _push(entry) {
        this._recCounter++;
        entry.seq = this._recCounter;
        entry.ts  = entry.ts ?? Date.now();
        this._recLog.push(entry);

        // Persistir no localStorage com debounce de 800ms
        // (evita escrita a cada captura individual — DOM/CLICK são muito frequentes)
        this._schedulePersist();

        if (this._events?.E?.DC_REC_CAPTURE) {
            this._events.emit(this._events.E.DC_REC_CAPTURE, { seq: this._recCounter, cat: entry.cat });
        }
    }

    // ── Persistência localStorage ─────────────────────────────────────────────

    _schedulePersist() {
        clearTimeout(this._persistTimer);
        this._persistTimer = setTimeout(() => this._persistLog(), 800);
    }

    _persistLog() {
        try {
            // Compactar entradas grandes para não explodir o localStorage
            const compact = this._recLog.map(e => {
                if (e.cat === 'VIEW' && e.viewHtml?.length > LS_MAX_HTML) {
                    return { ...e, viewHtml: e.viewHtml.slice(0, LS_MAX_HTML) + '\n…[truncado no storage — use Exportar para ver completo]' };
                }
                if (e.cat === 'DOM' && e.mutation?.summary?.length > LS_MAX_HTML) {
                    return { ...e, mutation: { ...e.mutation, summary: e.mutation.summary.slice(0, LS_MAX_HTML) + '\n…[truncado]' } };
                }
                return e;
            });

            let str = JSON.stringify(compact);

            // Se exceder o limite, descartar as entradas mais antigas até caber
            if (str.length > LS_MAX_BYTES) {
                const keep = Math.floor(compact.length * (LS_MAX_BYTES / str.length) * 0.85);
                const trimmed = compact.slice(compact.length - keep);
                str = JSON.stringify(trimmed);
                this._audit.debug('DataCollector',
                    `localStorage: log truncado — mantendo últimas ${keep} entradas (limite ${LS_MAX_BYTES / 1000}KB)`
                );
            }

            localStorage.setItem(LS_LOG,  str);
            localStorage.setItem(LS_MODE, String(this._recMode));
            localStorage.setItem(LS_SEQ,  String(this._recCounter));
        } catch (err) {
            // Pode falhar por quota excedida — não é crítico
            this._audit.debug('DataCollector', `localStorage persist falhou: ${err.message}`);
        }
    }

    _restoreFromStorage() {
        try {
            const mode = localStorage.getItem(LS_MODE) === 'true';
            const seq  = parseInt(localStorage.getItem(LS_SEQ) ?? '0', 10) || 0;
            const raw  = localStorage.getItem(LS_LOG);
            if (!raw) return false;

            const log = JSON.parse(raw);
            if (!Array.isArray(log) || log.length === 0) return false;

            this._recLog     = log;
            this._recCounter = seq;
            return mode; // retorna se o REC estava ativo antes do reload
        } catch {
            return false; // storage corrompido — iniciar limpo
        }
    }

    _hookClicks() {
        window.__erpClickCallback = (e) => {
            if (!this._recMode) return;
            const el = e.target;
            if (!el || el.nodeType !== 1) return;

            // Subir até 3 níveis para encontrar elemento com id ou texto significativo
            let cur = el;
            for (let i = 0; i < 3; i++) {
                if (cur.id || cur.getAttribute?.('data-tab') || cur.getAttribute?.('href')) break;
                if (cur.parentElement) cur = cur.parentElement;
            }

            const id      = cur.id || el.id || '';
            const classes = [...(cur.classList ?? [])].slice(0, 4).join(' ');
            const text    = (cur.textContent ?? el.textContent ?? '').trim().slice(0, 80);
            const href    = cur.getAttribute?.('href') || el.getAttribute?.('href') || '';
            const tag     = cur.tagName?.toLowerCase() ?? el.tagName?.toLowerCase() ?? '?';

            // Capturar atributos data-* relevantes
            const dataAttrs = {};
            for (const attr of (cur.attributes ?? [])) {
                if (attr.name.startsWith('data-')) dataAttrs[attr.name] = attr.value;
            }

            // Ignorar cliques sem contexto ou direto no body/html (sem valor)
            if (!id && !text && !href && Object.keys(dataAttrs).length === 0) return;
            if (tag === 'body' || tag === 'html') return;

            this._push({
                cat: 'CLICK',
                target: { tag, id, classes, text, href, data: JSON.stringify(dataAttrs) },
            });
        };
    }

    _hookConsole() {
        // Filtrar mensagens do próprio ERP para não poluir
        const ERP_PREFIX = /^\[ERP\]|^\[Events\]/;
        window.__erpConsoleCallback = (level, args) => {
            if (!this._recMode) return;
            const message = args.map(a => {
                try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
                catch { return '[circular]'; }
            }).join(' ');
            if (ERP_PREFIX.test(message)) return;
            if (!message.trim()) return;
            this._push({ cat: 'CONSOLE', level, message });
        };
    }

    _hookErrors() {
        window.__erpErrorCallback = (e) => {
            if (!this._recMode) return;
            if (e instanceof PromiseRejectionEvent) {
                const msg = e.reason?.message ?? String(e.reason ?? 'unhandledrejection');
                const stk = e.reason?.stack ?? '';
                this._push({ cat: 'ERROR', message: `UnhandledRejection: ${msg}`, stack: stk });
            } else {
                this._push({
                    cat:     'ERROR',
                    message: `${e.message} (${e.filename}:${e.lineno})`,
                    stack:   e.error?.stack ?? '',
                });
            }
        };
    }

    _hookDOM() {
        // IDs que pertencem à extensão ou outros scripts — ignorar no DOM capture
        const DOM_IGNORE_IDS = new Set(['erp-rec-host', 'sandbox', 'ikaeasy_dynamic',
            'ikaeasy_main', 'ikaeasy_panel']);
        const DOM_IGNORE_CLASSES = ['ikaeasy_dynamic', 'ikaeasy_main'];

        const observer = new MutationObserver((mutations) => {
            if (!this._recMode) return;
            for (const m of mutations) {
                if (m.type !== 'childList') continue;
                const added   = m.addedNodes.length;
                const removed = m.removedNodes.length;
                if (added === 0 && removed === 0) continue;

                // Apenas nós Element do jogo (excluir extensão própria e ferramentas externas)
                const sig = [...m.addedNodes].filter(n => {
                    if (n.nodeType !== 1) return false;
                    if (DOM_IGNORE_IDS.has(n.id)) return false;
                    if (DOM_IGNORE_CLASSES.some(c => n.classList?.contains(c))) return false;
                    return n.id || n.className;
                });
                if (!sig.length) continue;

                const targetTag = m.target?.tagName?.toLowerCase() ?? '?';
                const targetId  = m.target?.id ?? '';
                const summary   = sig.map(n => {
                    const tag = n.tagName?.toLowerCase();
                    const id  = n.id ? `#${n.id}` : '';
                    const cls = n.className ? `.${String(n.className).split(' ').slice(0,3).join('.')}` : '';
                    // Capturar apenas o esqueleto do HTML (primeiros 2KB) — HTML completo já vem via VIEW entries
                    const rawHtml = n.outerHTML ?? '';
                    const html = rawHtml.length < 2_000
                        ? `\n    HTML: ${rawHtml}`
                        : `\n    HTML: <${tag}${id}${cls}> (${rawHtml.length} chars — ver VIEW entry para HTML completo)`;
                    return `<${tag}${id}${cls}>${html}`;
                }).join('\n  ');

                this._push({
                    cat: 'DOM',
                    mutation: {
                        type:   'childList',
                        target: `${targetTag}${targetId ? '#'+targetId : ''}`,
                        added,
                        removed,
                        summary,
                    },
                });
            }
        });

        // Observar o body com subtree: false (só filhos diretos — evita flood)
        // Para capturar janelas do jogo que abrem como filhos do body
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: false });
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                observer.observe(document.body, { childList: true, subtree: false });
            });
        }

        // Também observar o contêiner principal do jogo com subtree (1 nível)
        // Ikariam usa #container ou #citymap como contêiner principal
        const tryObserveMain = () => {
            for (const sel of ['#container', '#citymap', '#mainContent', '#wrapper']) {
                const el = document.querySelector(sel);
                if (el) {
                    observer.observe(el, { childList: true, subtree: false });
                    this._audit.debug('DataCollector', `DOM observer: observando ${sel}`);
                    break;
                }
            }
        };
        setTimeout(tryObserveMain, 2000);
    }

    _hookStorage() {
        // Interceptar localStorage e sessionStorage
        const capture = (storageType, op, key, value) => {
            if (!this._recMode) return;
            // Ignorar chaves do próprio ERP
            if (key?.startsWith?.('erp_')) return;
            this._push({ cat: 'STORAGE', storageType, op, key, value });
        };

        for (const [storageType, store] of [['local', localStorage], ['session', sessionStorage]]) {
            try {
                const origSet    = store.setItem.bind(store);
                const origRemove = store.removeItem.bind(store);
                store.setItem = function(k, v) {
                    origSet(k, v);
                    capture(storageType, 'set', k, v);
                };
                store.removeItem = function(k) {
                    origRemove(k);
                    capture(storageType, 'remove', k, null);
                };
            } catch { /* storage pode estar bloqueado */ }
        }
    }

    _startModelDiffMonitor() {
        // Snapshots do ikariam.model a cada 5s, logando apenas diffs relevantes
        const WATCH_KEYS = [
            'currentResources', 'freeTransporters', 'wineSpendings',
            'actionRequest', 'serverTime',
        ];
        let lastSnap = null;

        const tick = () => {
            const model = window.ikariam?.model;
            if (model && this._recMode) {
                const snap = {};
                for (const k of WATCH_KEYS) {
                    try { snap[k] = JSON.stringify(model[k]); } catch { snap[k] = '?'; }
                }
                if (lastSnap) {
                    const diff = {};
                    for (const k of WATCH_KEYS) {
                        if (snap[k] !== lastSnap[k]) {
                            diff[k] = { old: lastSnap[k], new: snap[k] };
                        }
                    }
                    if (Object.keys(diff).length > 0) {
                        const summary = Object.keys(diff).join(', ') + ' mudaram';
                        this._push({ cat: 'MODEL', summary, diff });
                    }
                }
                lastSnap = snap;
            }
            setTimeout(tick, 5_000);
        };
        setTimeout(tick, 3_000);
    }

    // ── Gravação REC ─────────────────────────────────────────────────────────

    _onRecCapture(method, url, requestBody, responseText) {
        if (!this._recMode) return;

        // Extrair parâmetros da requisição
        const reqParams = this._parseParams(method, url, requestBody);
        const action    = reqParams.action ?? reqParams.view ?? '(sem ação)';

        // Filtrar ruído
        if (REC_SKIP_ACTIONS.has(reqParams.action) && REC_SKIP_VIEWS.has(reqParams.view)) return;
        if (REC_SKIP_VIEWS.has(action)) return;

        // Extrair comandos da resposta
        let commands = [];
        let extras   = {};
        try {
            const data = JSON.parse(responseText.trim());
            if (Array.isArray(data)) {
                commands = data.filter(c => Array.isArray(c)).map(c => c[0]);

                // Extrair info relevante da resposta
                const globalCmd = data.find(c => Array.isArray(c) && c[0] === 'updateGlobalData');
                const bgData    = globalCmd?.[1]?.backgroundData;
                if (bgData?.endUpgradeTime  > 0) extras.endUpgrade  = new Date(bgData.endUpgradeTime  * 1000).toLocaleTimeString('pt-BR');
                if (bgData?.underConstruction >= 0) extras.underConstruction = bgData.underConstruction;
                if (bgData?.id)               extras.cityId        = bgData.id;

                const fleetCmd = data.find(c => Array.isArray(c) && c[0] === 'fleetMoveList');
                if (fleetCmd && Array.isArray(fleetCmd[1])) {
                    extras.fleets = fleetCmd[1].length;
                    extras._fleetList = fleetCmd[1];
                }

                const popupCmd = data.find(c => Array.isArray(c) && c[0] === 'popupData');
                if (popupCmd?.[1]) extras.popup = JSON.stringify(popupCmd[1]).slice(0, 100);

                const feedCmd = data.find(c => Array.isArray(c) && c[0] === 'provideFeedback');
                if (feedCmd?.[1]) {
                    const msgs = (Array.isArray(feedCmd[1]) ? feedCmd[1] : [feedCmd[1]])
                        .map(f => f?.text ?? '').filter(Boolean);
                    if (msgs.length) extras.feedback = msgs.join(' | ');
                }

                // changeView — extrair viewScriptParams E o HTML completo da janela
                const changeCmd = data.find(c => Array.isArray(c) && c[0] === 'changeView');
                if (changeCmd && Array.isArray(changeCmd[1])) {
                    const vsp     = changeCmd[1][2]?.viewScriptParams;
                    const viewHtml = typeof changeCmd[1][1] === 'string' ? changeCmd[1][1] : null;
                    if (vsp && typeof vsp === 'object' && Object.keys(vsp).length > 0) {
                        extras.viewScriptParams = vsp;
                    }
                    if (viewHtml && viewHtml.length > 20) {
                        extras._viewHtml     = viewHtml;
                        extras._viewName     = changeCmd[1][0] ?? '?';
                    }
                }
            }
        } catch { /* resposta não-JSON — ignorar */ }

        // Filtrar se não há comandos relevantes
        if (!commands.length) return;

        // Montar linha de request resumida (sem token/ajax)
        const SKIP_PARAMS = new Set(['actionRequest', 'ajax', 'backgroundView',
            'templateView', 'templatePosition', 'linkType']);
        const reqSummary = Object.entries(reqParams)
            .filter(([k]) => !SKIP_PARAMS.has(k))
            .map(([k, v]) => `${k}=${v}`)
            .join(' ');

        const { viewScriptParams, _fleetList, _viewHtml, _viewName, ...extrasRest } = extras;
        const extrasStr = Object.entries(extrasRest).map(([k, v]) => `${k}:${v}`).join(' ');
        const cmdStr    = commands.filter(c => c !== 'ingameCounterData' && c !== 'removeIngameCounterData').join(', ');

        this._audit.info('DataCollector',
            `⏺ ${method} ${action} | ${reqSummary}`,
            { recResponse: `← [${cmdStr}]${extrasStr ? ' ' + extrasStr : ''}` }
        );

        // Log separado para viewScriptParams — dados estruturados da janela
        if (viewScriptParams) {
            this._audit.info('DataCollector',
                `  ↳ viewScriptParams:${JSON.stringify(viewScriptParams)}`
            );
        }

        // Log separado para fleetMoveList — uma linha por missão
        const fleetEntries = [];
        if (_fleetList?.length) {
            for (const m of _fleetList) {
                const cargo = m.cargo ?? m.load ?? m.resources ?? null;
                const cargoStr = cargo
                    ? Object.entries(cargo).filter(([,v]) => Number(v) > 0).map(([k,v]) => `${k}=${v}`).join(' ')
                    : JSON.stringify(m).slice(0, 120);
                const line = `  ↳ fleet: ${m.originCityName ?? m.origin ?? m.originCityId} → ${m.targetCityName ?? m.target ?? m.targetCityId} | type=${m.missionType ?? m.type ?? '?'} ships=${m.transporterCount ?? m.ships ?? '?'} cargo=[${cargoStr}] eta=${m.eventTime ?? '?'}`;
                this._audit.info('DataCollector', line);
                fleetEntries.push({
                    from:  m.originCityName ?? m.origin ?? String(m.originCityId ?? '?'),
                    to:    m.targetCityName ?? m.target ?? String(m.targetCityId ?? '?'),
                    type:  m.missionType ?? m.type ?? '?',
                    ships: m.transporterCount ?? m.ships ?? '?',
                    cargo: cargoStr,
                    eta:   m.eventTime ?? '?',
                });
            }
        }

        // Salvar entrada NET no log ilimitado

        this._push({
            cat:             'NET',
            method,
            action,
            reqSummary,
            commands:        cmdStr || null,
            extras:          extrasStr || null,
            viewScriptParams: viewScriptParams ?? null,
            fleets:          fleetEntries.length ? fleetEntries : null,
            raw:             { reqParams },
        });

        // Entrada VIEW separada para HTML da janela (mais fácil de filtrar/exportar)
        if (_viewHtml) {
            this._push({
                cat:             'VIEW',
                viewName:        _viewName ?? action,
                viewHtml:        _viewHtml,
                viewScriptParams: viewScriptParams ?? null,
            });
        }
    }

    _parseParams(method, url, body) {
        const params = {};
        // Params da URL
        try {
            const baseOrigin = window.location?.origin
                || (window.location?.host ? `https://${window.location.host}` : 'https://localhost');
            const u = new URL(url, baseOrigin);
            for (const [k, v] of u.searchParams) params[k] = v;
        } catch { /* URL relativa */ }
        // Params do body (POST form-encoded)
        if (body && typeof body === 'string') {
            try {
                for (const [k, v] of new URLSearchParams(body)) params[k] = v;
            } catch { /* ignorar */ }
        }
        return params;
    }

    // ── Processamento de resposta XHR/fetch ──────────────────────────────────

    _onResponse(url, text) {
        let data;
        try {
            const trimmed = text.trim();
            if (!trimmed.startsWith('[')) return;
            data = JSON.parse(trimmed);
            if (!Array.isArray(data)) return;
        } catch {
            return;
        }
        this._processCommands(data, url);
    }

    _processCommands(commands, url) {
        for (const cmd of commands) {
            if (!Array.isArray(cmd) || cmd.length < 2) continue;
            const [name, payload] = cmd;
            if (name === 'updateGlobalData') this._onGlobalData(payload, url);
            if (name === 'fleetMoveList')    this._onFleetMoveList(payload);
            // changeView → cmd = ['changeView', [viewName, htmlString, { viewScriptParams }]]
            // payload aqui é cmd[1] = o array interno [viewName, html, meta]
            if (name === 'changeView')       this._onChangeView(payload);
        }
    }

    _onGlobalData(payload, url) {
        if (!payload) return;

        // Token CSRF — atualizar sempre
        if (payload.actionRequest) {
            this._lastToken = payload.actionRequest;
        }

        const headData = payload.headerData   || {};
        const bgData   = payload.backgroundData || {};
        const reqParams = this._parseParams('GET', url, '');

        // cityId vem de backgroundData.id — fonte autoritativa (IKAEASY navigation.js:handle_updateGlobalData)
        let cityId = this._toPositiveInt(bgData.id);
        const islandId = this._toPositiveInt(bgData.islandId)
            ?? this._toPositiveInt(reqParams.currentIslandId)
            ?? this._toPositiveInt(reqParams.islandId);

        // Se estamos em contexto de ilha e a resposta sugere um "novo" cityId,
        // priorizar identidade já conhecida islandId -> cityId para evitar duplicação.
        if (this._isIslandContext(url, reqParams) && islandId) {
            const mappedCityId = this._resolveMappedCityIdByIslandId(islandId);
            if (mappedCityId && mappedCityId !== cityId) {
                this._audit.debug('DataCollector',
                    `identity dedup: ilha ${islandId} resolvida para cidade ${mappedCityId} (candidato=${cityId ?? '?'})`
                );
                cityId = mappedCityId;
            }
        }

        // Persistir mapeamento sempre que ambos IDs estiverem disponíveis.
        if (cityId && islandId) {
            this._registerCityIslandMapping(cityId, islandId);
        }

        // tavernWineLevel — derivado de wineSpendings via WINE_USE (mesma lógica do IKAEASY)
        // wineSpendings pode ser 0 quando estoque acabou — mas o nível da taberna não muda.
        // Por isso derivamos via lookup na tabela em vez de confiar no valor do servidor.
        if (headData.wineSpendings !== undefined) {
            const ws = Number(headData.wineSpendings);
            // findIndex(v >= ws) em vez de indexOf(ws exacto):
            // o servidor pode retornar valores ligeiramente diferentes dos da tabela
            // (ex: 109 em vez de 110). Pegamos o nível mínimo que cobre o consumo real.
            headData._tavernWineLevel = ws <= 0 ? 0 : WINE_USE.findIndex(v => v >= ws);
        }

        // Emitir dados de header (recursos, transportadores, produção)
        if (Object.keys(headData).length > 0) {
            this._events.emit(this._events.E.DC_HEADER_DATA, {
                headerData: headData,
                cityId,
                token: this._lastToken,
                url,
            });
        }

        // Emitir dados de screen (edifícios, islandId, isCapital)
        if (bgData.position || bgData.id) {
            const screenData = islandId && !bgData.islandId
                ? { ...bgData, islandId }
                : bgData;
            this._events.emit(this._events.E.DC_SCREEN_DATA, {
                screenData,
                cityId,
                url,
            });
        }
    }

    _onFleetMoveList(payload) {
        if (!Array.isArray(payload)) return;
        this._events.emit(this._events.E.DC_FLEET_MOVEMENTS, { movements: payload });
    }

    // changeView → [viewName, htmlString, { viewScriptParams }]
    // Espelha o que o IKAEASY faz em ikaeasy.js parseResponse intercept.
    _onChangeView(payload) {
        if (!Array.isArray(payload) || payload.length < 3) return;
        const viewName   = payload[0];
        const extraData  = payload[2];
        if (typeof extraData !== 'object' || !extraData?.viewScriptParams) return;

        const params = extraData.viewScriptParams;

        if (viewName === 'townHall') {
            // cityId vem nos params ou cai de volta ao activeCityId
            const cityId = parseInt(params.cityId ?? params.id ?? 0) || null;
            this._events.emit(this._events.E.DC_TOWNHALL_DATA, { cityId, params });
        }

        if (viewName === 'militaryAdvisor') {
            const raw = params.militaryAndFleetMovements;
            if (!Array.isArray(raw)) return;
            const movements = raw.map(m => this._parseMilitaryMovement(m)).filter(Boolean);
            if (movements.length > 0) {
                this._events.emit(this._events.E.DC_FLEET_MOVEMENTS, { movements });
            }
        }
    }

    // Converte um entry de militaryAndFleetMovements para o formato interno do ERP.
    // cssClass "resource_icon wood" → resource="wood"; amount "5.000" → 5000 (PT format).
    _parseMilitaryMovement(m) {
        if (!m?.origin || !m?.target) return null;
        const cargo = {};
        for (const r of (m.resources ?? [])) {
            const res = (r.cssClass ?? '').split(' ').pop(); // "resource_icon wood" → "wood"
            const amt = parseInt(String(r.amount ?? '0').replace(/\./g, ''), 10);
            if (res && amt > 0) cargo[res] = amt;
        }
        return {
            id:             m.event?.id ?? null,
            missionType:    m.event?.missionIconClass ?? m.event?.type ?? 'unknown',
            isReturn:       !!(m.event?.isFleetReturning),
            originCityId:   m.origin.cityId   ?? null,
            originCityName: m.origin.name      ?? null,
            targetCityId:   m.target.cityId   ?? null,
            targetCityName: m.target.name      ?? null,
            ships:          m.fleet?.amount    ?? 0,
            cargo,
            eventTime:      m.eventTime        ?? null, // Unix timestamp (segundos)
            isOwn:          !!(m.isOwnArmyOrFleet),
        };
    }

    // ── Monitor do ikariam.model ──────────────────────────────────────────────

    _startModelMonitor() {
        const tick = () => {
            const model = window.ikariam?.model;
            if (model) {
                this._events.emit(this._events.E.DC_MODEL_REFRESH, { model });
                this._synthesizeFromModel(model);
            }
            const delay = document.visibilityState === 'hidden' ? 300_000 : 15_000;
            setTimeout(tick, delay);
        };
        setTimeout(tick, 1_000);
    }

    // Sintetiza DC_HEADER_DATA e DC_SCREEN_DATA a partir do ikariam.model
    // Equivalente ao city.update() do IKAEASY que lê Front.data diretamente
    _synthesizeFromModel(model) {
        // cityId da cidade atualmente ativa
        const relatedData = model.relatedCityData ?? {};
        const rawSelected = relatedData.selectedCity ?? relatedData.selectedCityId ?? '';
        const cityId = Number(String(rawSelected).replace('city_', '')) || null;
        if (!cityId) return;

        // Token CSRF
        if (model.actionRequest) this._lastToken = model.actionRequest;

        // Header data — recursos, transportadores, produção
        // resourceProduction e tradegoodProduction chegam em /s — converter para /h (×3600)
        // Espelha IKAEASY city.update(): production[wood] = Math.floor(resourceProduction * 3600)
        const ws = Number(model.wineSpendings ?? 0);
        const headerData = {
            currentResources:    model.currentResources,
            maxResources:        model.maxResources,
            freeTransporters:    model.freeTransporters,
            maxTransporters:     model.maxTransporters,
            wineSpendings:       ws,
            _tavernWineLevel:    ws <= 0 ? 0 : WINE_USE.findIndex(v => v >= ws),  // derivado, não vem do server
            producedTradegood:   model.producedTradegood,
            resourceProduction:  model.resourceProduction, // /s — raw
            tradegoodProduction: model.tradegoodProduction, // /s — raw
            woodPerHour:         Math.floor((model.resourceProduction ?? 0) * 3600),
            tradegoodPerHour:    Math.floor((model.tradegoodProduction ?? 0) * 3600),
            income:              model.income,
            maxActionPoints:     model.maxActionPoints,
        };
        if (model.currentResources) {
            this._events.emit(this._events.E.DC_HEADER_DATA, {
                headerData,
                cityId,
                token: this._lastToken,
                url: 'model',
            });
        }

        // Screen data — cidade ativa completa (model.city)
        const cityData = model.city;
        const islandId = this._toPositiveInt(cityData?.islandId);
        if (cityId && islandId) {
            this._registerCityIslandMapping(cityId, islandId);
        }
        if (cityData?.position) {
            this._events.emit(this._events.E.DC_SCREEN_DATA, {
                screenData: {
                    id:               cityId,
                    position:         cityData.position,
                    islandId:         cityData.islandId,
                    isCapital:        cityData.isCapital,
                    name:             cityData.name,
                    tavernWineLevel:  cityData.tavernWineLevel,
                    citizens:         cityData.citizens,
                    inhabitants:      cityData.inhabitants,
                    maxInhabitants:   cityData.maxInhabitants,
                    satisfaction:     cityData.satisfaction,
                    corruption:       cityData.corruption,
                    lockedPosition:   cityData.lockedPosition,
                    underConstruction: cityData.underConstruction,
                },
                cityId,
                url: 'model',
            });
        }
    }

    _toPositiveInt(v) {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
    }

    _isIslandContext(url, reqParams = null) {
        const p = reqParams ?? this._parseParams('GET', url, '');
        return p.backgroundView === 'island' || p.view === 'resource';
    }

    _getStateManager() {
        return globalThis.__ERP?.state ?? null;
    }

    _resolveMappedCityIdByIslandId(islandId) {
        const sm = this._getStateManager();
        if (!sm || typeof sm.resolveCityIdByIslandId !== 'function') return null;
        try {
            return this._toPositiveInt(sm.resolveCityIdByIslandId(islandId));
        } catch {
            return null;
        }
    }

    _registerCityIslandMapping(cityId, islandId) {
        const sm = this._getStateManager();
        if (!sm || typeof sm.registerCityIslandMapping !== 'function') return;
        try {
            sm.registerCityIslandMapping({ cityId, islandId });
        } catch {
            // best-effort: não interromper coleta em caso de erro de integração
        }
    }
}
