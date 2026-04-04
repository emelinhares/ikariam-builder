import { Events } from '../../modules/Events.js';
import { Config } from '../../modules/Config.js';
import { StateManager } from '../../modules/StateManager.js';
import { TaskQueue } from '../../modules/TaskQueue.js';
import { CFO } from '../../modules/CFO.js';
import { COO } from '../../modules/COO.js';
import { HR } from '../../modules/HR.js';
import { Planner } from '../../modules/Planner.js';
import { TransportIntentRegistry } from '../../modules/TransportIntentRegistry.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async set(key, value) { map.set(key, value); },
    async remove(key) { map.delete(key); },
  };
}

function createAudit() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function seedCity(state, city) {
  state.cities.set(city.id, {
    ...state._createEmptyCityState(city.id, city),
    ...city,
    resources: {
      wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0,
      ...(city.resources ?? {}),
    },
    production: {
      wood: 0, tradegood: 0, wineSpendings: 0,
      ...(city.production ?? {}),
    },
    buildings: Array.isArray(city.buildings) ? city.buildings : [],
    tavern: { wineLevel: 0, winePerHour: 0, ...(city.tavern ?? {}) },
    workers: { wood: 0, tradegood: 0, scientists: 0, priests: 0, ...(city.workers ?? {}) },
    economy: {
      population: 0,
      maxInhabitants: 0,
      citizens: 0,
      goldPerHour: 0,
      corruption: 0,
      satisfaction: 20,
      growthPerHour: 0,
      actionPoints: 0,
      culturalGoods: 0,
      ...(city.economy ?? {}),
    },
    fetchedAt: Date.now(),
  });
}

export async function createIntegrationHarness({ cities = [], hooks = {}, enableTransportRegistry = false } = {}) {
  Events.clear();
  const events = Events;
  const storage = createMemoryStorage();
  const audit = createAudit();

  const config = new Config(storage);
  await config.init();

  const state = new StateManager({ events, audit, config });
  for (const city of cities) seedCity(state, city);
  if (cities[0]?.id) state.setActiveCityId(cities[0].id);

  const client = {
    acquireSession: vi.fn(async (fn) => fn()),
    probeCityData: vi.fn(async () => {}),
    fetchMilitaryAdvisor: vi.fn(async () => {}),
    navigate: vi.fn(async (cityId) => {
      state.setActiveCityId(cityId);
      return { ok: true };
    }),
    upgradeBuilding: vi.fn(async (...args) => {
      if (typeof hooks.onUpgradeBuilding === 'function') await hooks.onUpgradeBuilding(...args, state);
      return { ok: true, tokenRotated: true };
    }),
    sendTransport: vi.fn(async (...args) => {
      if (typeof hooks.onSendTransport === 'function') await hooks.onSendTransport(...args, state);
      return { ok: true, tokenRotated: true };
    }),
    setTavernWine: vi.fn(async (cityId, _pos, wineLevel) => {
      const city = state.cities.get(cityId);
      if (city) city.tavern.wineLevel = Number(wineLevel);
      return { ok: true, tokenRotated: true };
    }),
    setScientists: vi.fn(async (cityId, _pos, scientists) => {
      const city = state.cities.get(cityId);
      if (city) city.workers.scientists = Number(scientists);
      return { ok: true, tokenRotated: true };
    }),
    startResearch: vi.fn(async () => ({ ok: true, tokenRotated: true })),
  };

  const transportIntentRegistry = enableTransportRegistry
    ? new TransportIntentRegistry({ storage, audit, state })
    : null;
  if (transportIntentRegistry) await transportIntentRegistry.init();

  const queue = new TaskQueue({
    events,
    audit,
    config,
    state,
    client,
    storage,
    transportIntentRegistry,
  });
  const cfo = new CFO({ events, audit, config, state, queue });
  const coo = new COO({
    events,
    audit,
    config,
    state,
    queue,
    client,
    storage,
    transportIntentRegistry,
  });
  const hr = new HR({ events, audit, config, state, queue });
  const cto = { replan: vi.fn() };
  const cso = { replan: vi.fn() };
  const mna = { replan: vi.fn(async () => {}) };
  const planner = new Planner({ events, audit, config, state, queue, hr, cfo, coo, cto, cso, mna });

  queue.setCFO(cfo);

  return {
    events,
    storage,
    audit,
    config,
    state,
    client,
    queue,
    transportIntentRegistry,
    cfo,
    coo,
    hr,
    planner,
    async executeNextTask() {
      const next = queue.getPending().sort((a, b) => (a.priority - b.priority) || (a.scheduledFor - b.scheduledFor))[0];
      if (!next) return null;
      await queue._execute(next);
      return next;
    },
  };
}

