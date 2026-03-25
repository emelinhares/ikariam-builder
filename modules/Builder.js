// Builder.js — orquestrador principal do ikariam-builder
//
// Responsabilidades:
//   - Interceptar toda rede do jogo (XHR + fetch) → ResourceCache
//   - Loop de detecção de mudança de cidade/token (250ms, setTimeout recursivo)
//   - Dashboard refresh periódico (60s foco / 300s background)
//   - Goals heartbeat a cada 15min (setTimeout recursivo, adaptativo)
//   - Restauração de estado após reload (Port, Patrol, Goals)
//   - checkAndRebalance: wine + recursos para goals pendentes
//   - humanDelay: Box-Muller + 5% hesitação

import Game from './Game.js';
import ResourceCache from './ResourceCache.js';
import WineBalance from './WineBalance.js';
import ResourceBalance from './ResourceBalance.js';
import Port, { runPort } from './Port.js';
import Goals, { checkGoalsHeartbeat } from './Goals.js';
import Patrol from './Patrol.js';
import Audit from './Audit.js';
import Events from './Events.js';
import { humanDelay as _humanDelayBase } from './utils.js';

// ─── Constantes ───────────────────────────────────────────────────────────────

const DETECTION_INTERVAL_MS   = 250;          // loop de detecção
const GOALS_HEARTBEAT_MS      = 15 * 60 * 1000;  // heartbeat em foco
const GOALS_HEARTBEAT_BG_MS   = 30 * 60 * 1000;  // heartbeat em background
const DASHBOARD_FOCUS_MS      = 60  * 1000;   // refresh em foco
const DASHBOARD_BACKGROUND_MS = 300 * 1000;   // refresh em background

// ─── Estado interno ───────────────────────────────────────────────────────────

let _lastCityId       = null;
let _lastToken        = null;
let _detectionActive  = false;
let _goalsTimer       = null;
let _dashTimer        = null;
let _profile          = 'subtle';  // 'subtle' | 'aggressive'

// ─── Delay humanizado ─────────────────────────────────────────────────────────

/** Delay escalonado pelo perfil ativo (delega a utils.humanDelay). */
function humanDelay(minMs, maxMs) {
    return _humanDelayBase(minMs, maxMs, Builder.getProfileMultiplier());
}

// ─── Processamento de resposta de rede ────────────────────────────────────────

/**
 * Processa resposta AJAX do jogo: atualiza ResourceCache e emite evento.
 * Chamado pelo interceptor de XHR e fetch.
 */
function _handleResponse(url, rawData) {
    try {
        const parsed = Array.isArray(rawData) ? rawData : JSON.parse(rawData);
        const g = parsed.find(d => Array.isArray(d) && d[0] === 'updateGlobalData');
        if (g?.[1]) {
            ResourceCache.updateFromResponse(g[1]);
            Audit.incXhrSync();
        }
        Events.emit('network:response', { url, data: parsed });
    } catch (_) {
        // Silencia respostas não-JSON (assets, HTML, etc.)
    }
}

// ─── API pública ──────────────────────────────────────────────────────────────

