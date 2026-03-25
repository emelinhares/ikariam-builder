// const.js — constantes do jogo
// Fonte: ERP_FOUNDATION.md, IKARIAM_MODEL_MAP.md, IKAEASY const.js

// ─── Recursos ─────────────────────────────────────────────────────────────────
export const Resources = Object.freeze({
    WOOD:    'wood',
    WINE:    'wine',
    MARBLE:  'marble',
    GLASS:   'glass',
    CRYSTAL: 'glass',  // alias — a API usa 'glass'
    SULFUR:  'sulfur',
});

export const TradeGoodOrdinals = Object.freeze({
    WINE: 1, MARBLE: 2, GLASS: 3, CRYSTAL: 3, SULFUR: 4,
});

// ─── Edifícios ────────────────────────────────────────────────────────────────
// Chaves: nomes usados no código. Valores: nomes exatos do ikariam.model / view.
export const Buildings = Object.freeze({
    TOWN_HALL:          'townHall',
    PALACE:             'palace',
    GOVERNORS_RESIDENCE:'palaceColony',
    TAVERN:             'tavern',
    MUSEUM:             'museum',
    ACADEMY:            'academy',
    WORKSHOP:           'workshop',
    TEMPLE:             'temple',
    EMBASSY:            'embassy',
    WAREHOUSE:          'warehouse',
    DUMP:               'dump',
    PORT:               'port',
    BRANCH_OFFICE:      'branchOffice',
    BLACK_MARKET:       'blackMarket',
    MARINE_CHART:       'marineChartArchive',
    WALL:               'wall',
    SAFEHOUSE:          'safehouse',
    BARRACKS:           'barracks',
    SHIPYARD:           'shipyard',
    PIRATE_FORTRESS:    'pirateFortress',
    FORESTER:           'forester',
    CARPENTERING:       'carpentering',
    WINEGROWER:         'winegrower',
    VINEYARD:           'vineyard',
    STONEMASON:         'stonemason',
    ARCHITECT:          'architect',
    GLASSBLOWING:       'glassblowing',
    OPTICIAN:           'optician',
    ALCHEMIST:          'alchemist',
    FIREWORKER:         'fireworker',
});

// Edifícios que podem ter mais de 1 instância na mesma cidade
export const BuildingsMultiple = Object.freeze({
    port: true, warehouse: true, shipyard: true,
});

// IDs numéricos — usados no payload de construção (buildingId)
export const BuildingsId = Object.freeze({
    townHall:         0,
    palace:          11,
    palaceColony:    17,
    tavern:           9,
    museum:          10,
    academy:          4,
    workshop:        15,
    temple:          28,
    embassy:         12,
    warehouse:        7,
    dump:            29,
    port:             3,
    branchOffice:    13,
    blackMarket:     31,
    marineChartArchive: 32,
    wall:             8,
    safehouse:       16,
    barracks:         6,
    shipyard:         5,
    pirateFortress:  30,
    forester:        18,
    carpentering:    23,
    winegrower:      21,
    vineyard:        26,
    stonemason:      19,
    architect:       24,
    glassblowing:    20,
    optician:        25,
    alchemist:       22,
    fireworker:      27,
});

// ─── Logística ────────────────────────────────────────────────────────────────
export const TRAVEL = Object.freeze({
    DEPARTURE_FIXED_S:  1200,  // 20 min fixos de partida (mundo 1×)
    SAME_ISLAND_S:       900,  // 15 min para transporte na mesma ilha
    WORLD_SPEED_CONST:  null,  // calibrado via probeJourneyTime()
    RESOURCES_PER_SHIP:  500,  // unidades por navio transportador
});

// Velocidade de carregamento do porto por nível (bens/minuto)
// Fonte: ERP_FOUNDATION.md seção 14.1 — confirmado em jogo (BAD M: nível 14=768, 15=870)
// ATENÇÃO: salto anômalo entre nível 10 (130) e nível 11 (510).
//   Níveis 1–10: porto básico.
//   Níveis 11–60: requerem pesquisa "Doca" (segundo porto desbloqueado).
export const PORT_LOADING_SPEED = Object.freeze({
     1:    10,  2:    18,  3:    28,  4:    40,  5:    54,
     6:    70,  7:    88,  8:   108,  9:   118, 10:   130,
    11:   510, 12:   588, 13:   672, 14:   768, 15:   870,
    16:   984, 17:  1110, 18:  1248, 19:  1398, 20:  1566,
    21:  1746, 22:  1950, 23:  2172, 24:  2418, 25:  2682,
    26:  2982, 27:  3306, 28:  3660, 29:  4056, 30:  4488,
    31:  4962, 32:  5490, 33:  6066, 34:  6696, 35:  7392,
    36:  8160, 37:  9006, 38:  9930, 39: 10950, 40: 12072,
    41: 13308, 42: 14664, 43: 16158, 44: 17802, 45: 19608,
    46: 21600, 47: 23784, 48: 26190, 49: 28836, 50: 31746,
    51: 34950, 52: 38466, 53: 42342, 54: 46602, 55: 51294,
    56: 56448, 57: 62118, 58: 68358, 59: 75222, 60: 82770,
});

// ─── Movimentos de frota ──────────────────────────────────────────────────────
export const Movements = Object.freeze({
    Mission: {
        TRANSPORT:   'transport',
        DEPLOY_ARMY: 'deployarmy',
        DEPLOY_NAVY: 'deploynavy',
        PLUNDER:     'plunder',
        TRADE:       'trade',
    },
    Stage: {
        LOADING:    'loading',
        EN_ROUTE:   'en_route',
        RETURNING:  'returning',
    },
    MissionId: {
        TRANSPORT: 1,
        TRADE:     3,
        COLONIZE:  4,
        PLUNDER:   7,
    },
    MissionState: {
        LOADING:  1,
        EN_ROUTE: 2,
    },
});

// ─── Governo ──────────────────────────────────────────────────────────────────
export const Government = Object.freeze({
    ANARCHY:      'anarchie',
    IKACRACY:     'ikakratie',
    ARISTOCRACY:  'aristokratie',
    DICTATORSHIP: 'diktatur',
    DEMOCRACY:    'demokratie',
    NOMOCRACY:    'nomokratie',
    OLIGARCHY:    'oligarchie',
    TECHNOCRACY:  'technokratie',
    THEOCRACY:    'theokratie',
});

// ─── Misc ─────────────────────────────────────────────────────────────────────
export const GamePlay = Object.freeze({
    RESOURCES_PER_TRANSPORT:      500,
    RESOURCE_PROTECTION_WAREHOUSE: 480,
    BASE_RESOURCE_PROTECTION:      100,
});
