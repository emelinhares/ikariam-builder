// effects.js — efeitos por nível de cada edifício
//
// Fonte: wiki in-game (janela de Ajuda), coletado manualmente em 2026-03-18.
// Apenas edifícios com efeito numérico relevante para o ERP são listados.
//
// Convenção:
//   Tabelas são 1-based (índice 0 = null).
//   Valores com "(extrap)" nos comentários foram extrapolados pela progressão;
//   os demais foram confirmados diretamente via wiki in-game.

// ─── Câmara Municipal ─────────────────────────────────────────────────────────
// maxCitizens: espaço habitacional máximo da cidade
// Níveis 1–14: extrapolados pela progressão observada (Δ ~120/nível nos primeiros níveis)
// Níveis 15–64: confirmados via wiki
const TOWN_HALL_MAX_CITIZENS = [
    null,
    60,    // 1  (extrap)
    120,   // 2  (extrap)
    180,   // 3  (extrap)
    240,   // 4  (extrap)
    300,   // 5  (extrap)
    360,   // 6  (extrap)
    420,   // 7  (extrap)
    480,   // 8  (extrap)
    540,   // 9  (extrap)
    600,   // 10 (extrap)
    720,   // 11 (extrap)
    840,   // 12 (extrap)
    960,   // 13 (extrap)
    1080,  // 14 (extrap)
    1200,  // 15 ← wiki
    1320,  // 16
    1440,  // 17
    1566,  // 18
    1696,  // 19
    1828,  // 20
    1964,  // 21
    2102,  // 22
    2246,  // 23
    2390,  // 24
    2540,  // 25
    2690,  // 26
    2844,  // 27
    3002,  // 28
    3162,  // 29
    3326,  // 30
    3492,  // 31
    3660,  // 32
    3830,  // 33
    4004,  // 34
    4180,  // 35
    4360,  // 36
    4540,  // 37
    4724,  // 38
    4910,  // 39
    5098,  // 40
    5290,  // 41
    5482,  // 42
    5678,  // 43
    5876,  // 44
    6076,  // 45
    6278,  // 46
    6484,  // 47
    6690,  // 48
    6900,  // 49
    7110,  // 50
    7324,  // 51
    7538,  // 52
    7756,  // 53
    7976,  // 54
    8196,  // 55
    8420,  // 56
    8646,  // 57
    8874,  // 58
    9102,  // 59
    9334,  // 60
    9568,  // 61
    9802,  // 62
    10040, // 63
    10280, // 64
];

// ─── Academia ─────────────────────────────────────────────────────────────────
// maxScientists: número máximo de cientistas alocáveis
// Níveis 1–14: extrapolados (~12/nível)
// Níveis 15–64: confirmados via wiki
const ACADEMY_MAX_SCIENTISTS = [
    null,
    12,   // 1  (extrap)
    24,   // 2  (extrap)
    36,   // 3  (extrap)
    48,   // 4  (extrap)
    60,   // 5  (extrap)
    72,   // 6  (extrap)
    84,   // 7  (extrap)
    96,   // 8  (extrap)
    98,   // 9  (extrap)
    100,  // 10 (extrap)
    104,  // 11 (extrap)
    110,  // 12 (extrap)
    116,  // 13 (extrap)
    122,  // 14 (extrap)
    122,  // 15 ← wiki
    134,  // 16
    146,  // 17
    158,  // 18
    171,  // 19
    184,  // 20
    198,  // 21
    212,  // 22
    226,  // 23
    241,  // 24
    256,  // 25
    271,  // 26
    286,  // 27
    302,  // 28
    318,  // 29
    334,  // 30
    351,  // 31
    368,  // 32
    385,  // 33
    402,  // 34
    420,  // 35
    438,  // 36
    456,  // 37
    474,  // 38
    493,  // 39
    511,  // 40
    531,  // 41
    550,  // 42
    569,  // 43
    589,  // 44
    609,  // 45
    629,  // 46
    650,  // 47
    671,  // 48
    692,  // 49
    713,  // 50
    734,  // 51
    755,  // 52
    777,  // 53
    799,  // 54
    821,  // 55
    844,  // 56
    866,  // 57
    889,  // 58
    912,  // 59
    935,  // 60
    958,  // 61
    982,  // 62
    1006, // 63
    1030, // 64
];

