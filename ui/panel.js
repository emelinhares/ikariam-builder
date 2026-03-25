// panel.js — UI reativa do painel ERP
// Importado como módulo em inject.js — compartilha o mesmo Events singleton.
// Não acessa StateManager diretamente — apenas lê UIState via UI_STATE_UPDATED.

let _events = null;
let _config  = null;
let _root    = null;   // shadow root
let _uiState = null;   // último UIState recebido
let _activeTab = 'overview';

// Posição do drag
let _dragOffsetX = 0, _dragOffsetY = 0, _dragging = false;

// ── Inicialização ─────────────────────────────────────────────────────────────

export async function initPanel({ events, config, extUrl }) {
    _events = events;
    _config = config;

    await _injectShadow(extUrl);
    _bindEvents();

    // Recebe UIState atualizado do UIBridge
    _events.on(_events.E.UI_STATE_UPDATED, (uiState) => {
        _uiState = uiState;
        _render();
    });

    // Carregar posição salva
    _loadPosition();
}

async function _injectShadow(extUrl) {
    const host = document.createElement('div');
    host.id = 'erp-host';
    document.body.appendChild(host);

    _root = host.attachShadow({ mode: 'open' });

    // Usar extUrl passado pelo content.js (chrome.runtime.getURL não funciona em page context)
    const base    = extUrl ?? document.querySelector('script[data-ext-url]')?.dataset.extUrl ?? '';
    const cssUrl  = base + 'ui/panel.css';
    const htmlUrl = base + 'ui/panel.html';

    const [cssText, htmlText] = await Promise.all([
        fetch(cssUrl).then(r => r.text()),
        fetch(htmlUrl).then(r => r.text()),
    ]);

    const style = document.createElement('style');
    style.textContent = cssText;
    _root.appendChild(style);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = htmlText;
    _root.appendChild(wrapper);
}

// ── Bind de eventos DOM ───────────────────────────────────────────────────────

function _bindEvents() {
    const $ = (id) => _root.getElementById(id);

    // Fechar
    $('erp-close').addEventListener('click', () => {
        $('erp-panel').style.display = 'none';
    });

    // Tabs
    _root.querySelectorAll('.erp-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            _activeTab = btn.dataset.tab;
            _root.querySelectorAll('.erp-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _root.querySelectorAll('.erp-tab-content').forEach(el => {
                el.style.display = 'none';
            });
            const content = $(`tab-${_activeTab}`);
            if (content) content.style.display = '';
            // Não re-fetch dados — apenas renderizar do cache
            if (_uiState) _renderTab(_activeTab);
        });
    });

    // Modo de operação
    $('erp-mode-select').addEventListener('change', (e) => {
        _events.emit(_events.E.UI_COMMAND, { type: 'setMode', mode: e.target.value });
    });

    // Refresh forçado
    $('erp-btn-refresh').addEventListener('click', () => {
        _events.emit(_events.E.UI_COMMAND, { type: 'forceRefresh' });
    });

    // Log filters — re-render ao mudar filtros
    $('erp-log-filter-level')?.addEventListener('change', () => _renderLogs());
    $('erp-log-filter-module')?.addEventListener('change', () => _renderLogs());

    // Copiar log
    $('erp-log-copy')?.addEventListener('click', _copyLog);

    // Botões de teste
    $('erp-test-transport-btn')?.addEventListener('click', () => {
        const from     = $('erp-test-from')?.value;
        const to       = $('erp-test-to')?.value;
        const resource = $('erp-test-resource')?.value;
        const qty      = parseInt($('erp-test-qty')?.value) || 500;
        if (!from || !to || from === to) { alert('Selecione cidades diferentes.'); return; }
        _events.emit(_events.E.UI_COMMAND, { type: 'testTransport', fromCityId: from, toCityId: to, resource, qty });
    });

    $('erp-test-build-btn')?.addEventListener('click', () => {
        const cityId = $('erp-test-build-city')?.value;
        if (!cityId) { alert('Selecione uma cidade.'); return; }
        _events.emit(_events.E.UI_COMMAND, { type: 'testBuild', cityId });
    });

    $('erp-rec-btn')?.addEventListener('click', () => {
        const active = !(_uiState?.recMode ?? false);
        _events.emit(_events.E.UI_COMMAND, { type: 'setRec', active });
    });

    // Drag
    $('erp-header').addEventListener('mousedown', _onDragStart);
    document.addEventListener('mousemove', _onDragMove);
    document.addEventListener('mouseup',   () => { _dragging = false; });
}

// ── Render principal ──────────────────────────────────────────────────────────

