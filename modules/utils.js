// utils.js — utilitários partilhados entre módulos
// Zero dependências externas.

// ─── Aleatoriedade gaussiana (Box-Muller) ─────────────────────────────────────

/** Retorna número com distribuição gaussiana (normal). */
export function gaussianRandom(mean, sigma) {
    let u1, u2;
    do { u1 = Math.random(); } while (u1 === 0); // evitar log(0)
    u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * sigma;
}

/**
 * Delay humano com distribuição gaussiana, clampado em [min, max].
 * 5% de chance de hesitação extra (até 1.5× max) para maior naturalidade.
 *
 * @param {number} min        - delay mínimo em ms
 * @param {number} max        - delay máximo em ms
 * @param {number} multiplier - escala opcional (1.0 = normal)
 * @returns {Promise<void>}
 */
export function humanDelay(min, max, multiplier = 1.0) {
    const scaledMin = min * multiplier;
    const scaledMax = max * multiplier;
    const mean      = (scaledMin + scaledMax) / 2;
    const sigma     = (scaledMax - scaledMin) / 6;

    let delay;
    if (Math.random() < 0.05) {
        // Hesitação ocasional
        delay = scaledMax * (1 + Math.random() * 0.5);
    } else {
        delay = Math.max(scaledMin, Math.min(scaledMax, gaussianRandom(mean, sigma)));
    }

    return new Promise(resolve => setTimeout(resolve, delay));
}

// ─── Clonagem ─────────────────────────────────────────────────────────────────

/**
 * Clone profundo leve via JSON — adequado para snapshots de estado.
 * Não preserva: funções, Map, Set, undefined, Date (converte para string).
 */
export function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// ─── IDs únicos ───────────────────────────────────────────────────────────────

const _CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Gera ID aleatório de `size` caracteres alfanuméricos. */
export function nanoid(size = 8) {
    let id = '';
    for (let i = 0; i < size; i++) {
        id += _CHARS[Math.floor(Math.random() * _CHARS.length)];
    }
    return id;
}
