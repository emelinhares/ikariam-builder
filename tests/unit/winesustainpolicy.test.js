import { evaluateWineSustainPolicy, WINE_MODE } from '../../modules/WineSustainPolicy.js';

describe('WineSustainPolicy', () => {
  test('flags city with wine stock but zero consumption as sustain problem', () => {
    const city = {
      id: 10,
      resources: { wine: 600 },
      production: { wineSpendings: 0 },
      tavern: { wineLevel: 0 },
      buildings: [{ building: 'tavern', level: 6 }],
      economy: { satisfaction: 1, growthPerHour: 0 },
      typed: { populationUsed: 420, maxInhabitants: 520 },
    };

    const p = evaluateWineSustainPolicy({ city, emergencyHours: 4 });

    expect(p.wineMode).toBe(WINE_MODE.BOOTSTRAP_TAVERN);
    expect(p.needsTavernBootstrap).toBe(true);
    expect(p.needsTavernAdjustment).toBe(true);
    expect(p.wineReasons).toEqual(expect.arrayContaining(['wine_available_but_not_consumed']));
  });

  test('flags city with no wine as critical and requiring import', () => {
    const city = {
      id: 11,
      resources: { wine: 0 },
      production: { wineSpendings: 0 },
      tavern: { wineLevel: 0 },
      buildings: [{ building: 'tavern', level: 4 }],
      economy: { satisfaction: -1, growthPerHour: -2 },
      typed: { populationUsed: 390, maxInhabitants: 400 },
    };

    const p = evaluateWineSustainPolicy({ city, emergencyHours: 4 });

    expect(p.wineMode).toBe(WINE_MODE.CRITICAL_NO_WINE);
    expect(p.needsWineImport).toBe(true);
    expect(p.wineRiskLevel).toBe('CRITICAL');
    expect(p.targetWineLevel).toBeGreaterThanOrEqual(1);
  });

  test('uses WINE_USE[1] fallback spendings when tavern consumption is zero', () => {
    const city = {
      id: 12,
      resources: { wine: 0 },
      production: { wineSpendings: 0 },
      tavern: { wineLevel: 0 },
      buildings: [{ building: 'tavern', level: 5 }],
      economy: { satisfaction: 0, growthPerHour: 0 },
      typed: { populationUsed: 300, maxInhabitants: 500 },
    };

    const p = evaluateWineSustainPolicy({ city, emergencyHours: 4 });

    expect(p.effectiveWineSpendings).toBe(0);
    expect(p.targetWineAmount).toBe(48);
  });

  test('BOOTSTRAP_TAVERN also enforces non-zero fallback targetWineAmount', () => {
    const city = {
      id: 13,
      resources: { wine: 300 },
      production: { wineSpendings: 0 },
      tavern: { wineLevel: 0 },
      buildings: [{ building: 'tavern', level: 5 }],
      economy: { satisfaction: 0, growthPerHour: 0 },
      typed: { populationUsed: 300, maxInhabitants: 500 },
    };

    const p = evaluateWineSustainPolicy({ city, emergencyHours: 4 });

    expect(p.wineMode).toBe(WINE_MODE.BOOTSTRAP_TAVERN);
    expect(p.targetWineAmount).toBe(48);
  });
});

