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

export class Config {
    constructor(storage) {
        this._storage = storage;
        this._data    = { ...DEFAULTS };
    }

    async init() {
        const saved = await this._storage.get('config');
        if (saved && typeof saved === 'object') {
            // Merge raso: chaves do DEFAULTS como base, sobrescreve com salvo
            this._data = { ...DEFAULTS, ...saved };
        }
    }

    /** Lê um valor de configuração. */
    get(key) {
        return this._data[key];
    }

    /** Atualiza um valor e persiste. */
    async set(key, value) {
        this._data[key] = value;
        await this._storage.set('config', this._data);
    }

    /** Atualiza múltiplos valores de uma vez e persiste. */
    async setMany(updates) {
        Object.assign(this._data, updates);
        await this._storage.set('config', this._data);
    }

    /** Retorna snapshot dos valores atuais (para debug/UI). */
    getAll() {
        return { ...this._data };
    }
}
