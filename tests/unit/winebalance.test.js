// tests/unit/winebalance.test.js — lógica de distribuição de vinho

import { vi } from 'vitest';

vi.mock('../../modules/Storage.js', () => ({
  default: { get: vi.fn(async () => null), set: vi.fn(), remove: vi.fn() },
}));
vi.mock('../../modules/Events.js', () => ({
  default: { emit: vi.fn(), on: vi.fn() },
}));
vi.mock('../../modules/Port.js', () => ({
  default: { enqueue: vi.fn(), getQueue: vi.fn(() => []), hasWork: vi.fn(() => false) },
}));

// ResourceCache mock configurável
const _mockCache = {};
vi.mock('../../modules/ResourceCache.js', () => ({
  default: {
    refresh: vi.fn(),
    getCurrent: vi.fn((cityId, res) => _mockCache[cityId]?.resources?.[res] ?? 0),
    getCapacity: vi.fn((cityId) => _mockCache[cityId]?.capacity ?? 5000),
    getProduction: vi.fn((cityId, res) => _mockCache[cityId]?.production?.[res] ?? 0),
    get: vi.fn((cityId) => _mockCache[cityId] ?? null),
  },
}));

// Game mock
const _mockCities = [];
vi.mock('../../modules/Game.js', () => ({
  default: {
    getCities: vi.fn(() => _mockCities),
    getBuildingLevel: vi.fn(() => 10), // taverna nível 10 → WINE_USE[10] = 60
    getCityIslandId: vi.fn((id) => _mockCache[id]?.islandId ?? 0),
  },
}));

import WineBalance from '../../modules/WineBalance.js';
import Port from '../../modules/Port.js';
import { WINE_USE } from '../../data/const.js';

function setupCity(id, wineAmount, capacity = 5000, islandId = 10) {
  _mockCache[id] = {
    resources: { wine: wineAmount },
    production: { wine: 50 },
    capacity,
    islandId,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  _mockCities.length = 0;
  Object.keys(_mockCache).forEach(k => delete _mockCache[k]);
  // Reset config para defaults
  await WineBalance.loadConfig();
  WineBalance.setConfig({ enabled: true, minHours: 24, targetHours: 72, sourceCityId: null });
});

// ─── statusOf ─────────────────────────────────────────────────────────────────

describe('WineBalance.statusOf()', () => {
  test('hoursLeft = wine / consumo_por_hora (taverna nível 10 = 60/h)', () => {
    setupCity(101, 600); // 600 wine, consumo 60/h → 10h
    const status = WineBalance.statusOf(101);
    expect(status.hoursLeft).toBeCloseTo(10, 1);
    expect(status.consumption).toBe(60); // WINE_USE[10]
  });

  test('critical = true quando hoursLeft < 6', () => {
    setupCity(101, 300); // 300/60 = 5h < 6h
    const status = WineBalance.statusOf(101);
    expect(status.critical).toBe(true);
    expect(status.low).toBe(true);
  });

  test('critical = false quando hoursLeft >= 6', () => {
    setupCity(101, 360); // 360/60 = 6h
    expect(WineBalance.statusOf(101).critical).toBe(false);
  });

  test('low = true quando hoursLeft < minHours (24)', () => {
    setupCity(101, 1200); // 1200/60 = 20h < 24h
    expect(WineBalance.statusOf(101).low).toBe(true);
  });

  test('low = false quando hoursLeft >= minHours', () => {
    setupCity(101, 1500); // 1500/60 = 25h > 24h
    expect(WineBalance.statusOf(101).low).toBe(false);
  });
});

// ─── Reserva de 20% da fonte ─────────────────────────────────────────────────