// ─── Armazém ──────────────────────────────────────────────────────────────────
// capacity: capacidade máxima de armazenamento por recurso
// Confirmado via wiki in-game (NÃO é fórmula linear — ver valores reais)
// safeCapacity (não saqueável) = 100 + 480 × level  (fórmula confirmada via IKAEASY)
const WAREHOUSE_CAPACITY = [
    null,
    8000,     // 1
    16401,    // 2
    25454,    // 3
    35330,    // 4
    46181,    // 5
    58158,    // 6
    71420,    // 7
    86137,    // 8
    102492,   // 9
    120687,   // 10
    140942,   // 11
    163502,   // 12
    188637,   // 13
    216645,   // 14
    247859,   // 15
    282646,   // 16
    321416,   // 17
    364622,   // 18
    412768,   // 19
    466416,   // 20
    526188,   // 21
    592779,   // 22
    666958,   // 23
    749584,   // 24
    841608,   // 25
    944094,   // 26
    1060000,  // 27
    1190000,  // 28
    1330000,  // 29
    1480000,  // 30
    1660000,  // 31
    1850000,  // 32
    2070000,  // 33
    2310000,  // 34
    2580000,  // 35
    2880000,  // 36
    3220000,  // 37
    3590000,  // 38
    4000000,  // 39
    4460000,  // 40
    4970000,  // 41
    5540000,  // 42
    6180000,  // 43
    6880000,  // 44
    7670000,  // 45
    8540000,  // 46
    9520000,  // 47
    10600000, // 48
    11810000, // 49
    13150000, // 50
];

// ─── Depósito (dump) ──────────────────────────────────────────────────────────
// capacity: capacidade NÃO protegida (saqueável)
// Confirmado via wiki in-game, níveis 1–50
const DUMP_CAPACITY = [
    null,
    32000,    // 1
    65401,    // 2
    101073,   // 3
    139584,   // 4
    181437,   // 5
    227118,   // 6
    277128,   // 7
    331990,   // 8
    392267,   // 9
    458564,   // 10
    531535,   // 11
    611896,   // 12
    700427,   // 13
    797982,   // 14
    905498,   // 15
    1020000,  // 16
    1150000,  // 17
    1300000,  // 18
    1460000,  // 19
    1630000,  // 20
    1820000,  // 21
    2040000,  // 22
    2270000,  // 23
    2530000,  // 24
    2810000,  // 25
    3130000,  // 26
    3470000,  // 27
    3850000,  // 28
    4270000,  // 29
    4730000,  // 30
    5230000,  // 31
    5790000,  // 32
    6410000,  // 33
    7080000,  // 34
    7830000,  // 35
    8650000,  // 36
    9550000,  // 37
    10540000, // 38
    11640000, // 39
    12840000, // 40
    14160000, // 41
    15620000, // 42
    17220000, // 43
    18990000, // 44
    20930000, // 45
    23070000, // 46
    25420000, // 47
    28010000, // 48
    30860000, // 49
    34000000, // 50
];

// ─── Taberna ──────────────────────────────────────────────────────────────────
// maxWine: consumo máximo de vinho que a taberna suporta (unidades/hora)
// Níveis 1–12: extrapolados
// Níveis 13–62: confirmados via wiki
const TAVERN_MAX_WINE = [
    null,
    6,    // 1  (extrap)
    12,   // 2  (extrap)
    20,   // 3  (extrap)
    30,   // 4  (extrap)
    42,   // 5  (extrap)
    55,   // 6  (extrap)
    65,   // 7  (extrap)
    73,   // 8  (extrap)
    79,   // 9  (extrap)
    84,   // 10 (extrap)
    86,   // 11 (extrap)
    87,   // 12 (extrap)
    88,   // 13 ← wiki
    99,   // 14
    111,  // 15
    123,  // 16
    136,  // 17
    150,  // 18
    165,  // 19
    181,  // 20
    198,  // 21
    216,  // 22
    235,  // 23
    255,  // 24
    277,  // 25
    300,  // 26
    324,  // 27
    350,  // 28
    378,  // 29
    407,  // 30
    439,  // 31
    472,  // 32
    507,  // 33
    544,  // 34
    584,  // 35
    625,  // 36
    670,  // 37
    717,  // 38
    766,  // 39
    819,  // 40
    875,  // 41
    933,  // 42
    995,  // 43
    1061, // 44
    1130, // 45
    1202, // 46
    1279, // 47
    1360, // 48
    1445, // 49
    1534, // 50
    1628, // 51
    1726, // 52
    1830, // 53
    1938, // 54
    2052, // 55
    2172, // 56
    2297, // 57
    2428, // 58
    2565, // 59
    2708, // 60
    2858, // 61
    3015, // 62
];

