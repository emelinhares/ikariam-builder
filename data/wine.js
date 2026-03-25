// wine.js — consumo de vinho por nível de taberna
// Fonte: IKAEASY_FULL/js/const.js (versão 3.1.0.24)
// Índices 0–48 (49 valores): índice = nível da taberna

export const WINE_USE = Object.freeze([
    0, 4, 8, 13, 18, 24, 30, 37, 44, 51,
    60, 68, 78, 88, 99, 110, 122, 136, 150, 165,
    180, 197, 216, 235, 255, 277, 300, 325, 351, 378,
    408, 439, 472, 507, 544, 584, 626, 670, 717, 766,
    818, 874, 933, 995, 1060, 1129, 1202, 1280, 1362,
]);

/**
 * Retorna o nível mínimo de taberna cujo consumo >= wineSpendings.
 * Retorna 0 se wineSpendings <= 0.
 * Retorna -1 se wineSpendings > WINE_USE[48] = 1362 (incobrível pela taberna).
 * Chamador deve tratar retorno -1 como emergência.
 */
export function getMinWineLevel(wineSpendings) {
    if (wineSpendings <= 0) return 0;
    const idx = WINE_USE.findIndex(v => v >= wineSpendings);
    return idx; // -1 se não encontrado
}