const Builder = {

    // ── Interceptor de rede ────────────────────────────────────────────────

    /**
     * Instala interceptores para TODOS os XHR e fetch do jogo.
     * Deve ser chamado PRIMEIRO, antes de qualquer outro módulo fazer requests.
     * Captura respostas game-iniciadas que não passam por Game.request().
     */
    installNetworkInterceptor() {
        // ── XHR ───────────────────────────────────────────────────────────
        const OrigXHR = window.XMLHttpRequest;
        const _open   = OrigXHR.prototype.open;
        const _send   = OrigXHR.prototype.send;

        OrigXHR.prototype.open = function (method, url, ...rest) {
            this.__ib_url = typeof url === 'string' ? url : String(url);
            return _open.call(this, method, url, ...rest);
        };

        OrigXHR.prototype.send = function (body) {
            this.addEventListener('load', () => {
                try {
                    if (this.__ib_url?.includes('/index.php')) {
                        _handleResponse(this.__ib_url, this.responseText);
                    }
                } catch (_) { /* silencia */ }
            });
            return _send.call(this, body);
        };

        // ── fetch ─────────────────────────────────────────────────────────
        const _origFetch = window.fetch;
        window.fetch = async function (input, init) {
            const url = typeof input === 'string' ? input
                      : (input?.url ?? '');
            const response = await _origFetch.call(this, input, init);
            try {
                if (url.includes('/index.php')) {
                    response.clone().text()
                        .then(text => _handleResponse(url, text))
                        .catch(() => {});
                }
            } catch (_) { /* silencia */ }
            return response;
        };

        console.log('[Builder] Interceptor de rede instalado.');
    },

    // ── Detection loop ─────────────────────────────────────────────────────

    /**
     * Loop de 250ms (setTimeout recursivo) que detecta:
     *   - Mudança de cidade: emite 'city:changed' e atualiza cache
     *   - Mudança de token CSRF: sinal de nova resposta do jogo
     */
    startDetectionLoop() {
        if (_detectionActive) return;
        _detectionActive = true;

        _lastCityId = Game.getCityId();
        _lastToken  = Game.getToken();

        function _tick() {
            if (!_detectionActive) return;

            try {
                const cityId = Game.getCityId();
                const token  = Game.getToken();

                if (cityId && cityId !== _lastCityId) {
                    const prev  = _lastCityId;
                    _lastCityId = cityId;
                    ResourceCache.refresh(cityId);
                    Events.emit('city:changed', { cityId, prevCityId: prev });
                }

                if (token && token !== _lastToken) {
                    _lastToken = token;
                    // Token novo = resposta recebida: refresca cidade atual
                    if (cityId) ResourceCache.refresh(cityId);
                    Audit.incXhrSync();
                }
            } catch (e) {
                console.error('[Builder] Erro no detection loop:', e);
            }

            setTimeout(_tick, DETECTION_INTERVAL_MS);
        }

        setTimeout(_tick, DETECTION_INTERVAL_MS);
        console.log('[Builder] Detection loop iniciado (250ms).');
    },

    stopDetectionLoop() {
        _detectionActive = false;
    },

    // ── Dashboard refresh ──────────────────────────────────────────────────

    /**
     * Refresh periódico do ResourceCache para todas as cidades.
     * 60s se em foco, 300s se em background (visibilitychange).
     * Usa setTimeout recursivo — não setInterval.
     */
    startDashboardRefresh() {
        if (_dashTimer !== null) return;

        function _doRefresh() {
            try {
                if (Game.isReady()) {
                    // fetchAll faz AJAX para cada cidade → dados reais do servidor
                    ResourceCache.fetchAll().catch(e => {
                        console.warn('[Builder] fetchAll falhou, fallback local:', e);
                        for (const city of Game.getCities()) {
                            ResourceCache.refresh(city.id);
                        }
                    });
                }
            } catch (e) {
                console.error('[Builder] Erro no dashboard refresh:', e);
            }

            const delayMs = document.hidden ? DASHBOARD_BACKGROUND_MS : DASHBOARD_FOCUS_MS;
            _dashTimer    = setTimeout(_doRefresh, delayMs);
        }

        // Ao voltar para foco: cancela timeout pendente e refresca imediatamente
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                if (_dashTimer !== null) { clearTimeout(_dashTimer); _dashTimer = null; }
                _doRefresh();
            }
        });

        _doRefresh();
        console.log('[Builder] Dashboard refresh iniciado.');
    },

    // ── Goals heartbeat ────────────────────────────────────────────────────

    /**
     * Heartbeat de goals: avança construções a cada 15min (30min em background).
     * Usa setTimeout recursivo. Registra no Audit após cada ciclo.
     */
    startGoalsHeartbeat() {
        if (_goalsTimer !== null) return;

        async function _heartbeat() {
            try {
                if (Game.isReady()) {
                    Audit.recordHeartbeat();
                    await checkGoalsHeartbeat();
                    await Builder.checkAndRebalance();
                }
            } catch (e) {
                console.error('[Builder] Erro no goals heartbeat:', e);
            }

            const delayMs = document.hidden ? GOALS_HEARTBEAT_BG_MS : GOALS_HEARTBEAT_MS;
            _goalsTimer   = setTimeout(_heartbeat, delayMs);
        }

        _goalsTimer = setTimeout(_heartbeat, GOALS_HEARTBEAT_MS);
        console.log('[Builder] Goals heartbeat iniciado (15min).');
    },

    stopGoalsHeartbeat() {
        if (_goalsTimer !== null) { clearTimeout(_goalsTimer); _goalsTimer = null; }
    },

    // ── Restauração de estado após reload ──────────────────────────────────

    /**
     * Restaura o estado persistido após reload de página.
     * Sequência:
     *   1. Inicia módulos com persistência (Goals, Port, Patrol, Audit, balanços)
     *   2. Refresh inicial de todas as cidades conhecidas
     *   3. Retoma Port se estava a executar uma fila
     *   4. Retoma Patrol se estava ativo
     */
    async restoreState() {
        // 1. Inicialização paralela dos módulos
        await Promise.all([
            Goals.init(),
            Port.init(),
            Patrol.init(),
            Audit.init(),
            WineBalance.loadConfig(),
            ResourceBalance.loadConfig(),
        ]);

        // 2. Refresh inicial do model + fetch proativo via AJAX
        if (Game.isReady()) {
            for (const city of Game.getCities()) {
                ResourceCache.refresh(city.id);
            }
            // Popula recursos reais de todas as cidades (evita mostrar "—" na UI)
            ResourceCache.fetchAll().catch(e =>
                console.warn('[Builder] fetchAll no restoreState falhou:', e)
            );
        }

        // 3. Retoma Port (port_running foi salvo antes da navegação)
        if (Port.isRunning()) {
            console.log('[Builder] Retomando Port após reload...');
            await humanDelay(800, 1800);
            runPort().catch(console.error);
        }

        // 4. Retoma Patrol
        if (Patrol.isActive()) {
            console.log('[Builder] Retomando Patrol após reload...');
            await humanDelay(400, 1200);
            Patrol.start().catch(console.error);
        }

        console.log('[Builder] Estado restaurado.');
    },

    // ── Rebalanceamento ────────────────────────────────────────────────────

    /**
     * Verifica e enfileira transportes para wine e recursos de goals pendentes.
     *   1. WineBalance.check()  — cidades com vinho baixo
     *   2. ResourceBalance.checkAll()  — déficits para próximas construções
     */
    async checkAndRebalance() {
        try {
            if (WineBalance.isEnabled()) {
                WineBalance.check();
            }
        } catch (e) {
            console.error('[Builder] Erro no WineBalance.check():', e);
        }

        if (!ResourceBalance.isEnabled()) return;

        try {
            // Coleta custos reais das próximas construções pendentes por cidade
            const pendingCosts = {};
            for (const city of Game.getCities()) {
                const goal = Goals.getNextGoal(city.id);
                if (!goal || goal.position === null) continue;
                // Só busca custos para goals que estão aguardando recursos
                if (goal.status !== 'waiting_resources' && goal.status !== 'waiting') continue;

                const costs = await Game.fetchCosts(city.id, goal.position);
                if (costs && Object.keys(costs).length > 0) {
                    pendingCosts[city.id] = costs;
                }
            }

            if (Object.keys(pendingCosts).length > 0) {
                ResourceBalance.checkAll(pendingCosts);
            }
        } catch (e) {
            console.error('[Builder] Erro no ResourceBalance.checkAll():', e);
        }
    },

    // ── Perfil ─────────────────────────────────────────────────────────────

    getProfile()  { return _profile; },
    setProfile(p) { _profile = p; },

    /**
     * Multiplicador de delay:
     *   subtle     = 1.0  (padrão — comportamento conservador)
     *   aggressive = 0.5  (delays pela metade — menos humano)
     */
    getProfileMultiplier() {
        return _profile === 'aggressive' ? 0.5 : 1.0;
    },

    // ── Utilitário exposto ─────────────────────────────────────────────────

    humanDelay,
};

export default Builder;
