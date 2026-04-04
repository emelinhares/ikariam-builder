// Config.js — configurações do sistema, persistidas no Storage
// Centraliza todos os parâmetros ajustáveis. Inicializa com DEFAULTS e sobrescreve
// com o que estiver salvo no Storage.

const DEFAULTS = Object.freeze({
    // ── Modo de operação ──────────────────────────────────────────────────────
    // 'FULL-AUTO' : executa tudo automaticamente
    // 'SEMI'      : executa, mas pede confirmação em ações de alto impacto
    // 'MANUAL'    : suspende execução — usuário dispara manualmente via UI
    // 'SAFE'      : só executa se a cidade tem confiança HIGH (dados < 60s)
    operationMode: 'FULL-AUTO',

    // ── CFO ───────────────────────────────────────────────────────────────────
    roiThreshold:              2.0,    // ROI mínimo para aprovar construção (×)
    goldProjectionHours:       12,     // janela de projeção de ouro (horas)
    workerOptimizationEnabled: false,  // desabilitado até endpoint de mercado confirmado

    // ── COO ───────────────────────────────────────────────────────────────────
    transportMinLoadFactor:    0.9,    // fator mínimo de carga (90%)
    transportSafetyBufferS:    300,    // margem de segurança JIT (5 min)
    hubRefreshIntervalMs:      900_000,// recalcular hub a cada 15 min
    minStockFraction:          0.20,   // mínimo proativo por recurso = 20% da capacidade
    producerSafetyStockMultiplier: 1.35, // produtor mantém buffer maior para evitar drenagem burra
    overflowThresholdPct:       0.95,   // gatilho clássico de overflow por %
    overflowTimeToCapHours:     2,      // gatilho antecipado por tempo até cap
    overflowTargetTimeToCapHours: 6,    // alvo de alívio após envio de overflow

    // ── HR ────────────────────────────────────────────────────────────────────
    wineEmergencyHours:        4,      // alerta P0 se vinho restante < X horas
    wineTargetSatisfaction:    1,      // satisfação alvo (+1)

    // ── CSO ───────────────────────────────────────────────────────────────────
    capitalRiskThreshold:      40_000, // ouro exposto que aciona dispersão (~1 navio)
    noiseFrequencyMin:         8,      // 1 ação de ruído a cada 8–15 ações reais
    noiseFrequencyMax:         15,

    // ── Timing ───────────────────────────────────────────────────────────────
    heartbeatFocusMs:          60_000, // intervalo heartbeat com aba em foco
    heartbeatBackgroundMs:     300_000,// intervalo heartbeat com aba em background
    humanDelayMinMs:           800,    // delay mínimo entre ações (ms)
    humanDelayMaxMs:           2500,   // delay máximo entre ações (ms)
    plannerWakeLeadMs:         5 * 60_000,
    plannerWakeMinIntervalMs:  2 * 60_000,
    taskQueueTickFocusMs:      1_000,
    taskQueueTickBackgroundMs: 5_000,

    // ── Mercado ───────────────────────────────────────────────────────────────
    maxBuyPrice: {
        wood: Infinity, wine: Infinity, marble: Infinity,
        glass: Infinity, sulfur: Infinity,
    },
    maxMarketDistanceIslands:  10,

    // ── Logística ─────────────────────────────────────────────────────────────
    worldSpeedConst:           1200,   // medido: BAD C→BAD V=1h12m7s(4327s)/√13=1200 | BAD C→BAD M=44m44s(2684s)/√5=1200
    sameIslandTravelS:         600,    // medido: BAD M→BAD M2 = 10min = 600s
    departureFixedS:           0,      // sem tempo fixo neste mundo — fórmula é apenas D×1200
});

const VALIDATORS = Object.freeze({
    operationMode: (v) => ['FULL-AUTO', 'SEMI', 'MANUAL', 'SAFE'].includes(v),
    minStockFraction: (v) => Number.isFinite(v) && v >= 0 && v <= 1,
    transportMinLoadFactor: (v) => Number.isFinite(v) && v >= 0 && v <= 1,
    producerSafetyStockMultiplier: (v) => Number.isFinite(v) && v >= 1,
    overflowThresholdPct: (v) => Number.isFinite(v) && v > 0 && v <= 1,
    overflowTimeToCapHours: (v) => Number.isFinite(v) && v > 0,
    overflowTargetTimeToCapHours: (v) => Number.isFinite(v) && v > 0,
    plannerWakeLeadMs: (v) => Number.isFinite(v) && v >= 1_000,
    plannerWakeMinIntervalMs: (v) => Number.isFinite(v) && v >= 1_000,
    taskQueueTickFocusMs: (v) => Number.isFinite(v) && v >= 250,
    taskQueueTickBackgroundMs: (v) => Number.isFinite(v) && v >= 250,
    noiseFrequencyMin: (v) => Number.isFinite(v) && v >= 1,
    noiseFrequencyMax: (v) => Number.isFinite(v) && v >= 2,
    maxBuyPrice: (v) => {
        if (!v || typeof v !== 'object') return false;
        const keys = ['wood', 'wine', 'marble', 'glass', 'sulfur'];
        return keys.every((k) => Number.isFinite(v[k]) || v[k] === Infinity);
    },
});

function deepMerge(base, incoming) {
    const out = { ...base };
    for (const [k, v] of Object.entries(incoming ?? {})) {
        if (v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])) {
            out[k] = deepMerge(base[k], v);
        } else {
            out[k] = v;
        }
    }
    return out;
}

export class Config {
    constructor(storage) {
        this._storage = storage;
        this._data    = { ...DEFAULTS };
    }

    async init() {
        const saved = await this._storage.get('config');
        if (saved && typeof saved === 'object') {
            this._data = deepMerge(DEFAULTS, saved);
        }
    }

    /** Lê um valor de configuração. */
    get(key) {
        return this._data[key];
    }

    /** Atualiza um valor e persiste. */
    async set(key, value) {
        const validator = VALIDATORS[key];
        if (validator && !validator(value)) {
            throw new TypeError(`Config inválida para '${key}'`);
        }
        this._data[key] = value;
        await this._storage.set('config', this._data);
    }

    /** Atualiza múltiplos valores de uma vez e persiste. */
    async setMany(updates) {
        for (const [k, v] of Object.entries(updates ?? {})) {
            const validator = VALIDATORS[k];
            if (validator && !validator(v)) {
                throw new TypeError(`Config inválida para '${k}'`);
            }
        }
        Object.assign(this._data, updates);
        await this._storage.set('config', this._data);
    }

    /** Retorna snapshot dos valores atuais (para debug/UI). */
    getAll() {
        return { ...this._data };
    }
}
