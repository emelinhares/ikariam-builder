import { CityStateUpdater } from '../../modules/CityStateUpdater.js';

function createState() {
  return {
    cities: new Map(),
    _createEmptyCityState(id) {
      return {
        id,
        resources: { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 },
        maxResources: 0,
        production: { wineSpendings: 0 },
        economy: { goldPerHour: 0, satisfaction: null, population: 0, citizens: 0, maxInhabitants: 0 },
        tavern: { wineLevel: 0 },
        buildings: [],
        underConstruction: -1,
      };
    },
  };
}

describe('CityStateUpdater', () => {
  test('applies header data resource/economy fields', () => {
    const updater = new CityStateUpdater();
    const state = createState();

    const city = updater._onHeaderData(state, {
      cityId: 101,
      headerData: {
        currentResources: { resource: 1000, 1: 200, 2: 300, 3: 400, 4: 500 },
        maxResources: { resource: 10000 },
        wineSpendings: 50,
        income: 123,
        _tavernWineLevel: 2,
      },
    });

    expect(city.resources.wood).toBe(1000);
    expect(city.resources.wine).toBe(200);
    expect(city.maxResources).toBe(10000);
    expect(city.production.wineSpendings).toBe(50);
    expect(city.economy.goldPerHour).toBe(123);
    expect(city.tavern.wineLevel).toBe(2);
  });

  test('applies screen and townhall updates', () => {
    const updater = new CityStateUpdater({ audit: { debug: vi.fn() } });
    const state = createState();

    const city = updater._onScreenData(state, {
      cityId: 101,
      screenData: {
        position: [{ building: 'townHall', level: 3, isBusy: false }],
        underConstruction: 0,
        satisfaction: 6,
        inhabitants: 250,
        citizens: 120,
      },
    });
    expect(city.buildings).toHaveLength(1);
    expect(city.underConstruction).toBe(0);
    expect(city.economy.satisfaction).toBe(6);

    const city2 = updater._onTownhallData(state, {
      cityId: 101,
      params: { occupiedSpace: '260', maxInhabitants: '600', happinessLargeValue: '7' },
    });
    expect(city2.economy.population).toBe(260);
    expect(city2.economy.maxInhabitants).toBe(600);
    expect(city2.economy.satisfaction).toBe(7);
  });
});

