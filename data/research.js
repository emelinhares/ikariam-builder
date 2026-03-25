// research.js — IDs de pesquisas do jogo
// Fonte: IKAEASY_FULL/js/const.js (versão 3.1.0.24)

export const Research = Object.freeze({
    Seafaring: {
        CARPENTRY:             2150,
        DECK_WEAPONS:          1010,
        PIRACY:                1170,
        SHIP_MAINTENANCE:      1020,
        DRAFT:                 1130,
        EXPANSION:             1030,
        FOREIGN_CULTURES:      1040,
        PITCH:                 1050,
        MARKET:                2070,
        GREEK_FIRE:            1060,
        COUNTERWEIGHT:         1070,
        DIPLOMACY:             1080,
        SEA_MAPS:              1090,
        PADDLE_WHEEL_ENGINE:   1100,
        CAULKING:              1140,
        MORTAR_ATTACHMENT:     1110,
        MASSIVE_RAM:           1150,
        OFFSHORE_BASE:         1160,
        SEAFARING_FUTURE:      1999,
    },
    Economy: {
        CONSERVATION:                 2010,  // -5% madeira em construção
        PULLEY:                       2020,  // -5% madeira em construção
        WEALTH:                       2030,
        WINE_CULTURE:                 2040,
        IMPROVED_RESOURCE_GATHERING:  2130,
        GEOMETRY:                     2060,  // -5% mármore em construção
        ARCHITECTURE:                 1120,  // -3% todos os recursos
        HOLIDAY:                      2080,
        LEGISLATION:                  2170,
        CULINARY_SPECIALITIES:        2050,
        HELPING_HANDS:                2090,
        SPIRIT_LEVEL:                 2100,
        WINE_PRESS:                   2140,
        DEPOT:                        2160,
        BUREACRACY:                   2110,
        UTOPIA:                       2120,
        ECONOMIC_FUTURE:              2999,
    },
    Science: {
        WELL_CONSTRUCTION:       3010,
        PAPER:                   3020,  // +2% pontos de pesquisa/h
        ESPIONAGE:               3030,
        POLYTHEISM:              3040,
        INK:                     3050,  // +4% pontos de pesquisa/h
        GOVERNMENT_FORMATION:    3150,
        INVENTION:               3140,
        CULTURAL_EXCHANGE:       3060,
        ANATOMY:                 3070,
        OPTICS:                  3080,
        EXPERIMENTS:             3081,
        MECHANICAL_PEN:          3090,  // +8% pontos de pesquisa/h
        BIRDS_FLIGHT:            3100,
        LETTER_CHUTE:            3110,
        STATE_RELIGION:          3160,
        PRESSURE_CHAMBER:        3120,
        ARCHIMEDEAN_PRINCIPLE:   3130,
        SCIENTIFIC_FUTURE:       3999,
    },
    Military: {
        DRY_DOCKS:          4010,
        MAPS:               4020,
        PROFESSIONAL_ARMY:  4030,
        SEIGE:              4040,
        CODE_OF_HONOR:      4050,
        BALLISTICS:         4060,
        LAW_OF_THE_LEVEL:   4070,
        GOVERNOR:           4080,
        PYROTECHNICS:       4130,
        LOGISTICS:          4090,
        GUNPOWDER:          4100,
        ROBOTICS:           4110,
        CANNON_CASTING:     4120,
        MILITARISTIC_FUTURE:4999,
    },
});

// Pesquisas que reduzem custo de construção — prioridade do CTO para desbloquear.
// Listadas na ordem de maior impacto relativo.
export const COST_REDUCERS = [
    Research.Economy.PULLEY,          // -5% madeira em construção
    Research.Economy.CONSERVATION,    // -5% madeira
    Research.Economy.GEOMETRY,        // -5% mármore em construção
    Research.Economy.ARCHITECTURE,    // -3% todos os recursos
    Research.Science.PAPER,           // +2% pesquisa/h
    Research.Science.INK,             // +4% pesquisa/h
    Research.Science.MECHANICAL_PEN,  // +8% pesquisa/h
];