function _render() {
    if (!_uiState) return;
    _renderStatusBar();
    _renderStatusBadge();
    _renderModeSelect();
    _renderTab(_activeTab);
}

function _renderTab(tab) {
    if (!_uiState) return;
    switch (tab) {
        case 'overview': _renderOverview(); break;
        case 'queue':    _renderQueue();    break;
        case 'cities':   _renderCities();   break;
        case 'tests':    _renderTests();    break;
        case 'logs':     _renderLogs();     break;
    }
}

// ── Status bar ────────────────────────────────────────────────────────────────

function _renderStatusBar() {
    const $ = (id) => _root.getElementById(id);
    const b = _uiState.bot;

    const statusMap = {
        RUNNING:     ['green',  'RUNNING'],
        DEGRADED:    ['red',    'DEGRADED'],
        MANUAL:      ['yellow', 'MANUAL'],
        INITIALIZING:['gray',   'INIT'],
    };
    const [color, label] = statusMap[b.status] ?? ['gray', b.status];

    const dot = $('erp-sb-dot');
    dot.className = `erp-dot ${color}`;
    $('erp-sb-status').textContent = label;

    const qCount = (_uiState.queue.pending.length ?? 0) + (_uiState.queue.inFlight.length ?? 0);
    $('erp-sb-queue').textContent = `Fila: ${qCount}`;

    $('erp-sb-sync').textContent = b.lastSync
        ? `Sync: ${_fmtAge(Date.now() - b.lastSync)}`
        : 'Nunca sincronizado';

    $('erp-sb-city').textContent = b.activeCity ? `Cidade: ${b.activeCity}` : '';
}

function _renderStatusBadge() {
    const el = _root.getElementById('erp-status-badge');
    const s  = _uiState.bot.status;
    el.textContent = s;
    el.className   = 'erp-status-badge ' + (s === 'RUNNING' ? 'running' : s === 'DEGRADED' ? 'degraded' : s === 'MANUAL' ? 'manual' : 'init');
}

function _renderModeSelect() {
    const sel = _root.getElementById('erp-mode-select');
    sel.value = _uiState.bot.mode ?? 'FULL-AUTO';
}

// ── Overview ──────────────────────────────────────────────────────────────────

function _renderOverview() {
    const $ = (id) => _root.getElementById(id);
    const s = _uiState;

    // Alertas
    const alertsEl = $('erp-alerts-container');
    alertsEl.innerHTML = '';
    for (const alert of s.alerts.slice(0, 5)) {
        alertsEl.appendChild(_renderAlert(alert));
    }

    // Próxima ação
    const na = s.nextAction;
    if (na) {
        $('erp-next-action').style.display = '';
        $('erp-next-summary').textContent  = na.summary;
        $('erp-next-reason').textContent   = na.reason ?? '';
    } else {
        $('erp-next-action').style.display = 'none';
    }

    // Status geral
    $('erp-ov-mode').textContent = s.bot.mode;
    const confEl = $('erp-ov-confidence');
    confEl.textContent  = s.bot.confidence;
    confEl.className    = `erp-confidence ${s.bot.confidence}`;
    $('erp-ov-sync').textContent   = s.bot.lastSync ? _fmtAge(Date.now() - s.bot.lastSync) : '—';
    $('erp-ov-alerts').textContent = s.bot.alertCount;

    // Badge na tab Fila
    const badge = $('erp-queue-badge');
    const total = (s.queue.pending?.length ?? 0) + (s.queue.inFlight?.length ?? 0);
    badge.textContent  = total;
    badge.style.display = total > 0 ? '' : 'none';

    // Resumo de cidades
    const citiesEl = $('erp-ov-cities');
    citiesEl.innerHTML = '';
    for (const city of s.cities) {
        const row = document.createElement('div');
        row.className = 'erp-city-row';
        row.innerHTML = `
            <span class="erp-dot ${city.health}"></span>
            <span class="erp-city-name ${city.isActive ? 'active' : ''}">${_esc(city.name)}</span>
            <span class="erp-confidence ${city.confidence}">${city.confidence}</span>
            ${city.construction ? `<span style="color:#d29922;font-size:11px;" title="${_esc(city.construction.building)} nv.${city.construction.level}→${city.construction.level + 1}${city.construction.completesAt ? ' | ' + _fmtCountdown(city.construction.completesAt) : ''}">🔨</span>` : ''}
            <span class="erp-city-age">${city.dataAgeMs != null ? _fmtAge(city.dataAgeMs) : '—'}</span>
        `;
        citiesEl.appendChild(row);
    }
    if (!s.cities.length) {
        citiesEl.innerHTML = '<div class="erp-empty">Nenhuma cidade</div>';
    }
}

