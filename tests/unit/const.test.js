// tests/unit/const.test.js — valida constantes do jogo

import {
  Resources,
  TradeGoodOrdinals,
  Buildings,
  BuildingsId,
  Movements,
  Research,
  GamePlay,
  PremiumFeatures,
  WINE_USE,
  PORT_LOADING_SPEED,
  MAX_SCIENTISTS,
} from '../../data/const.js';

describe('Resources', () => {
  test('CRYSTAL é alias para glass', () => {
    expect(Resources.CRYSTAL).toBe('glass');
    expect(Resources.GLASS).toBe('glass');
  });

  test('recursos básicos presentes', () => {
    expect(Resources.WOOD).toBe('wood');
    expect(Resources.WINE).toBe('wine');
    expect(Resources.MARBLE).toBe('marble');
    expect(Resources.SULFUR).toBe('sulfur');
  });
});

describe('TradeGoodOrdinals', () => {
  test('ordinais corretos', () => {
    expect(TradeGoodOrdinals.WINE).toBe(1);
    expect(TradeGoodOrdinals.MARBLE).toBe(2);
    expect(TradeGoodOrdinals.GLASS).toBe(3);
    expect(TradeGoodOrdinals.CRYSTAL).toBe(3); // alias
    expect(TradeGoodOrdinals.SULFUR).toBe(4);
  });

  test('é imutável (Object.freeze)', () => {
    expect(() => { TradeGoodOrdinals.WINE = 99; }).toThrow();
  });
});

describe('BuildingsId', () => {
  test('townHall é 0', () => {
    expect(BuildingsId['townHall']).toBe(0);
  });

  test('todos os IDs são únicos', () => {
    const ids = Object.values(BuildingsId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test('buildings principais presentes', () => {
    expect(BuildingsId['port']).toBeDefined();
    expect(BuildingsId['warehouse']).toBeDefined();
    expect(BuildingsId['academy']).toBeDefined();
    expect(BuildingsId['barracks']).toBeDefined();
  });
});

describe('GamePlay', () => {
  test('capacity por transporte é 500 (recursos)', () => {
    expect(GamePlay.RESOURCES_PER_TRANSPORT).toBe(500);
  });

  test('proteção do armazém é 480', () => {
    expect(GamePlay.RESOURCE_PROTECTION_WAREHOUSE).toBe(480);
  });
});

describe('WINE_USE', () => {
  test('nível 0 = 0', () => {
    expect(WINE_USE[0]).toBe(0);
  });

  test('consumo cresce monotonicamente', () => {
    for (let i = 1; i < WINE_USE.length; i++) {
      expect(WINE_USE[i]).toBeGreaterThan(WINE_USE[i - 1]);
    }
  });

  test('tabela tem ao menos 20 entradas', () => {
    expect(WINE_USE.length).toBeGreaterThanOrEqual(20);
  });
});

describe('PORT_LOADING_SPEED', () => {
  test('nível 0 = 10 (mínimo)', () => {
    expect(PORT_LOADING_SPEED[0]).toBe(10);
  });

  test('velocidade cresce monotonicamente', () => {
    for (let i = 1; i < PORT_LOADING_SPEED.length; i++) {
      expect(PORT_LOADING_SPEED[i]).toBeGreaterThan(PORT_LOADING_SPEED[i - 1]);
    }
  });
});

describe('MAX_SCIENTISTS', () => {
  test('nível 0 = 0 cientistas', () => {
    expect(MAX_SCIENTISTS[0]).toBe(0);
  });

  test('capacidade cresce monotonicamente', () => {
    for (let i = 1; i < MAX_SCIENTISTS.length; i++) {
      expect(MAX_SCIENTISTS[i]).toBeGreaterThan(MAX_SCIENTISTS[i - 1]);
    }
  });
});

describe('Movements', () => {
  test('TRANSPORT está definido', () => {
    expect(Movements.Mission.TRANSPORT).toBe('transport');
    expect(Movements.MissionId.TRANSPORT).toBe(1);
  });
});

describe('Research', () => {
  test('pesquisas de custo de construção', () => {
    expect(Research.Economy.PULLEY).toBe(2020);
    expect(Research.Economy.GEOMETRY).toBe(2060);
    expect(Research.Economy.SPIRIT_LEVEL).toBe(2100);
  });
});
