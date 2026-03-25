// buildings.js — tabela estática de custos de upgrade por edifício
//
// Uso principal: estimativas rápidas na UI sem fazer request ao servidor.
// Fonte autoritativa: Game.fetchCosts() (parse HTML do servidor).
//
// Estrutura:
//   BUILDING_COSTS[buildingType][level] = { wood?, marble?, glass?, sulfur?, wine? }
//   level = nível DESTINO (1-based). Índice 0 é sempre null.
//
// Fonte dos dados: IKAEASY (https://github.com/ikaeasy) — valores verificados contra o jogo real.
// Nota sobre recursos: academy usa glass (glass), demais edifícios usam wood + marble.
// Glassblowing e alchemist também usam marble (não glass/sulfur) como segundo recurso.

// ─── Tabela estática ──────────────────────────────────────────────────────────

export const BUILDING_COSTS = {

    townHall: [
        null,
        { wood: 158 },
        { wood: 335 },
        { wood: 623 },
        { wood: 923,   marble: 285 },
        { wood: 1390,  marble: 551 },
        { wood: 2015,  marble: 936 },
        { wood: 2706,  marble: 1411 },
        { wood: 3661,  marble: 2091 },
        { wood: 4776,  marble: 2945 },
        { wood: 6173,  marble: 4072 },  // 10
        { wood: 8074,  marble: 5664 },
        { wood: 10281, marble: 7637 },
        { wood: 13023, marble: 10214 },
        { wood: 16424, marble: 13575 },
        { wood: 20986, marble: 18254 },
        { wood: 25423, marble: 23250 },
        { wood: 32285, marble: 31022 },
        { wood: 40232, marble: 40599 },
        { wood: 49286, marble: 52216 },
        { wood: 61207, marble: 68069 },  // 20
        { wood: 74804, marble: 87316 },
        { wood: 93956, marble: 115101 },
        { wood: 113035, marble: 145326 },
        { wood: 141594, marble: 191053 },
        { wood: 170213, marble: 241039 },
        { wood: 210011, marble: 312128 },
        { wood: 258875, marble: 403825 },
        { wood: 314902, marble: 515593 },
        { wood: 387657, marble: 666229 },
        { wood: 471194, marble: 850031 },  // 30
    ],

    warehouse: [
        null,
        { wood: 160 },
        { wood: 288 },
        { wood: 442 },
        { wood: 626,  marble: 96 },
        { wood: 847,  marble: 211 },
        { wood: 1113, marble: 349 },
        { wood: 1431, marble: 515 },
        { wood: 1813, marble: 714 },
        { wood: 2272, marble: 953 },
        { wood: 2822, marble: 1240 },  // 10
        { wood: 3483, marble: 1584 },
        { wood: 4275, marble: 1997 },
        { wood: 5226, marble: 2492 },
        { wood: 6368, marble: 3086 },
        { wood: 7737, marble: 3800 },
        { wood: 9380, marble: 4656 },
        { wood: 11353, marble: 5683 },
        { wood: 13719, marble: 6915 },
        { wood: 16559, marble: 8394 },
        { wood: 19967, marble: 10169 },  // 20
        { wood: 24056, marble: 12299 },
        { wood: 28963, marble: 14855 },
        { wood: 34852, marble: 17922 },
        { wood: 41918, marble: 21602 },
        { wood: 50398, marble: 26019 },
        { wood: 60574, marble: 31319 },
        { wood: 72784, marble: 37678 },
        { wood: 87437, marble: 45310 },
        { wood: 105021, marble: 54468 },
        { wood: 126121, marble: 65458 },  // 30
    ],

    // Academy usa glass (glass) como segundo recurso
    academy: [
        null,
        { wood: 64 },
        { wood: 68 },
        { wood: 115 },
        { wood: 263 },
        { wood: 382,  glass: 225 },
        { wood: 626,  glass: 428 },
        { wood: 982,  glass: 744 },
        { wood: 1330, glass: 1089 },
        { wood: 2004, glass: 1748 },
        { wood: 2665, glass: 2454 },  // 10
        { wood: 3916, glass: 3786 },
        { wood: 5156, glass: 5216 },
        { wood: 7446, glass: 7862 },
        { wood: 9753, glass: 10729 },
        { wood: 12751, glass: 14599 },
        { wood: 18163, glass: 21627 },
        { wood: 23691, glass: 29322 },
        { wood: 33451, glass: 43020 },
        { wood: 43572, glass: 58213 },
        { wood: 56729, glass: 78724 },  // 20
        { wood: 73833, glass: 106414 },
        { wood: 103459, glass: 154857 },
        { wood: 144203, glass: 224146 },
        { wood: 175058, glass: 282572 },
        { wood: 243930, glass: 408877 },
        { wood: 317208, glass: 552141 },
        { wood: 439968, glass: 795252 },
        { wood: 536310, glass: 1006648 },
        { wood: 743789, glass: 1449741 },
        { wood: 1027470, glass: 2079651 },  // 30
    ],

    tavern: [
        null,
        { wood: 101 },
        { wood: 222 },
        { wood: 367 },
        { wood: 541,  marble: 94 },
        { wood: 750,  marble: 122 },
        { wood: 1001, marble: 158 },
        { wood: 1302, marble: 206 },
        { wood: 1663, marble: 267 },
        { wood: 2097, marble: 348 },
        { wood: 2617, marble: 452 },  // 10
        { wood: 3241, marble: 587 },
        { wood: 3990, marble: 764 },
        { wood: 4888, marble: 993 },
        { wood: 5967, marble: 1290 },
        { wood: 7261, marble: 1677 },
        { wood: 8814, marble: 2181 },
        { wood: 10678, marble: 2835 },
        { wood: 12914, marble: 3685 },
        { wood: 15598, marble: 4791 },
        { wood: 18818, marble: 6228 },  // 20
        { wood: 22683, marble: 8097 },
        { wood: 27320, marble: 10526 },
        { wood: 32885, marble: 13684 },
        { wood: 39562, marble: 17789 },
        { wood: 47576, marble: 23125 },
        { wood: 57192, marble: 30063 },
        { wood: 68731, marble: 39082 },
        { wood: 82578, marble: 50806 },
        { wood: 99194, marble: 66048 },
        { wood: 119134, marble: 85862 },  // 30
    ],

    port: [
        null,
        { wood: 60 },
        { wood: 150 },
        { wood: 274 },
        { wood: 429 },
        { wood: 637 },
        { wood: 894,  marble: 176 },
        { wood: 1207, marble: 326 },
        { wood: 1645, marble: 540 },
        { wood: 2106, marble: 791 },
        { wood: 2735, marble: 1138 },  // 10
        { wood: 3537, marble: 1598 },
        { wood: 4492, marble: 2176 },
        { wood: 5689, marble: 2928 },
        { wood: 7103, marble: 3859 },
        { wood: 8850, marble: 5051 },
        { wood: 11094, marble: 6628 },
        { wood: 13731, marble: 8566 },
        { wood: 17062, marble: 11089 },
        { wood: 21097, marble: 14265 },
        { wood: 25965, marble: 18241 },  // 20
        { wood: 31810, marble: 23197 },
        { wood: 39190, marble: 29642 },
        { wood: 47998, marble: 37636 },
        { wood: 58713, marble: 47703 },
        { wood: 71955, marble: 60556 },
    ],

    shipyard: [
        null,
        { wood: 105 },
        { wood: 202 },
        { wood: 324 },
        { wood: 477 },
        { wood: 671 },
        { wood: 914,  marble: 778 },
        { wood: 1222, marble: 1052 },
        { wood: 1609, marble: 1397 },
        { wood: 2096, marble: 1832 },
        { wood: 2711, marble: 2381 },  // 10
        { wood: 3485, marble: 3071 },
        { wood: 4460, marble: 3942 },
        { wood: 5689, marble: 5038 },
        { wood: 7238, marble: 6420 },
        { wood: 9190, marble: 8161 },
        { wood: 11648, marble: 10354 },
        { wood: 14746, marble: 13118 },
        { wood: 18650, marble: 16601 },
        { wood: 23568, marble: 20989 },
        { wood: 29765, marble: 26517 },  // 20
        { wood: 37573, marble: 33484 },
        { wood: 47412, marble: 42261 },
        { wood: 59808, marble: 53321 },
        { wood: 75428, marble: 67256 },
        { wood: 95108, marble: 84814 },
    ],

    barracks: [
        null,
        { wood: 49 },
        { wood: 114 },
        { wood: 195 },
        { wood: 296 },
        { wood: 420 },
        { wood: 574 },
        { wood: 766 },
        { wood: 1003 },
        { wood: 1297, marble: 178 },
        { wood: 1662, marble: 431 },  // 10
        { wood: 2115, marble: 745 },
        { wood: 2676, marble: 1134 },
        { wood: 3371, marble: 1616 },
        { wood: 4234, marble: 2214 },
        { wood: 5304, marble: 2956 },
        { wood: 6630, marble: 3875 },
        { wood: 8275, marble: 5015 },
        { wood: 10314, marble: 6429 },
        { wood: 12843, marble: 8183 },
        { wood: 15979, marble: 10357 },  // 20
        { wood: 19868, marble: 13052 },
        { wood: 24690, marble: 16395 },
        { wood: 30669, marble: 20540 },
        { wood: 38083, marble: 25680 },
        { wood: 47277, marble: 32054 },
    ],

    wall: [
        null,
        { wood: 114 },
        { wood: 361,  marble: 203 },
        { wood: 657,  marble: 516 },
        { wood: 1012, marble: 892 },
        { wood: 1439, marble: 1344 },
        { wood: 1951, marble: 1885 },
        { wood: 2565, marble: 2535 },
        { wood: 3302, marble: 3315 },
        { wood: 4186, marble: 4251 },
        { wood: 5247, marble: 5374 },  // 10
        { wood: 6521, marble: 6721 },
        { wood: 8049, marble: 8338 },
        { wood: 9882, marble: 10279 },
        { wood: 12083, marble: 12608 },
        { wood: 14724, marble: 15402 },
        { wood: 17892, marble: 18755 },
        { wood: 21695, marble: 22779 },
        { wood: 26258, marble: 27607 },
        { wood: 31733, marble: 33402 },
        { wood: 38304, marble: 40355 },  // 20
        { wood: 46189, marble: 48699 },
        { wood: 55650, marble: 58711 },
        { wood: 67004, marble: 70726 },
        { wood: 80629, marble: 85144 },
        { wood: 96979, marble: 102446 },
    ],

    museum: [
        null,
        { wood: 560,  marble: 280 },
        { wood: 1435, marble: 1190 },
        { wood: 2748, marble: 2573 },
        { wood: 4716, marble: 4676 },
        { wood: 7669, marble: 7871 },
        { wood: 12099, marble: 12729 },
        { wood: 18744, marble: 20112 },
        { wood: 28710, marble: 31335 },
        { wood: 43661, marble: 48394 },
        { wood: 66086, marble: 74323 },  // 10
        { wood: 99724, marble: 113736 },
        { wood: 150181, marble: 173643 },
        { wood: 225866, marble: 264701 },
        { wood: 339394, marble: 403110 },
        { wood: 509686, marble: 613492 },
        { wood: 765124, marble: 933272 },
        { wood: 1148281, marble: 1419338 },
        { wood: 1723017, marble: 2158158 },
        { wood: 2585121, marble: 3281165 },
        { wood: 3878276, marble: 4988136 },  // 20
    ],

    branchOffice: [
        null,
        { wood: 48 },
        { wood: 173 },
        { wood: 346 },
        { wood: 581 },
        { wood: 896,  marble: 540 },
        { wood: 1314, marble: 792 },
        { wood: 1863, marble: 1123 },
        { wood: 2580, marble: 1555 },
        { wood: 3509, marble: 2115 },
        { wood: 4706, marble: 2837 },  // 10
        { wood: 6241, marble: 3762 },
        { wood: 8203, marble: 4945 },
        { wood: 10699, marble: 6450 },
        { wood: 13866, marble: 8359 },
        { wood: 17872, marble: 10774 },
        { wood: 22926, marble: 13820 },
        { wood: 29286, marble: 17654 },
        { wood: 37273, marble: 22469 },
        { wood: 47283, marble: 28503 },
        { wood: 59807, marble: 36052 },  // 20
    ],

    embassy: [
        null,
        { wood: 242,  marble: 155 },
        { wood: 415,  marble: 342 },
        { wood: 623,  marble: 571 },
        { wood: 873,  marble: 850 },
        { wood: 1173, marble: 1190 },
        { wood: 1532, marble: 1606 },
        { wood: 1964, marble: 2112 },
        { wood: 2482, marble: 2730 },
        { wood: 3103, marble: 3484 },
        { wood: 3849, marble: 4404 },  // 10
        { wood: 4743, marble: 5527 },
        { wood: 5817, marble: 6896 },
        { wood: 7105, marble: 8566 },
        { wood: 8651, marble: 10604 },
        { wood: 10507, marble: 13090 },
        { wood: 12733, marble: 16123 },
        { wood: 15404, marble: 19824 },
        { wood: 18610, marble: 24339 },
        { wood: 22457, marble: 29846 },
        { wood: 27074, marble: 36566 },  // 20
    ],

    workshop: [
        null,
        { wood: 220,  marble: 95 },
        { wood: 383,  marble: 167 },
        { wood: 569,  marble: 251 },
        { wood: 781,  marble: 349 },
        { wood: 1023, marble: 461 },
        { wood: 1299, marble: 592 },
        { wood: 1613, marble: 744 },
        { wood: 1972, marble: 920 },
        { wood: 2380, marble: 1125 },
        { wood: 2846, marble: 1362 },  // 10
        { wood: 3377, marble: 1637 },
        { wood: 3982, marble: 1956 },
        { wood: 4672, marble: 2326 },
        { wood: 5458, marble: 2755 },
        { wood: 6355, marble: 3253 },
        { wood: 7377, marble: 3831 },
        { wood: 8542, marble: 4501 },
        { wood: 9870, marble: 5278 },
        { wood: 11385, marble: 6180 },
        { wood: 13111, marble: 7226 },  // 20
    ],

    safehouse: [
        null,
        { wood: 113 },
        { wood: 248 },
        { wood: 402 },
        { wood: 578,  marble: 129 },
        { wood: 779,  marble: 197 },
        { wood: 1007, marble: 275 },
        { wood: 1267, marble: 366 },
        { wood: 1564, marble: 471 },
        { wood: 1903, marble: 593 },
        { wood: 2288, marble: 735 },  // 10
        { wood: 2728, marble: 900 },
        { wood: 3230, marble: 1090 },
        { wood: 3801, marble: 1312 },
        { wood: 4453, marble: 1569 },
        { wood: 5195, marble: 1866 },
        { wood: 6042, marble: 2212 },
        { wood: 7008, marble: 2613 },
        { wood: 8108, marble: 3078 },
        { wood: 9363, marble: 3617 },
        { wood: 10793, marble: 4243 },  // 20
    ],

    palace: [
        null,
        { wood: 712 },
        { wood: 5824,   marble: 1434 },
        { wood: 16048,  marble: 4546,  sulfur: 3089 },
        { wood: 36496,  wine: 10898,  marble: 10770,  sulfur: 10301 },
        { wood: 77392,  wine: 22110,  marble: 23218,  glass: 21188,  sulfur: 24725 },
        { wood: 159184, wine: 44534,  marble: 48114,  glass: 42400,  sulfur: 53573 },
        { wood: 322768, wine: 89382,  marble: 97906,  glass: 84824,  sulfur: 111269 },
        { wood: 649936, wine: 179078, marble: 197490, glass: 169672, sulfur: 226661 },
        { wood: 1304272, wine: 358470, marble: 396658, glass: 339368, sulfur: 457445 },
        { wood: 2612944, wine: 717254, marble: 794994, glass: 678760, sulfur: 919013 },  // 10
        { wood: 4743518, wine: 1434822, marble: 1591666, glass: 1357544, sulfur: 1842149 },
        { wood: 8611345, wine: 2870272, marble: 3186691, glass: 2715136, sulfur: 3692562 },
        { wood: 15632968, wine: 5741800, marble: 6380109, glass: 5430368, sulfur: 7401691 },
        { wood: 28379968, wine: 11486115, marble: 12773685, glass: 10860928, sulfur: 14836588 },
        { wood: 51520771, wine: 22977258, marble: 25574331, glass: 21722240, sulfur: 29739739 },  // 15
    ],

    palaceColony: [
        null,
        { wood: 712 },
        { wood: 5824,   marble: 1434 },
        { wood: 16048,  marble: 4546,  sulfur: 3089 },
        { wood: 36496,  wine: 10898,  marble: 10770,  sulfur: 10301 },
        { wood: 77392,  wine: 22110,  marble: 23218,  glass: 21188,  sulfur: 24725 },
        { wood: 159184, wine: 44534,  marble: 48114,  glass: 42400,  sulfur: 53573 },
        { wood: 322768, wine: 89382,  marble: 97906,  glass: 84824,  sulfur: 111269 },
        { wood: 649936, wine: 179078, marble: 197490, glass: 169672, sulfur: 226661 },
        { wood: 1304272, wine: 358470, marble: 396658, glass: 339368, sulfur: 457445 },
        { wood: 2612944, wine: 717254, marble: 794994, glass: 678760, sulfur: 919013 },  // 10
        { wood: 4743518, wine: 1434822, marble: 1591666, glass: 1357544, sulfur: 1842149 },
        { wood: 8611345, wine: 2870272, marble: 3186691, glass: 2715136, sulfur: 3692562 },
        { wood: 15632968, wine: 5741800, marble: 6380109, glass: 5430368, sulfur: 7401691 },
        { wood: 28379968, wine: 11486115, marble: 12773685, glass: 10860928, sulfur: 14836588 },
        { wood: 51520771, wine: 22977258, marble: 25574331, glass: 21722240, sulfur: 29739739 },  // 15
    ],

    // ─── Edifícios de produção (todos custam wood + marble) ───────────────────

    forester: [
        null,
        { wood: 250 },
        { wood: 430,  marble: 104 },
        { wood: 664,  marble: 237 },
        { wood: 968,  marble: 410 },
        { wood: 1364, marble: 635 },
        { wood: 1878, marble: 928 },
        { wood: 2546, marble: 1309 },
        { wood: 3415, marble: 1803 },
        { wood: 4544, marble: 2446 },
        { wood: 6013, marble: 3282 },  // 10
        { wood: 7922, marble: 4368 },
        { wood: 10403, marble: 5781 },
        { wood: 13629, marble: 7617 },
        { wood: 17823, marble: 10004 },
        { wood: 23274, marble: 13108 },
        { wood: 30362, marble: 17142 },
        { wood: 39575, marble: 22387 },
        { wood: 51552, marble: 29204 },
        { wood: 67123, marble: 38068 },
        { wood: 87365, marble: 49590 },  // 20
    ],

    // Stonemason, glassblowing, alchemist e winegrower
    // compartilham a mesma tabela de custos no IKAEASY
    stonemason: [
        null,
        { wood: 274 },
        { wood: 467,  marble: 116 },
        { wood: 718,  marble: 255 },
        { wood: 1045, marble: 436 },
        { wood: 1469, marble: 671 },
        { wood: 2021, marble: 977 },
        { wood: 2738, marble: 1375 },
        { wood: 3671, marble: 1892 },
        { wood: 4883, marble: 2564 },
        { wood: 6459, marble: 3437 },  // 10
        { wood: 8508, marble: 4572 },
        { wood: 11172, marble: 6049 },
        { wood: 14634, marble: 7968 },
        { wood: 19135, marble: 10462 },
        { wood: 24987, marble: 13705 },
        { wood: 32594, marble: 17921 },
        { wood: 42483, marble: 23402 },
        { wood: 55339, marble: 30527 },
        { wood: 72051, marble: 39790 },
        { wood: 93778, marble: 51831 },  // 20
    ],

    // Glassblowing: segundo recurso é marble (não glass/glass)
    glassblowing: [
        null,
        { wood: 274 },
        { wood: 467,  marble: 116 },
        { wood: 718,  marble: 255 },
        { wood: 1045, marble: 436 },
        { wood: 1469, marble: 671 },
        { wood: 2021, marble: 977 },
        { wood: 2738, marble: 1375 },
        { wood: 3671, marble: 1892 },
        { wood: 4883, marble: 2564 },
        { wood: 6459, marble: 3437 },  // 10
        { wood: 8508, marble: 4572 },
        { wood: 11172, marble: 6049 },
        { wood: 14634, marble: 7968 },
        { wood: 19135, marble: 10462 },
        { wood: 24987, marble: 13705 },
        { wood: 32594, marble: 17921 },
        { wood: 42483, marble: 23402 },
        { wood: 55339, marble: 30527 },
        { wood: 72051, marble: 39790 },
        { wood: 93778, marble: 51831 },  // 20
    ],

    // Alchemist: segundo recurso é marble (não sulfur)
    alchemist: [
        null,
        { wood: 274 },
        { wood: 467,  marble: 116 },
        { wood: 718,  marble: 255 },
        { wood: 1045, marble: 436 },
        { wood: 1469, marble: 671 },
        { wood: 2021, marble: 977 },
        { wood: 2738, marble: 1375 },
        { wood: 3671, marble: 1892 },
        { wood: 4883, marble: 2564 },
        { wood: 6459, marble: 3437 },  // 10
        { wood: 8508, marble: 4572 },
        { wood: 11172, marble: 6049 },
        { wood: 14634, marble: 7968 },
        { wood: 19135, marble: 10462 },
        { wood: 24987, marble: 13705 },
        { wood: 32594, marble: 17921 },
        { wood: 42483, marble: 23402 },
        { wood: 55339, marble: 30527 },
        { wood: 72051, marble: 39790 },
        { wood: 93778, marble: 51831 },  // 20
    ],

    winegrower: [
        null,
        { wood: 274 },
        { wood: 467,  marble: 116 },
        { wood: 718,  marble: 255 },
        { wood: 1045, marble: 436 },
        { wood: 1469, marble: 671 },
        { wood: 2021, marble: 977 },
        { wood: 2738, marble: 1375 },
        { wood: 3671, marble: 1892 },
        { wood: 4883, marble: 2564 },
        { wood: 6459, marble: 3437 },  // 10
        { wood: 8508, marble: 4572 },
        { wood: 11172, marble: 6049 },
        { wood: 14634, marble: 7968 },
        { wood: 19135, marble: 10462 },
        { wood: 24987, marble: 13705 },
        { wood: 32594, marble: 17921 },
        { wood: 42483, marble: 23402 },
        { wood: 55339, marble: 30527 },
        { wood: 72051, marble: 39790 },
        { wood: 93778, marble: 51831 },  // 20
    ],

    carpentering: [
        null,
        { wood: 63 },
        { wood: 122 },
        { wood: 192 },
        { wood: 274 },
        { wood: 372 },
        { wood: 486 },
        { wood: 620 },
        { wood: 777,  marble: 359 },
        { wood: 962,  marble: 444 },
        { wood: 1178, marble: 546 },  // 10
        { wood: 1432, marble: 669 },
        { wood: 1730, marble: 816 },
        { wood: 2078, marble: 993 },
        { wood: 2486, marble: 1205 },
        { wood: 2964, marble: 1459 },
        { wood: 3524, marble: 1765 },
        { wood: 4178, marble: 2131 },
        { wood: 4945, marble: 2571 },
        { wood: 5841, marble: 3098 },
        { wood: 6890, marble: 3731 },  // 20
    ],

    optician: [
        null,
        { wood: 119 },
        { wood: 188,  marble: 35 },
        { wood: 269,  marble: 96 },
        { wood: 362,  marble: 167 },
        { wood: 471,  marble: 249 },
        { wood: 597,  marble: 345 },
        { wood: 742,  marble: 455 },
        { wood: 912,  marble: 584 },
        { wood: 1108, marble: 733 },
        { wood: 1335, marble: 905 },  // 10
        { wood: 1600, marble: 1106 },
        { wood: 1906, marble: 1338 },
        { wood: 2261, marble: 1608 },
        { wood: 2673, marble: 1921 },
        { wood: 3152, marble: 2283 },
        { wood: 3706, marble: 2704 },
        { wood: 4350, marble: 3192 },
        { wood: 5096, marble: 3759 },
        { wood: 5962, marble: 4416 },
        { wood: 6966, marble: 5178 },  // 20
    ],

    architect: [
        null,
        { wood: 185,  marble: 106 },
        { wood: 291,  marble: 160 },
        { wood: 413,  marble: 222 },
        { wood: 555,  marble: 295 },
        { wood: 720,  marble: 379 },
        { wood: 911,  marble: 475 },
        { wood: 1133, marble: 587 },
        { wood: 1390, marble: 716 },
        { wood: 1689, marble: 865 },
        { wood: 2035, marble: 1036 },  // 10
        { wood: 2437, marble: 1233 },
        { wood: 2902, marble: 1460 },
        { wood: 3443, marble: 1722 },
        { wood: 4070, marble: 2023 },
        { wood: 4797, marble: 2369 },
        { wood: 5640, marble: 2767 },
        { wood: 6619, marble: 3226 },
        { wood: 7754, marble: 3753 },
        { wood: 9074, marble: 4358 },
        { wood: 10614, marble: 5051 },  // 20
    ],

    vineyard: [
        null,
        { wood: 339,  marble: 123 },
        { wood: 423,  marble: 198 },
        { wood: 520,  marble: 285 },
        { wood: 631,  marble: 387 },
        { wood: 758,  marble: 504 },
        { wood: 905,  marble: 640 },
        { wood: 1074, marble: 798 },
        { wood: 1269, marble: 981 },
        { wood: 1492, marble: 1194 },
        { wood: 1749, marble: 1440 },  // 10
        { wood: 2045, marble: 1726 },
        { wood: 2384, marble: 2058 },
        { wood: 2775, marble: 2443 },
        { wood: 3225, marble: 2889 },
        { wood: 3741, marble: 3407 },
        { wood: 4336, marble: 4008 },
        { wood: 5019, marble: 4705 },
        { wood: 5805, marble: 5513 },
        { wood: 6709, marble: 6450 },
        { wood: 7749, marble: 7538 },  // 20
    ],

    fireworker: [
        null,
        { wood: 273,  marble: 135 },
        { wood: 353,  marble: 212 },
        { wood: 445,  marble: 302 },
        { wood: 551,  marble: 405 },
        { wood: 673,  marble: 526 },
        { wood: 813,  marble: 665 },
        { wood: 974,  marble: 827 },
        { wood: 1159, marble: 1015 },
        { wood: 1373, marble: 1233 },
        { wood: 1618, marble: 1486 },  // 10
        { wood: 1899, marble: 1779 },
        { wood: 2223, marble: 2120 },
        { wood: 2596, marble: 2514 },
        { wood: 3025, marble: 2972 },
        { wood: 3517, marble: 3503 },
        { wood: 4084, marble: 4119 },
        { wood: 4736, marble: 4834 },
        { wood: 5486, marble: 5662 },
        { wood: 6347, marble: 6624 },
        { wood: 7339, marble: 7739 },  // 20
    ],

};

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Retorna o custo estático de upgrade de um edifício para `toLevel`.
 * Retorna null se o edifício ou nível não estão tabelados.
 */
export function getCost(buildingType, toLevel) {
    const table = BUILDING_COSTS[buildingType];
    if (!table) return null;
    return table[toLevel] ?? null;
}

/**
 * Retorna todos os custos de um edifício do nível `fromLevel+1` até `toLevel`.
 * Útil para calcular o custo total de um upgrade multi-nível.
 */
export function getCumulativeCost(buildingType, fromLevel, toLevel) {
    const totals = {};
    for (let lv = fromLevel + 1; lv <= toLevel; lv++) {
        const c = getCost(buildingType, lv);
        if (!c) continue;
        for (const [res, qty] of Object.entries(c)) {
            totals[res] = (totals[res] ?? 0) + qty;
        }
    }
    return Object.keys(totals).length > 0 ? totals : null;
}

export default BUILDING_COSTS;
