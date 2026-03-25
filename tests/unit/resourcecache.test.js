// tests/unit/resourcecache.test.js — cache e projeção temporal

import { vi } from 'vitest';

const NOW = 1700000000; // timestamp base (Unix)

vi.mock('../../modules/Game.js', () => ({
  default: {
    getServerTime: vi.fn(() => NOW),
    getCity: vi.fn(),
    getCities: vi.fn(() => []),
    getBuildingLevel: vi.fn(() => 0),
    findPosition: vi.fn(() => null),
    fetchCityData: vi.fn(async () => null),
    storePositions: vi.fn(),
  },
}));

vi.mock('../../modules/Events.js', () => ({
  default: { emit: vi.fn(), on: vi.fn() },
}));

import ResourceCache from '../../modules/ResourceCache.js';
import Game from '../../modules/Game.js';

// Helper para popular o cache diretamente com updateFromResponse
function _seedCache(cityId, resources, production, maxResources = 5000) {
  // Popula via refresh interno usando mock do Game
  Game.getCity.mockReturnValueOnce({
    id: cityId,
    name: `Cidade ${cityId}`,
    islandId: 10,
    islandName: 'Ilha',
    coords: { x: 1, y: 1 },
    resources: {
      ...resources,
      woodProduction:   production.wood   ?? 0,
      wineProduction:   production.wine   ?? 0,
      marbleProduction: production.marble ?? 0,
      glassProduction:  production.glass  ?? 0,
      sulfurProduction: production.sulfur ?? 0,
      maxResources,
    },
  });
  Game.getBuildingLevel.mockReturnValueOnce(5); // qualquer nível
  ResourceCache.refresh(cityId);
}

beforeEach(() => {
  ResourceCache.invalidateAll();
  vi.clearAllMocks();
  Game.getServerTime.mockReturnValue(NOW);
});

describe('ResourceCache.refresh() e get()', () => {
  test('popula cache via Game.getCity', () => {
    _seedCache(101, { wood: 1000, wine: 500, marble: 200, glass: 300, sulfur: 100 },
      { wood: 50, wine: 20, marble: 10, glass: 15, sulfur: 5 });
    const cached = ResourceCache.get(101);
    expect(cached).toBeTruthy();
    expect(cached.resources.wood).toBe(1000);
    expect(cached.resources.wine).toBe(500);
  });

  test('get de cidade não cacheada tenta refresh', () => {
    Game.getCity.mockReturnValueOnce(null);
    const result = ResourceCache.get(999);
    expect(result).toBeNull();
  });
});

describe('ResourceCache.projectResources()', () => {
  test('projeta recursos 1 hora no futuro', () => {
    _seedCache(101,
      { wood: 1000, wine: 500, marble: 200, glass: 300, sulfur: 100 },
      { wood: 100, wine: 50, marble: 30, glass: 20, sulfur: 10 },
      5000,
    );

    const futureTs = NOW + 3600; // +1h
    Game.getServerTime.mockReturnValue(futureTs);
    const proj = ResourceCache.projectResources(101, futureTs);

    expect(proj.wood).toBe(1100);   // 1000 + 100*1
    expect(proj.wine).toBe(550);    // 500 + 50*1 (não limitado pelo cap)
    expect(proj.marble).toBe(230);  // 200 + 30*1
  });

  test('outros recursos não excedem maxResources (cap)', () => {
    _seedCache(101,
      { wood: 4900, wine: 0, marble: 0, glass: 0, sulfur: 0 },
      { wood: 500, wine: 0, marble: 0, glass: 0, sulfur: 0 },
      5000,
    );

    const futureTs = NOW + 3600; // +1h: 4900 + 500 = 5400 → cap a 5000
    const proj = ResourceCache.projectResources(101, futureTs);
    expect(proj.wood).toBe(5000);
  });

  test('vinho pode ir a zero mas não negativo', () => {
    _seedCache(101,
      { wood: 0, wine: 100, marble: 0, glass: 0, sulfur: 0 },
      { wood: 0, wine: -50, marble: 0, glass: 0, sulfur: 0 }, // consumo > produção
      5000,
    );

    const futureTs = NOW + 7200; // +2h: 100 + (-50)*2 = 0
    const proj = ResourceCache.projectResources(101, futureTs);
    expect(proj.wine).toBe(0);

    const moreFutureTs = NOW + 10800; // +3h: seria negativo → 0
    const proj2 = ResourceCache.projectResources(101, moreFutureTs);
    expect(proj2.wine).toBeGreaterThanOrEqual(0);
  });

  test('cidade sem cache retorna zeros', () => {
    const proj = ResourceCache.projectResources(999);
    expect(proj.wood).toBe(0);
    expect(proj.wine).toBe(0);
  });
});

describe('ResourceCache.hoursUntilResources()', () => {
  test('retorna 0 se já tem recursos suficientes', () => {
    _seedCache(101,
      { wood: 2000, wine: 0, marble: 1000, glass: 0, sulfur: 0 },
      { wood: 100, wine: 0, marble: 50, glass: 0, sulfur: 0 },
      5000,
    );

    const h = ResourceCache.hoursUntilResources(101, { wood: 1000, marble: 500 });
    expect(h).toBe(0);
  });

  test('calcula horas corretamente', () => {
    _seedCache(101,
      { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 },
      { wood: 100, wine: 0, marble: 0, glass: 0, sulfur: 0 },
      5000,
    );

    // Precisa de 200 wood, produz 100/h → 2h
    const h = ResourceCache.hoursUntilResources(101, { wood: 200 });
    expect(h).toBeCloseTo(2, 1);
  });

  test('retorna Infinity se necessário excede capacidade do armazém', () => {
    _seedCache(101,
      { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 },
      { wood: 100, wine: 0, marble: 0, glass: 0, sulfur: 0 },
      1000, // armazém pequeno
    );

    const h = ResourceCache.hoursUntilResources(101, { wood: 5000 }); // > capacidade
    expect(h).toBe(Infinity);
  });

  test('retorna Infinity se não produz o recurso', () => {
    _seedCache(101,
      { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 },
      { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 }, // sem produção
      5000,
    );

    const h = ResourceCache.hoursUntilResources(101, { wood: 100 });
    expect(h).toBe(Infinity);
  });

  test('retorna Infinity para cidade inexistente', () => {
    expect(ResourceCache.hoursUntilResources(999, { wood: 100 })).toBe(Infinity);
  });
});

describe('ResourceCache.updateFromResponse()', () => {
  test('atualiza recursos via headerData do servidor', () => {
    // Seed mínimo para criar entrada no cache
    _seedCache(101,
      { wood: 100, wine: 50, marble: 0, glass: 0, sulfur: 0 },
      { wood: 10, wine: 5, marble: 0, glass: 0, sulfur: 0 },
    );

    ResourceCache.updateFromResponse({
      headerData: {
        currentCityId: 101,
        currentResources: {
          resource: 999, // wood
          '1': 200,      // wine
          '2': 300,      // marble
          '3': 400,      // glass
          '4': 150,      // sulfur
        },
        freeTransporters: 8,
        maxTransporters: 10,
        maxStorage: 6000,
      },
    }, 101);

    const cached = ResourceCache.get(101);
    expect(cached.resources.wood).toBe(999);
    expect(cached.resources.wine).toBe(200);
    expect(cached.freeTransporters).toBe(8);
    expect(cached.maxResources).toBe(6000);
  });
});