// ─── Museu ────────────────────────────────────────────────────────────────────
// culturalGoods: capacidade de bens culturais (peças de arte albergadas)
// Níveis 1–2: N/A (requer pesquisa Intercâmbio Cultural)
// Níveis 3–52: confirmados via wiki. Padrão: +50/nível
const MUSEUM_CULTURAL_GOODS = [
    null,
    null, // 1
    null, // 2
    150,  // 3  ← wiki
    200,  // 4
    250,  // 5
    300,  // 6
    350,  // 7
    400,  // 8
    450,  // 9
    500,  // 10
    550,  // 11
    600,  // 12
    650,  // 13
    700,  // 14
    750,  // 15
    800,  // 16
    850,  // 17
    900,  // 18
    950,  // 19
    1000, // 20
    1050, // 21
    1100, // 22
    1150, // 23
    1200, // 24
    1250, // 25
    1300, // 26
    1350, // 27
    1400, // 28
    1450, // 29
    1500, // 30
    1550, // 31
    1600, // 32
    1650, // 33
    1700, // 34
    1750, // 35
    1800, // 36
    1850, // 37
    1900, // 38
    1950, // 39
    2000, // 40
    2050, // 41
    2100, // 42
    2150, // 43
    2200, // 44
    2250, // 45
    2300, // 46
    2350, // 47
    2400, // 48
    2450, // 49
    2500, // 50
    2550, // 51
    2600, // 52
];

// ─── Porto Mercantil ──────────────────────────────────────────────────────────
// loadingSpeed: unidades de recurso carregadas por minuto
// Níveis 1–6: extrapolados
// Níveis 7–56: confirmados via wiki
const PORT_LOADING_SPEED = [
    null,
    30,    // 1  (extrap)
    60,    // 2  (extrap)
    100,   // 3  (extrap)
    140,   // 4  (extrap)
    190,   // 5  (extrap)
    226,   // 6  (extrap)
    264,   // 7  ← wiki
    312,   // 8
    372,   // 9
    438,   // 10
    510,   // 11
    588,   // 12
    672,   // 13
    768,   // 14
    870,   // 15
    984,   // 16
    1110,  // 17
    1248,  // 18
    1398,  // 19
    1566,  // 20
    1746,  // 21
    1950,  // 22
    2172,  // 23
    2418,  // 24
    2682,  // 25
    2982,  // 26
    3306,  // 27
    3660,  // 28
    4056,  // 29
    4488,  // 30
    4962,  // 31
    5490,  // 32
    6066,  // 33
    6696,  // 34
    7392,  // 35
    8160,  // 36
    9006,  // 37
    9930,  // 38
    10950, // 39
    12072, // 40
    13308, // 41
    14664, // 42
    16158, // 43
    17802, // 44
    19608, // 45
    21600, // 46
    23784, // 47
    26190, // 48
    28836, // 49
    31746, // 50
    34950, // 51
    38466, // 52
    42342, // 53
    46602, // 54
    51294, // 55
    56448, // 56
];

// ─── Mercado (branchOffice) ───────────────────────────────────────────────────
// tradeCapacity: capacidade máxima de negociação simultânea
// Níveis 1–50: confirmados via wiki
const BRANCH_OFFICE_CAPACITY = [
    null,
    400,     // 1
    1600,    // 2
    3600,    // 3
    6400,    // 4
    10000,   // 5
    14400,   // 6
    19600,   // 7
    25600,   // 8
    32400,   // 9
    40000,   // 10
    48400,   // 11
    57600,   // 12
    67600,   // 13
    78400,   // 14
    90000,   // 15
    102400,  // 16
    115600,  // 17
    129600,  // 18
    144400,  // 19
    160000,  // 20
    176400,  // 21
    193600,  // 22
    211600,  // 23
    230400,  // 24
    250000,  // 25
    270400,  // 26
    291600,  // 27
    313600,  // 28
    336400,  // 29
    360000,  // 30
    384400,  // 31
    409600,  // 32
    435600,  // 33
    462400,  // 34
    490000,  // 35
    518400,  // 36
    547600,  // 37
    577600,  // 38
    608400,  // 39
    640000,  // 40
    672400,  // 41
    705600,  // 42
    739600,  // 43
    774400,  // 44
    810000,  // 45
    846400,  // 46
    883600,  // 47
    921600,  // 48
    960400,  // 49
    1000000, // 50
];

// ─── Embaixada ────────────────────────────────────────────────────────────────
// diplomacyPoints: pontos de diplomacia disponíveis
// Níveis 1–50: confirmados via wiki. Padrão: level + 2
const EMBASSY_DIPLOMACY_POINTS = [
    null,
    3,  // 1  ← wiki
    4,  // 2
    5,  // 3
    6,  // 4
    7,  // 5
    8,  // 6
    9,  // 7
    10, // 8
    11, // 9
    12, // 10
    13, // 11
    14, // 12
    15, // 13
    16, // 14
    17, // 15
    18, // 16
    19, // 17
    20, // 18
    21, // 19
    22, // 20
    23, // 21
    24, // 22
    25, // 23
    26, // 24
    27, // 25
    28, // 26
    29, // 27
    30, // 28
    31, // 29
    32, // 30
    33, // 31
    34, // 32
    35, // 33
    36, // 34
    37, // 35
    38, // 36
    39, // 37
    40, // 38
    41, // 39
    42, // 40
    43, // 41
    44, // 42
    45, // 43
    46, // 44
    47, // 45
    48, // 46
    49, // 47
    50, // 48
    51, // 49
    52, // 50
];

