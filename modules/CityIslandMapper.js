const CITY_ISLAND_MAP_STORAGE_KEY = 'erp_state_city_island_map_v1';

export class CityIslandMapper {
  constructor({ audit = null } = {}) {
    this._audit = audit;
    this.cityToIsland = new Map();
    this.islandToCity = new Map();
  }

  register({ cityId, islandId } = {}) {
    const c = Number(cityId);
    const i = Number(islandId);
    if (!Number.isFinite(c) || c <= 0) return false;
    if (!Number.isFinite(i) || i <= 0) return false;
    this.cityToIsland.set(c, i);
    this.islandToCity.set(i, c);
    return true;
  }

  resolveCityIdByIslandId(islandId) {
    const i = Number(islandId);
    if (!Number.isFinite(i) || i <= 0) return null;
    return this.islandToCity.get(i) ?? null;
  }

  resolveIslandIdByCityId(cityId) {
    const c = Number(cityId);
    if (!Number.isFinite(c) || c <= 0) return null;
    return this.cityToIsland.get(c) ?? null;
  }

  persist() {
    try {
      const pairs = [...this.cityToIsland.entries()].map(([cityId, islandId]) => ({ cityId, islandId }));
      localStorage.setItem(CITY_ISLAND_MAP_STORAGE_KEY, JSON.stringify(pairs));
    } catch (err) {
      this._audit?.debug?.('StateManager', `persist city↔island map falhou: ${err.message}`);
    }
  }

  restore() {
    try {
      const raw = localStorage.getItem(CITY_ISLAND_MAP_STORAGE_KEY);
      if (!raw) return;
      const pairs = JSON.parse(raw);
      if (!Array.isArray(pairs)) return;
      for (const p of pairs) this.register(p);
    } catch {
      // ignore storage corruption
    }
  }
}