describe('WineBalance.check() — reserva 20% da fonte', () => {
  test('não envia se fonte não tem mais que 20% de reserva', () => {
    // cidade fonte com 1000 wine, cap 5000 → reserva = 5000*0.2 = 1000 → disponível = 0
    setupCity(1, 1000, 5000, 99); // fonte
    setupCity(2, 0,    5000, 10); // destino com 0h de vinho

    _mockCities.push({ id: 1 }, { id: 2 });
    WineBalance.setConfig({ sourceCityId: 1, enabled: true });

    const transfers = WineBalance.check();
    expect(transfers).toHaveLength(0);
    expect(Port.enqueue).not.toHaveBeenCalled();
  });

  test('envia somente o excedente da reserva (80%)', () => {
    // fonte: 4000 wine, cap 5000 → reserva=1000 → disponível=3000
    setupCity(1, 4000, 5000, 99);
    // destino: 0 wine → precisa de targetHours*consumo = 72*60=4320, mas cap=5000 → 4320
    setupCity(2, 0, 5000, 10);

    _mockCities.push({ id: 1 }, { id: 2 });
    WineBalance.setConfig({ sourceCityId: 1, enabled: true });

    const transfers = WineBalance.check();
    expect(transfers).toHaveLength(1);
    // Envia o min(needed=4320, available=3000) = 3000
    expect(transfers[0].amount).toBe(3000);
    expect(transfers[0].resource).toBe('wine');
  });

  test('usa wine_critical para cidade com < 6h', () => {
    setupCity(1, 4000, 5000, 99);
    setupCity(2, 300, 5000, 10); // 300/60 = 5h < 6h → critical

    _mockCities.push({ id: 1 }, { id: 2 });
    WineBalance.setConfig({ sourceCityId: 1, enabled: true });

    const transfers = WineBalance.check();
    expect(transfers[0].type).toBe('wine_critical');
  });

  test('usa wine (não critical) para cidade com 6-24h', () => {
    setupCity(1, 4000, 5000, 99);
    setupCity(2, 600, 5000, 10); // 600/60 = 10h → low mas não critical

    _mockCities.push({ id: 1 }, { id: 2 });
    WineBalance.setConfig({ sourceCityId: 1, enabled: true });

    const transfers = WineBalance.check();
    expect(transfers[0].type).toBe('wine');
  });

  test('não processa quando disabled', () => {
    WineBalance.setConfig({ enabled: false });
    const transfers = WineBalance.check();
    expect(transfers).toHaveLength(0);
    expect(Port.enqueue).not.toHaveBeenCalled();
  });
});

// ─── Detecção automática da fonte ─────────────────────────────────────────────

describe('WineBalance.getSourceCity()', () => {
  test('detects city with highest wine production', () => {
    _mockCache[1] = { production: { wine: 50 } };
    _mockCache[2] = { production: { wine: 200 } };
    _mockCache[3] = { production: { wine: 100 } };
    _mockCities.push({ id: 1 }, { id: 2 }, { id: 3 });

    const src = WineBalance.getSourceCity();
    expect(src.id).toBe(2);
  });
});

// ─── hasCritical ──────────────────────────────────────────────────────────────

describe('WineBalance.hasCritical()', () => {
  test('retorna true se qualquer cidade (non-source) está critical', () => {
    setupCity(1, 4000, 5000, 99); // fonte
    setupCity(2, 300,  5000, 10); // 5h → critical
    setupCity(3, 1000, 5000, 11); // ok

    _mockCities.push({ id: 1 }, { id: 2 }, { id: 3 });
    WineBalance.setConfig({ sourceCityId: 1 });

    expect(WineBalance.hasCritical()).toBe(true);
  });

  test('retorna false quando todas as cidades têm vinho suficiente', () => {
    setupCity(1, 4000, 5000, 99);
    setupCity(2, 1000, 5000, 10); // ~16h, não critical
    setupCity(3, 800,  5000, 11); // ~13h, não critical

    _mockCities.push({ id: 1 }, { id: 2 }, { id: 3 });
    WineBalance.setConfig({ sourceCityId: 1 });

    expect(WineBalance.hasCritical()).toBe(false);
  });
});
