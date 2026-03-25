// rec-panel.js — painel de captura total
// Exibe NET, VIEW, CLICK, DOM, CONSOLE, ERROR, MODEL, STORAGE

export function initRecPanel({ events, dc }) {
    const E = events.E;

    const host = document.createElement('div');
    host.id = 'erp-rec-host';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
#panel {
    position: fixed; top: 60px; right: 16px;
    width: 520px; max-height: 92vh;
    background: #0d1117; border: 1px solid #30363d; border-radius: 8px;
    font-family: 'Consolas','Courier New',monospace; font-size: 12px; color: #e6edf3;
    z-index: 999999; display: flex; flex-direction: column;
    box-shadow: 0 8px 24px rgba(0,0,0,.7); user-select: none;
}
#header {
    background: #161b22; border-bottom: 1px solid #30363d;
    padding: 7px 12px; display: flex; align-items: center; gap: 8px;
    cursor: move; border-radius: 8px 8px 0 0; flex-shrink: 0;
}
#title { font-weight: bold; font-size: 13px; color: #58a6ff; flex: 1; letter-spacing: .5px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #3fb950; flex-shrink: 0; }
.dot.off  { background: #6e7681; }
.dot.rec  { background: #f85149; animation: blink 1s infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
#toolbar {
    padding: 6px 12px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
    border-bottom: 1px solid #21262d; flex-shrink: 0; background: #0d1117;
}
button {
    background: #21262d; color: #e6edf3; border: 1px solid #30363d;
    border-radius: 4px; padding: 3px 9px; font-size: 11px; cursor: pointer;
    font-family: inherit; white-space: nowrap;
}
button:hover { background: #30363d; }
button.active-rec { background: #3d1a1a; border-color: #f85149; color: #f85149; font-weight: bold; }
#filter-row {
    padding: 4px 12px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
    border-bottom: 1px solid #21262d; flex-shrink: 0; background: #0d1117;
}
.cat-btn {
    font-size: 10px; padding: 2px 6px; border-radius: 3px;
    background: #21262d; border-color: #30363d; opacity: .6;
}
.cat-btn.on { opacity: 1; font-weight: bold; }
.cat-btn[data-cat="NET"]     { border-color: #388bfd; color: #388bfd; }
.cat-btn[data-cat="VIEW"]    { border-color: #a5d6ff; color: #a5d6ff; }
.cat-btn[data-cat="CLICK"]   { border-color: #ffa657; color: #ffa657; }
.cat-btn[data-cat="DOM"]     { border-color: #d2a8ff; color: #d2a8ff; }
.cat-btn[data-cat="CONSOLE"] { border-color: #8b949e; color: #8b949e; }
.cat-btn[data-cat="ERROR"]   { border-color: #f85149; color: #f85149; }
.cat-btn[data-cat="MODEL"]   { border-color: #3fb950; color: #3fb950; }
.cat-btn[data-cat="STORAGE"] { border-color: #e3b341; color: #e3b341; }
#log-area { flex: 1; overflow-y: auto; padding: 6px 12px; min-height: 200px; }
.entry { border-bottom: 1px solid #161b22; padding: 4px 0; user-select: text; }
.entry:last-child { border-bottom: none; }
.e-hdr { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
.e-seq { color: #484f58; width: 32px; flex-shrink: 0; font-size: 10px; }
.e-ts  { color: #484f58; font-size: 10px; flex-shrink: 0; }
.e-cat { font-size: 10px; font-weight: bold; padding: 1px 4px; border-radius: 2px; flex-shrink: 0; }
.e-cat-NET     { background:#0d2044; color:#388bfd; }
.e-cat-VIEW    { background:#0d2044; color:#a5d6ff; }
.e-cat-CLICK   { background:#2d1a00; color:#ffa657; }
.e-cat-DOM     { background:#1a0d2d; color:#d2a8ff; }
.e-cat-CONSOLE { background:#1c1c1c; color:#8b949e; }
.e-cat-ERROR   { background:#3d0f0a; color:#f85149; }
.e-cat-MODEL   { background:#0d2a0d; color:#3fb950; }
.e-cat-STORAGE { background:#2a1f00; color:#e3b341; }
.e-main { color: #e6edf3; flex: 1; word-break: break-word; }
.e-sub  { color: #8b949e; font-size: 11px; padding-left: 72px; word-break: break-all; margin-top: 2px; }
.e-sub.green  { color: #3fb950; }
.e-sub.yellow { color: #e3b341; }
.e-sub.blue   { color: #a5d6ff; }
.e-sub.orange { color: #ffa657; }
.e-html-toggle { cursor: pointer; color: #58a6ff; font-size: 10px; padding-left: 72px; }
.e-html-toggle:hover { text-decoration: underline; }
.e-html-block { display: none; padding-left: 72px; white-space: pre-wrap; word-break: break-all;
    font-size: 10px; color: #6e7681; max-height: 300px; overflow-y: auto;
    background: #010409; border: 1px solid #21262d; border-radius: 3px; margin-top: 2px; padding: 4px; }
.e-html-block.open { display: block; }
#counter { margin-left: auto; color: #6e7681; font-size: 11px; white-space: nowrap; }
#counter span { color: #58a6ff; font-weight: bold; }
#statusbar {
    background: #161b22; border-top: 1px solid #30363d;
    padding: 4px 12px; font-size: 10px; color: #6e7681;
    border-radius: 0 0 8px 8px; flex-shrink: 0;
}
#min-btn { background: none; border: none; color: #8b949e; font-size: 14px; padding: 0 4px; cursor: pointer; }
#min-btn:hover { color: #e6edf3; }
.hidden { display: none !important; }
</style>
<div id="panel">
  <div id="header">
    <div class="dot rec" id="dot"></div>
    <div id="title">⬡ IKARIAM CAPTURE</div>
    <div id="counter">Capturas: <span id="count">0</span></div>
    <button id="min-btn" title="Minimizar">—</button>
  </div>
  <div id="toolbar">
    <button id="btn-toggle" class="active-rec">⏹ Parar</button>
    <button id="btn-export">⬇ Export .txt</button>
    <button id="btn-copy">📋 Copiar</button>
    <button id="btn-clear">🗑 Limpar</button>
    <button id="btn-bottom">⬇ Fim</button>
  </div>
  <div id="filter-row">
    <span style="color:#6e7681;font-size:10px;">Filtro:</span>
    <button class="cat-btn on" data-cat="NET">NET</button>
    <button class="cat-btn on" data-cat="VIEW">VIEW</button>
    <button class="cat-btn on" data-cat="CLICK">CLICK</button>
    <button class="cat-btn on" data-cat="DOM">DOM</button>
    <button class="cat-btn on" data-cat="CONSOLE">CONSOLE</button>
    <button class="cat-btn on" data-cat="ERROR">ERROR</button>
    <button class="cat-btn on" data-cat="MODEL">MODEL</button>
    <button class="cat-btn on" data-cat="STORAGE">STORAGE</button>
    <button id="btn-all" style="font-size:10px;padding:2px 6px;margin-left:4px;">Todos</button>
    <button id="btn-none" style="font-size:10px;padding:2px 6px;">Nenhum</button>
  </div>
  <div id="log-area"></div>
  <div id="statusbar">⏺ Capturando — navegue normalmente. <span id="sb-extra"></span></div>
</div>`;

    const panel    = shadow.getElementById('panel');
    const dot      = shadow.getElementById('dot');
    const countEl  = shadow.getElementById('count');
    const logArea  = shadow.getElementById('log-area');
    const toolbar  = shadow.getElementById('toolbar');
    const filterRow = shadow.getElementById('filter-row');
    const sbExtra  = shadow.getElementById('sb-extra');
    const btnToggle = shadow.getElementById('btn-toggle');
    const btnExport = shadow.getElementById('btn-export');
    const btnCopy   = shadow.getElementById('btn-copy');
    const btnClear  = shadow.getElementById('btn-clear');
    const btnBottom = shadow.getElementById('btn-bottom');
    const minBtn    = shadow.getElementById('min-btn');

    let recActive  = dc.isRecMode(); // sincronizar com estado restaurado do localStorage
    let autoScroll = true;
    let minimized  = false;

    // ── REC toggle UI (declarado antes do uso abaixo) ─────────────────────────
    function applyRecUI() {
        btnToggle.textContent = recActive ? '⏹ Parar' : '⏺ Iniciar REC';
        btnToggle.classList.toggle('active-rec', recActive);
        dot.className = 'dot ' + (recActive ? 'rec' : 'off');
        shadow.getElementById('statusbar').textContent = recActive
            ? '⏺ Capturando — navegue normalmente no jogo'
            : '⏸ Pausado';
    }

    // Aplicar estado visual inicial (pode ter sido restaurado do localStorage)
    applyRecUI();

    // Quais categorias mostrar
    const visible = new Set(['NET','VIEW','CLICK','DOM','CONSOLE','ERROR','MODEL','STORAGE']);

    // ── Drag ─────────────────────────────────────────────────────────────────
    const header = shadow.getElementById('header');
    let dragging = false, ox = 0, oy = 0;
    header.addEventListener('mousedown', e => {
        if (e.target.tagName === 'BUTTON') return;
        dragging = true;
        const r = panel.getBoundingClientRect();
        ox = e.clientX - r.left; oy = e.clientY - r.top;
        e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        panel.style.left  = `${e.clientX - ox}px`;
        panel.style.top   = `${e.clientY - oy}px`;
        panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    // ── Minimizar ─────────────────────────────────────────────────────────────
    minBtn.addEventListener('click', () => {
        minimized = !minimized;
        toolbar.classList.toggle('hidden', minimized);
        filterRow.classList.toggle('hidden', minimized);
        logArea.classList.toggle('hidden', minimized);
        minBtn.textContent = minimized ? '□' : '—';
    });

    // ── REC toggle ────────────────────────────────────────────────────────────
    btnToggle.addEventListener('click', () => {
        recActive = !recActive;
        dc.setRecMode(recActive);
        applyRecUI();
    });

    // ── Filtros de categoria ──────────────────────────────────────────────────
    for (const btn of shadow.querySelectorAll('.cat-btn')) {
        btn.addEventListener('click', () => {
            const cat = btn.dataset.cat;
            if (visible.has(cat)) { visible.delete(cat); btn.classList.remove('on'); }
            else                  { visible.add(cat);    btn.classList.add('on');    }
            applyFilter();
        });
    }
    shadow.getElementById('btn-all').addEventListener('click', () => {
        for (const btn of shadow.querySelectorAll('.cat-btn')) { btn.classList.add('on'); visible.add(btn.dataset.cat); }
        applyFilter();
    });
    shadow.getElementById('btn-none').addEventListener('click', () => {
        for (const btn of shadow.querySelectorAll('.cat-btn')) { btn.classList.remove('on'); visible.delete(btn.dataset.cat); }
        applyFilter();
    });
    function applyFilter() {
        for (const el of logArea.querySelectorAll('.entry')) {
            el.style.display = visible.has(el.dataset.cat) ? '' : 'none';
        }
    }

    // ── Export ────────────────────────────────────────────────────────────────
    // Usa File System Access API (showSaveFilePicker) quando disponível.
    // O browser lembra o último diretório escolhido por id ('ikariam-rec') —
    // na primeira vez o usuário navega até a pasta do projeto, e nas próximas
    // o diálogo abre direto lá.
    // Fallback: download normal para a pasta Downloads.
    btnExport.addEventListener('click', async () => {
        const text      = dc.exportRecLog();
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const filename  = `rec-${timestamp}.txt`;

        if (typeof window.showSaveFilePicker === 'function') {
            try {
                const handle = await window.showSaveFilePicker({
                    id:            'ikariam-rec',    // browser lembra o último diretório para este id
                    suggestedName: filename,
                    startIn:       'documents',
                    types: [{
                        description: 'Capture REC',
                        accept: { 'text/plain': ['.txt'] },
                    }],
                });
                const writable = await handle.createWritable();
                await writable.write(text);
                await writable.close();
                btnExport.textContent = '✓ Salvo!';
                setTimeout(() => { btnExport.textContent = '⬇ Export .txt'; }, 2000);
                return;
            } catch (err) {
                if (err.name === 'AbortError') return; // usuário cancelou — não fazer nada
                // Outro erro: cair no fallback abaixo
            }
        }

        // Fallback: download para a pasta Downloads
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
        a.click();
        URL.revokeObjectURL(url);
    });

    // ── Copy ──────────────────────────────────────────────────────────────────
    btnCopy.addEventListener('click', async () => {
        const text = dc.exportRecLog();
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const ta = Object.assign(document.createElement('textarea'), {
                value: text, style: 'position:fixed;left:-9999px'
            });
            document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); ta.remove();
        }
        btnCopy.textContent = '✓ Copiado!';
        setTimeout(() => { btnCopy.textContent = '📋 Copiar'; }, 2000);
    });

    // ── Limpar ────────────────────────────────────────────────────────────────
    btnClear.addEventListener('click', () => {
        if (!confirm('Apagar todas as capturas?')) return;
        dc.clearRecLog();
        logArea.innerHTML = '';
        countEl.textContent = '0';
    });

    // ── Auto-scroll ───────────────────────────────────────────────────────────
    btnBottom.addEventListener('click', () => { logArea.scrollTop = logArea.scrollHeight; autoScroll = true; });
    logArea.addEventListener('scroll', () => {
        autoScroll = logArea.scrollHeight - logArea.scrollTop - logArea.clientHeight < 50;
    });

    // ── Render de entrada ─────────────────────────────────────────────────────
    function _esc(s) {
        return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function renderEntry(e) {
        const div = document.createElement('div');
        div.className = 'entry';
        div.dataset.cat = e.cat ?? 'NET';
        if (!visible.has(div.dataset.cat)) div.style.display = 'none';

        const t   = new Date(e.ts).toLocaleTimeString('pt-BR', { hour12: false });
        const cat = e.cat ?? 'NET';

        let inner = `<div class="e-hdr">
            <span class="e-seq">#${e.seq}</span>
            <span class="e-ts">${t}</span>
            <span class="e-cat e-cat-${cat}">${cat}</span>`;

        switch (cat) {
            case 'NET':
                inner += `<span class="e-main"><b>${_esc(e.method)}</b> ${_esc(e.action)}</span></div>`;
                if (e.reqSummary) inner += `<div class="e-sub">${_esc(e.reqSummary)}</div>`;
                if (e.commands)   inner += `<div class="e-sub green">← [${_esc(e.commands)}]${e.extras ? ' ' + _esc(e.extras) : ''}</div>`;
                if (e.viewScriptParams) inner += `<div class="e-sub blue">viewScriptParams: ${_esc(JSON.stringify(e.viewScriptParams).slice(0,200))}</div>`;
                for (const f of (e.fleets ?? [])) {
                    inner += `<div class="e-sub orange">fleet: ${_esc(f.from)} → ${_esc(f.to)} | ${f.type} ships=${f.ships} cargo=[${_esc(f.cargo)}]</div>`;
                }
                break;

            case 'VIEW': {
                inner += `<span class="e-main">📄 ${_esc(e.viewName)}</span></div>`;
                if (e.viewScriptParams) inner += `<div class="e-sub blue">viewScriptParams: ${_esc(JSON.stringify(e.viewScriptParams).slice(0,300))}</div>`;
                if (e.viewHtml) {
                    const id = `html-${e.seq}`;
                    inner += `<div class="e-html-toggle" data-target="${id}">▶ HTML (${e.viewHtml.length} chars) — clique para expandir</div>`;
                    inner += `<pre class="e-html-block" id="${id}">${_esc(e.viewHtml)}</pre>`;
                }
                break;
            }

            case 'CLICK': {
                const t2 = e.target ?? {};
                inner += `<span class="e-main">🖱 &lt;${t2.tag}&gt; ${t2.id ? '#'+_esc(t2.id) : ''} "${_esc(t2.text)}"</span></div>`;
                if (t2.classes) inner += `<div class="e-sub">.${_esc(t2.classes)}</div>`;
                if (t2.href)    inner += `<div class="e-sub blue">href: ${_esc(t2.href)}</div>`;
                if (t2.data && t2.data !== '{}') inner += `<div class="e-sub yellow">data: ${_esc(t2.data)}</div>`;
                break;
            }

            case 'DOM': {
                const m = e.mutation ?? {};
                inner += `<span class="e-main">🌐 ${_esc(m.type)} on &lt;${_esc(m.target)}&gt; +${m.added} -${m.removed}</span></div>`;
                if (m.summary) {
                    const id = `dom-${e.seq}`;
                    inner += `<div class="e-html-toggle" data-target="${id}">▶ Ver elementos adicionados</div>`;
                    inner += `<pre class="e-html-block" id="${id}">${_esc(m.summary)}</pre>`;
                }
                break;
            }

            case 'CONSOLE':
                inner += `<span class="e-main" style="color:${e.level==='error'?'#f85149':e.level==='warn'?'#e3b341':'#8b949e'}">[${e.level}] ${_esc(String(e.message??'').slice(0,200))}</span></div>`;
                break;

            case 'ERROR':
                inner += `<span class="e-main" style="color:#f85149">⛔ ${_esc(String(e.message??'').slice(0,200))}</span></div>`;
                if (e.stack) inner += `<div class="e-sub" style="color:#6e7681;font-size:10px;">${_esc(e.stack.slice(0,300))}</div>`;
                break;

            case 'MODEL':
                inner += `<span class="e-main" style="color:#3fb950">⬡ ${_esc(e.summary)}</span></div>`;
                inner += `<div class="e-sub">${_esc(JSON.stringify(e.diff).slice(0,300))}</div>`;
                break;

            case 'STORAGE':
                inner += `<span class="e-main" style="color:#e3b341">💾 [${e.storageType}] ${_esc(e.op)} <b>${_esc(e.key)}</b></span></div>`;
                if (e.value != null) inner += `<div class="e-sub">${_esc(String(e.value).slice(0,200))}</div>`;
                break;

            default:
                inner += `<span class="e-main">${_esc(JSON.stringify(e).slice(0,200))}</span></div>`;
        }

        div.innerHTML = inner;

        // Toggle para HTML expandível
        div.querySelectorAll('.e-html-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = div.querySelector(`#${btn.dataset.target}`);
                if (!target) return;
                target.classList.toggle('open');
                btn.textContent = btn.textContent.replace(/^[▶▼]/, target.classList.contains('open') ? '▼' : '▶');
            });
        });

        return div;
    }

    // ── Escutar novas capturas ────────────────────────────────────────────────
    let lastCounts = {};
    events.on(E.DC_REC_CAPTURE, ({ seq, cat }) => {
        const log   = dc.getRecLog();
        const entry = log[seq - 1];
        if (!entry) return;

        countEl.textContent = String(seq);

        // Contador por categoria na status bar
        lastCounts[cat] = (lastCounts[cat] ?? 0) + 1;
        sbExtra.textContent = Object.entries(lastCounts)
            .map(([c, n]) => `${c}:${n}`).join(' ');

        logArea.appendChild(renderEntry(entry));

        // Manter máx 1000 nodes no DOM
        while (logArea.children.length > 1000) {
            logArea.removeChild(logArea.firstChild);
        }

        if (autoScroll) logArea.scrollTop = logArea.scrollHeight;
    });

    // Restaurar capturas anteriores sobreviventes ao reload de página
    const existing = dc.getRecLog();
    if (existing.length > 0) {
        // Marcador visual de sessão restaurada
        const sep = document.createElement('div');
        sep.style.cssText = 'padding:4px 0;color:#388bfd;font-size:10px;border-bottom:1px dashed #30363d;margin:2px 0;user-select:none;';
        sep.textContent = `▲ ${existing.length} capturas restauradas do reload anterior ▲`;
        logArea.appendChild(sep);

        for (const entry of existing) {
            logArea.appendChild(renderEntry(entry));
        }
        countEl.textContent = String(existing.length);

        // Marcador de início de nova sessão
        const sep2 = document.createElement('div');
        sep2.style.cssText = 'padding:4px 0;color:#3fb950;font-size:10px;border-bottom:1px dashed #30363d;margin:2px 0;user-select:none;';
        sep2.textContent = '▼ Nova sessão ▼';
        logArea.appendChild(sep2);
    }

    if (autoScroll) logArea.scrollTop = logArea.scrollHeight;
}
