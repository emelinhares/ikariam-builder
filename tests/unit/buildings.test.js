// tests/unit/buildings.test.js — tabela de custos e funções de consulta

import BUILDING_COSTS, { getCost, getCumulativeCost } from '../../data/buildings.js';

describe('BUILDING_COSTS — estrutura', () => {
  test('edifícios principais presentes na tabela', () => {
    const required = [
      'townHall', 'warehouse', 'academy', 'port', 'barracks',
      'wall', 'tavern', 'shipyard', 'forester', 'stonemason',
    ];
    for (const b of required) {
      expect(BUILDING_COSTS[b], `${b} ausente em BUILDING_COSTS`).toBeDefined();
    }
  });

  test('índice 0 é sempre null (nível 0 não existe)', () => {
    for (const [name, table] of Object.entries(BUILDING_COSTS)) {
      expect(table[0], `${name}[0] deveria ser null`).toBeNull();
    }
  });

  test('custos são objetos com resources numéricos', () => {
    const entry = BUILDING_COSTS.townHall[5];
    expect(entry).toBeTruthy();
    for (const [, qty] of Object.entries(entry)) {
      expect(typeof qty).toBe('number');
      expect(qty).toBeGreaterThan(0);
    }
  });

  test('townHall vai até nível 30', () => {
    expect(BUILDING_COSTS.townHall[30]).toBeTruthy();
  });

  test('academy usa glass (não marble)', () => {
    const entry = BUILDING_COSTS.academy[6];
    expect(entry.glass).toBeDefined();
    expect(entry.marble).toBeUndefined();
  });

  test('warehouse usa wood + marble nos altos níveis', () => {
    const entry = BUILDING_COSTS.warehouse[10];
    expect(entry.wood).toBeDefined();
    expect(entry.marble).toBeDefined();
  });
});

describe('getCost()', () => {
  test('retorna custo correto para nível específico', () => {
    const cost = getCost('townHall', 1);
    expect(cost).toEqual({ wood: 158 });
  });

  test('retorna null para edifício inexistente', () => {
    expect(getCost('edificioInexistente', 1)).toBeNull();
  });

  test('retorna null para nível 0', () => {
    expect(getCost('townHall', 0)).toBeNull();
  });

  test('retorna null para nível acima do tabelado', () => {
    expect(getCost('townHall', 9999)).toBeNull();
  });

  test('warehouse nível 4 tem wood e marble', () => {
    const cost = getCost('warehouse', 4);
    expect(cost.wood).toBeGreaterThan(0);
    expect(cost.marble).toBeGreaterThan(0);
  });
});

describe('getCumulativeCost()', () => {
  test('custo acumulado do nível 0→1 == getCost(nível 1)', () => {
    const single = getCost('townHall', 1);
    const cumulative = getCumulativeCost('townHall', 0, 1);
    expect(cumulative).toEqual(single);
  });

  test('custo acumulado 0→5 é soma dos níveis 1 a 5', () => {
    const manual = {};
    for (let lv = 1; lv <= 5; lv++) {
      const c = getCost('townHall', lv);
      for (const [res, qty] of Object.entries(c)) {
        manual[res] = (manual[res] ?? 0) + qty;
      }
    }
    expect(getCumulativeCost('townHall', 0, 5)).toEqual(manual);
  });

  test('de nível N para o mesmo N retorna null (nada a construir)', () => {
    expect(getCumulativeCost('townHall', 5, 5)).toBeNull();
  });

  test('edifício inexistente retorna null', () => {
    expect(getCumulativeCost('edificioFake', 0, 5)).toBeNull();
  });

  test('custo acumulado é maior que custo de um único nível', () => {
    const single = getCumulativeCost('warehouse', 9, 10);
    const multi = getCumulativeCost('warehouse', 5, 10);
    expect(multi.wood).toBeGreaterThan(single.wood);
  });
});