// ── Queue ─────────────────────────────────────────────────────────────────────

function _renderQueue() {
    const s = _uiState;
    const active = [...(s.queue.pending ?? []), ...(s.queue.inFlight ?? [])];

    const activeEl = _root.getElementById('erp-queue-active');
    activeEl.innerHTML = '';
    if (!active.length) {
        activeEl.innerHTML = '<div class="erp-empty">Fila vazia</div>';
    } else {
        for (const task of active) {
            activeEl.appendChild(_renderTaskRow(task, true));
        }
    }

    // Frota em movimento
    const fleet = s.fleetMovements ?? [];
    let fleetEl = _root.getElementById('erp-fleet-section');
    if (!fleetEl) {
        fleetEl = document.createElement('div');
        fleetEl.id = 'erp-fleet-section';
        fleetEl.style.cssText = 'margin-top:12px;';
        activeEl.parentNode.insertBefore(fleetEl, activeEl.nextSibling);
    }
    if (fleet.length > 0) {
        fleetEl.innerHTML = `<div class="erp-section-title" style="font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">FROTA EM MOVIMENTO (${fleet.length})</div>`;
        for (const mv of fleet) {
            const row = document.createElement('div');
            row.className = 'erp-task-row';
            row.style.cssText = 'font-size:12px;opacity:0.85;';
            const arrow = mv.isReturn ? '←' : '→';
            const eta   = mv.arrivesAt ? _fmtCountdown(mv.arrivesAt) : '?';
            const cargo = mv.cargo
                ? Object.entries(mv.cargo).filter(([,v]) => v > 0).map(([k,v]) => `${k}:${_fmtNum(v)}`).join(' ')
                : '';
            const ships = mv.ships ? `${mv.ships}🚢 ` : '';
            row.innerHTML = `
                <span class="erp-task-type TRANSPORT" style="font-size:10px;padding:1px 5px;">🚢</span>
                <div class="erp-task-info">
                    <div>${_esc(mv.from)} ${arrow} ${_esc(mv.to)}</div>
                    <div class="erp-task-reason">${ships}${cargo ? cargo + ' • ' : ''}chega em ${eta}</div>
                </div>
            `;
            fleetEl.appendChild(row);
        }
    } else {
        fleetEl.innerHTML = '';
    }

    const doneEl = _root.getElementById('erp-queue-done');
    doneEl.innerHTML = '';
    const done = s.queue.completed ?? [];
    if (!done.length) {
        doneEl.innerHTML = '<div class="erp-empty">Nenhuma tarefa concluída</div>';
    } else {
        for (const task of [...done].reverse()) {
            doneEl.appendChild(_renderTaskRow(task, false));
        }
    }
}

function _renderTaskRow(task, showCancel) {
    const row = document.createElement('div');
    row.className = 'erp-task-row';

    const typeEl = document.createElement('span');
    typeEl.className = `erp-task-type ${task.type}`;
    typeEl.textContent = task.type;

    const info = document.createElement('div');
    info.className = 'erp-task-info';
    info.innerHTML = `
        <div>${_esc(task.reason ?? task.type)}</div>
        <div class="erp-task-reason">[${task.module ?? '?'}] cidade ${task.cityId} ${task.status === 'blocked' ? '⚠ bloqueado' : ''}</div>
    `;

    row.appendChild(typeEl);
    row.appendChild(info);

    if (showCancel) {
        const btn = document.createElement('button');
        btn.className = 'erp-task-cancel';
        btn.textContent = '✕';
        btn.addEventListener('click', () => {
            _events.emit(_events.E.UI_COMMAND, { type: 'cancelTask', taskId: task.id });
        });
        row.appendChild(btn);
    }

    return row;
}

// ── Cidades ───────────────────────────────────────────────────────────────────

