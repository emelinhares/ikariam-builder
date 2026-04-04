export class CityStateUpdater {
  constructor({ audit = null } = {}) {
    this._audit = audit;
  }

  _ensureCity(state, cityId) {
    if (!state.cities.has(cityId)) {
      state.cities.set(cityId, state._createEmptyCityState(cityId, {}));
    }
    return state.cities.get(cityId);
  }

  _onHeaderData(state, { headerData, cityId }) {
    if (!cityId) return null;
    const city = this._ensureCity(state, cityId);

    const res = headerData?.currentResources;
    if (res) {
      city.resources.wood = Number(res.resource ?? res.wood ?? city.resources.wood);
      city.resources.wine = Number(res['1'] ?? res.wine ?? city.resources.wine);
      city.resources.marble = Number(res['2'] ?? res.marble ?? city.resources.marble);
      city.resources.glass = Number(res['3'] ?? res.glass ?? city.resources.glass);
      city.resources.sulfur = Number(res['4'] ?? res.sulfur ?? city.resources.sulfur);
    }

    const maxRes = headerData?.maxResources;
    if (maxRes) city.maxResources = Number(maxRes.resource ?? maxRes['0'] ?? city.maxResources);
    if (headerData?.freeTransporters !== undefined) city.freeTransporters = Number(headerData.freeTransporters);
    if (headerData?.maxTransporters !== undefined) city.maxTransporters = Number(headerData.maxTransporters);
    if (headerData?.wineSpendings !== undefined) city.production.wineSpendings = Number(headerData.wineSpendings);
    if (headerData?.income !== undefined) city.economy.goldPerHour = Number(headerData.income);
    if (headerData?._tavernWineLevel !== undefined && headerData._tavernWineLevel >= 0) {
      city.tavern.wineLevel = Number(headerData._tavernWineLevel);
    }

    city.fetchedAt = Date.now();
    return city;
  }

  _onScreenData(state, { screenData, cityId }) {
    if (!cityId) return null;
    const city = this._ensureCity(state, cityId);

    if (Array.isArray(screenData?.position)) {
      city.buildings = screenData.position.map((b, idx) => ({
        position: idx,
        building: (b.building ?? '').replace(/\s*constructionSite\s*/gi, '').trim() || (b.building ?? ''),
        level: Number(b.level ?? 0),
        isBusy: !!b.isBusy,
        isUpgrading: /constructionSite/i.test(b.building ?? ''),
        completed: b.completed ? Number(b.completed) : null,
      }));
      let upgIdx = city.buildings.findIndex((b) => b.isUpgrading);
      if (upgIdx === -1 && screenData?.underConstruction != null && screenData?.underConstruction !== false) {
        const uc = Number(screenData.underConstruction);
        if (uc >= 0) upgIdx = uc;
      }
      city.underConstruction = upgIdx;
    }

    if (screenData?.islandId && !city.islandId) city.islandId = Number(screenData.islandId);
    if (screenData?.satisfaction !== undefined) city.economy.satisfaction = Number(screenData.satisfaction);
    if (screenData?.inhabitants !== undefined) city.economy.population = Number(screenData.inhabitants);
    if (screenData?.citizens !== undefined) city.economy.citizens = Number(screenData.citizens);
    city.fetchedAt = Date.now();
    return city;
  }

  _onTownhallData(state, { cityId, params }) {
    if (!cityId || !params) return null;
    const city = this._ensureCity(state, cityId);

    const num = (v) => {
      const n = Number(String(v ?? '').replace(/,/g, ''));
      return Number.isFinite(n) ? n : undefined;
    };

    const pop = num(params.occupiedSpace ?? params.populationUsed);
    const maxInh = num(params.maxInhabitants);
    const sat = num(params.happinessLargeValue ?? params.satisfaction);

    if (pop !== undefined) city.economy.population = pop;
    if (maxInh !== undefined) city.economy.maxInhabitants = maxInh;
    if (sat !== undefined) city.economy.satisfaction = sat;

    city.fetchedAt = Date.now();
    this._audit?.debug?.('StateManager', `townHall data (updater): cidade ${cityId}`);
    return city;
  }
}