// ─── Templo ───────────────────────────────────────────────────────────────────
// maxPriests: número máximo de sacerdotes alocáveis
// Níveis 1–50: confirmados via wiki
const TEMPLE_MAX_PRIESTS = [
    null,
    12,   // 1  ← wiki
    22,   // 2
    37,   // 3
    54,   // 4
    73,   // 5
    94,   // 6
    117,  // 7
    141,  // 8
    168,  // 9
    195,  // 10
    224,  // 11
    255,  // 12
    287,  // 13
    320,  // 14
    354,  // 15
    390,  // 16
    426,  // 17
    464,  // 18
    502,  // 19
    542,  // 20
    583,  // 21
    625,  // 22
    667,  // 23
    711,  // 24
    756,  // 25
    801,  // 26
    847,  // 27
    894,  // 28
    943,  // 29
    991,  // 30
    1041, // 31
    1092, // 32
    1143, // 33
    1195, // 34
    1248, // 35
    1302, // 36
    1356, // 37
    1411, // 38
    1467, // 39
    1523, // 40
    1581, // 41
    1639, // 42
    1697, // 43
    1757, // 44
    1817, // 45
    1877, // 46
    1939, // 47
    2001, // 48
    2064, // 49
    2127, // 50
];

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Capacidade protegida do armazém (não saqueável).
 * Fórmula confirmada via IKAEASY: 100 + 480 × level
 */
export function getWarehouseSafe(level) {
    return 100 + 480 * level;
}

/**
 * Corrupção de uma colônia com palaceColony de `level` níveis,
 * para uma conta com `totalCities` cidades.
 * Fórmula: corruption = 1 - (level + 1) / totalCities, clampado [0, 1]
 * Modificadores de governo devem ser aplicados externamente.
 */
export function getCorruption(palaceColonyLevel, totalCities) {
    return Math.min(Math.max(1 - (palaceColonyLevel + 1) / totalCities, 0), 1);
}

/**
 * Nível mínimo de palaceColony para corrupção = 0%.
 * Resolve: 1 - (level + 1) / totalCities = 0 → level = totalCities - 1
 */
export function getMinGRLevelForZeroCorruption(totalCities) {
    return totalCities - 1;
}

/**
 * Bônus de produção de madeira do Guarda Florestal.
 * +2% por nível, máximo 140%.
 */
export function getForesterWoodBonus(level) {
    return Math.min(level * 2, 140);
}

/**
 * Desconto no custo de madeira da Carpintaria.
 * -1% por nível, máximo 50%.
 */
export function getCarpentryWoodDiscount(level) {
    return Math.min(level, 50);
}

/**
 * Desconto no custo de mármore do Atelier de Arquitectura.
 * -1% por nível, máximo 50%.
 */
export function getArchitectMarbleDiscount(level) {
    return Math.min(level, 50);
}

/**
 * Desconto no custo de vinho das Caves de Vinho.
 * -1% por nível, máximo 50%.
 */
export function getVineyardWineDiscount(level) {
    return Math.min(level, 50);
}

/**
 * Desconto no custo de cristal do Oculista.
 * -1% por nível, máximo 50%.
 */
export function getOpticianGlassDiscount(level) {
    return Math.min(level, 50);
}

export const BUILDING_EFFECTS = {
    townHall:     { maxCitizens:       TOWN_HALL_MAX_CITIZENS },
    academy:      { maxScientists:     ACADEMY_MAX_SCIENTISTS },
    warehouse:    { capacity:          WAREHOUSE_CAPACITY },
    dump:         { capacity:          DUMP_CAPACITY },
    tavern:       { maxWine:           TAVERN_MAX_WINE },
    museum:       { culturalGoods:     MUSEUM_CULTURAL_GOODS },
    port:         { loadingSpeed:      PORT_LOADING_SPEED },
    branchOffice: { tradeCapacity:     BRANCH_OFFICE_CAPACITY },
    embassy:      { diplomacyPoints:   EMBASSY_DIPLOMACY_POINTS },
    temple:       { maxPriests:        TEMPLE_MAX_PRIESTS },
    // Edifícios com fórmula (sem tabela):
    // forester:    woodBonus = min(level * 2, 140)%
    // carpentering: woodDiscount = min(level, 50)%
    // architect:   marbleDiscount = min(level, 50)%
    // vineyard:    wineDiscount = min(level, 50)%
    // optician:    glassDiscount = min(level, 50)%
};

export default BUILDING_EFFECTS;