function _renderCities() {
    const el = _root.getElementById('erp-cities-list');
    el.innerHTML = '';

    for (const city of _uiState.cities) {
        const card = document.createElement('div');
        card.className = 'erp-card';
        card.innerHTML = `
            <div class="erp-card-title">
                <span class="erp-dot ${city.health}"></span>
                ${_esc(city.name)} ${city.isCapital ? '★' : ''}
                ${city.isActive ? '<span style="color:#58a6ff;font-size:10px;">[ATIVA]</span>' : ''}
            </div>
            <div style="font-size:12px;display:grid;grid-template-columns:repeat(3,1fr);gap:4px 12px;">
                <span>🪵 ${_fmtNum(city.resources?.wood)}</span>
                <span>🍷 ${_fmtNum(city.resources?.wine)}</span>
                <span>🪨 ${_fmtNum(city.resources?.marble)}</span>
                <span>💎 ${_fmtNum(city.resources?.glass)}</span>
                <span>💥 ${_fmtNum(city.resources?.sulfur)}</span>
                <span>🚢 ${city.freeTransporters ?? '—'}</span>
            </div>
            <div style="font-size:11px;color:#8b949e;margin-top:5px;display:flex;gap:12px;">
                <span>Gold/h: ${city.goldPerHour >= 0 ? '+' : ''}${_fmtNum(city.goldPerHour)}</span>
                <span>Corrupção: ${city.corruption ? (city.corruption * 100).toFixed(0) + '%' : '0%'}</span>
                <span>Conf: <span class="erp-confidence ${city.confidence}">${city.confidence}</span></span>
                ${city.construction ? `<span style="color:#d29922;">🔨 ${_esc(city.construction.building)} nv.${city.construction.level}→${city.construction.level + 1}${city.construction.completesAt ? ' (' + _fmtCountdown(city.construction.completesAt) + ')' : ''}</span>` : ''}
            </div>
        `;
        el.appendChild(card);
    }

    if (!_uiState.cities.length) {
        el.innerHTML = '<div class="erp-empty">Nenhuma cidade carregada</div>';
    }
}

// ── Testes ─────────────────────────────────────────────────────────────────────

function _renderTests() {
    const $ = (id) => _root.getElementById(id);
    const cities  = _uiState?.cities ?? [];
    const recMode = _uiState?.recMode ?? false;

    // Atualizar botão e status REC
    const recBtn    = $('erp-rec-btn');
    const recStatus = $('erp-rec-status');
    if (recBtn) {
        recBtn.textContent = recMode ? '⏹ Parar REC' : '⏺ Iniciar REC';
        recBtn.style.background = recMode ? '#4d1a1a' : '';
        recBtn.style.borderColor = recMode ? '#f85149' : '';
        recBtn.style.color       = recMode ? '#f85149' : '';
    }
    if (recStatus) recStatus.style.display = recMode ? '' : 'none';

    // Popular selects de cidade (preservar seleção atual)
    const _populateSelect = (selId, selected) => {
        const sel = $(selId);
        if (!sel) return;
        const prev = sel.value || selected;
        sel.innerHTML = cities.map(c =>
            `<option value="${c.id}" ${String(c.id) === String(prev) ? 'selected' : ''}>${c.name}</option>`
        ).join('');
    };
    _populateSelect('erp-test-from');
    _populateSelect('erp-test-to');
    _populateSelect('erp-test-build-city');

    // Relatório
    const result   = _uiState?.testResult;
    const card     = $('erp-test-report-card');
    const reportEl = $('erp-test-report');
    if (!card || !reportEl) return;

    if (!result) { card.style.display = 'none'; return; }
    card.style.display = '';

    const statusColor = { done: '#3fb950', failed: '#f85149', pending: '#d29922', error: '#f85149' };
    const statusLabel = { done: '✓ SUCESSO', failed: '✗ FALHOU', pending: '⌛ EXECUTANDO...', error: '⚠ ERRO' };
    const color = statusColor[result.status] ?? '#8b949e';
    const label = statusLabel[result.status] ?? result.status;
    const elapsed = result.elapsedMs ? ` — ${(result.elapsedMs / 1000).toFixed(1)}s` : '';

    reportEl.innerHTML = `
        <div style="color:${color};font-weight:bold;margin-bottom:6px;">${label}${elapsed}</div>
        <div style="color:#e6edf3;margin-bottom:4px;">${result.summary ?? ''}</div>
        ${result.id ? `<div style="color:#8b949e;font-size:11px;">Task: ${result.id}</div>` : ''}
        ${result.error ? `<div style="color:#f85149;margin-top:6px;font-size:11px;">Erro: ${result.error}</div>` : ''}
        ${result.status === 'done' ? `<div style="color:#3fb950;margin-top:6px;font-size:11px;">✓ Ação confirmada pelo servidor. Verifique o jogo e o log para confirmar.</div>` : ''}
    `;
}

// ── Logs ──────────────────────────────────────────────────────────────────────

function _renderLogs() {
    if (!_uiState) return;
    const levelFilter  = _root.getElementById('erp-log-filter-level')?.value  ?? '';
    const moduleFilter = _root.getElementById('erp-log-filter-module')?.value ?? '';

    let entries = _uiState.logs ?? [];
    if (levelFilter)  entries = entries.filter(e => e.level  === levelFilter);
    if (moduleFilter) entries = entries.filter(e => e.module === moduleFilter);

    const container = _root.getElementById('erp-log-container');
    container.innerHTML = '';

    for (const entry of [...entries].reverse().slice(0, 200)) {
        const row = document.createElement('div');
        row.className = `erp-log-entry ${entry.level}`;
        row.innerHTML = `
            <span class="erp-log-ts">${_fmtTime(entry.ts)}</span>
            <span class="erp-log-module">[${_esc(entry.module)}]</span>
            <span class="erp-log-msg">${_esc(entry.message)}</span>
        `;
        container.appendChild(row);
    }

    if (!entries.length) {
        container.innerHTML = '<div class="erp-empty">Nenhum log</div>';
    }
}

// ── Alertas ───────────────────────────────────────────────────────────────────

function _renderAlert(alert) {
    const el = document.createElement('div');
    el.className = `erp-alert ${alert.level}`;
    el.innerHTML = `
        <div class="erp-alert-msg">
            <strong>[${alert.level}]</strong> ${_esc(alert.message)}
            <div class="erp-alert-meta">${alert.module} • ${_fmtTime(alert.ts)}</div>
        </div>
        <button class="erp-alert-dismiss" data-id="${alert.id}">✕</button>
    `;
    el.querySelector('.erp-alert-dismiss').addEventListener('click', () => {
        _events.emit(_events.E.UI_COMMAND, { type: 'resolveAlert', alertId: alert.id });
    });
    return el;
}

// ── Drag ──────────────────────────────────────────────────────────────────────

function _onDragStart(e) {
    _dragging = true;
    const panel = _root.getElementById('erp-panel');
    const rect  = panel.getBoundingClientRect();
    _dragOffsetX = e.clientX - rect.left;
    _dragOffsetY = e.clientY - rect.top;
}

function _onDragMove(e) {
    if (!_dragging) return;
    const panel = _root.getElementById('erp-panel');
    const x = e.clientX - _dragOffsetX;
    const y = e.clientY - _dragOffsetY;
    panel.style.left  = `${Math.max(0, x)}px`;
    panel.style.top   = `${Math.max(0, y)}px`;
    panel.style.right = 'auto';
    _savePosition(x, y);
}

function _savePosition(x, y) {
    try { localStorage.setItem('erp_panel_pos', JSON.stringify({ x, y })); } catch {}
}

function _loadPosition() {
    try {
        const saved = JSON.parse(localStorage.getItem('erp_panel_pos') ?? 'null');
        if (saved) {
            const panel = _root.getElementById('erp-panel');
            panel.style.left  = `${saved.x}px`;
            panel.style.top   = `${saved.y}px`;
            panel.style.right = 'auto';
        }
    } catch {}
}

// ── Copiar log ────────────────────────────────────────────────────────────────

function _copyLog() {
    if (!_uiState) return;

    const levelFilter  = _root.getElementById('erp-log-filter-level')?.value  ?? '';
    const moduleFilter = _root.getElementById('erp-log-filter-module')?.value ?? '';

    let entries = _uiState.logs ?? [];
    if (levelFilter)  entries = entries.filter(e => e.level  === levelFilter);
    if (moduleFilter) entries = entries.filter(e => e.module === moduleFilter);

    const text = [...entries].reverse().map(e =>
        `${_fmtTime(e.ts)} [${e.level.toUpperCase()}] [${e.module}] ${e.message}`
    ).join('\n');

    navigator.clipboard.writeText(text).then(() => {
        const btn = _root.getElementById('erp-log-copy');
        if (!btn) return;
        const prev = btn.textContent;
        btn.textContent = '✓ Copiado!';
        setTimeout(() => { btn.textContent = prev; }, 1500);
    }).catch(() => {
        // Fallback: criar textarea temporário dentro do shadow DOM não funciona com
        // document.execCommand fora do contexto — alertar o usuário
        const btn = _root.getElementById('erp-log-copy');
        if (btn) { btn.textContent = '✗ Erro'; setTimeout(() => { btn.textContent = '📋 Copiar'; }, 1500); }
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _fmtNum(n) {
    if (n == null) return '—';
    return Number(n).toLocaleString('pt-BR');
}

function _fmtAge(ms) {
    if (!ms) return '0s';
    const s = Math.floor(ms / 1000);
    if (s < 60)   return `${s}s`;
    if (s < 3600) return `${Math.floor(s/60)}m`;
    return `${Math.floor(s/3600)}h`;
}

function _fmtCountdown(tsMs) {
    const diff = tsMs - Date.now();
    if (diff <= 0) return 'concluído';
    const s = Math.floor(diff / 1000);
    if (s < 60)   return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2,'0')}s`;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h${String(m).padStart(2,'0')}m`;
}

function _fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
