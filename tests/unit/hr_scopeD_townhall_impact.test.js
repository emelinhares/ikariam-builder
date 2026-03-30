import { HR } from '../../modules/HR.js';

function createHarness(cityOverrides = {}) {
  const handlers = new Map();
  const events = {
    E: {
      DC_HEADER_DATA: 'dc:headerData',
      HR_WORKER_REALLOC: 'hr:workerReallocated',
    },
    on: vi.fn((event, cb) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(cb);
    }),
    emit: vi.fn((event, payload) => {
      for (const cb of handlers.get(event) ?? []) cb(payload);
    }),
  };

  const audit = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const baseCity = {
    id: 77,
    name: 'Helios',
    resources: { wine: 0 },
    production: {
      wood: 300,
      tradegood: 160,
      wineSpendings: 0,
    },
    workers: {
      wood: 30,
      tradegood: 20,
      priests: 0,
      scientists: 10,
    },
    economy: {
      population: 100,
      citizens: 40,
      satisfaction: 2,
      goldPerHour: 0,
    },
    tavern: { wineLevel: 0 },
    buildings: [],
  };

  const city = {
    ...baseCity,
    ...cityOverrides,
    production: { ...baseCity.production, ...(cityOverrides.production ?? {}) },
    workers: { ...baseCity.workers, ...(cityOverrides.workers ?? {}) },
    economy: { ...baseCity.economy, ...(cityOverrides.economy ?? {}) },
  };

  const state = {
    getCity: vi.fn((cityId) => (cityId === city.id ? city : null)),
    getAllCities: vi.fn(() => [city]),
    isProbing: vi.fn(() => false),
    getActiveCityId: vi.fn(() => city.id),
    getConfidence: vi.fn(() => 'HIGH'),
  };

  const config = { get: vi.fn(() => 4) };
  const queue = { hasPendingType: vi.fn(() => false), getPending: vi.fn(() => []), add: vi.fn() };

  const hr = new HR({ events, audit, config, state, queue });
  return { hr, events, audit, city };
}

describe('HR Scope D — TownHall immediate impact simulator', () => {
  test('applies exact gold formula for before/after snapshots', () => {
    const { hr, city } = createHarness();

    const decision = hr.simulateTownHallImmediateImpact({
      cityId: city.id,
      allocationAfter: {
        workers: { wood: 30, tradegood: 20, priests: 0 },
        scientists: 25,
      },
      emitDecisionRecord: false,
    });

    // before = (40*3) - (50*3) - (10*6) = -90
    expect(decision.before.goldPerHour).toBe(-90);
    // after citizens inferred = 100 - (50 + 25) = 25
    // after = (25*3) - (50*3) - (25*6) = -225
    expect(decision.after.goldPerHour).toBe(-225);
    expect(decision.delta.goldPerHour).toBe(-135);
  });

  test('reports Δ wood/luxury production per hour comparing before vs after', () => {
    const { hr, city } = createHarness();

    const decision = hr.simulateTownHallImmediateImpact({
      cityId: city.id,
      allocationAfter: {
        workers: { wood: 20, tradegood: 30, priests: 0 },
        scientists: 10,
      },
      emitDecisionRecord: false,
    });

    // Per-worker base rates: wood=300/30 => 10 ; luxury=160/20 => 8
    expect(decision.before.woodPerHour).toBe(300);
    expect(decision.after.woodPerHour).toBe(200);
    expect(decision.delta.woodPerHour).toBe(-100);

    expect(decision.before.luxuryPerHour).toBe(160);
    expect(decision.after.luxuryPerHour).toBe(240);
    expect(decision.delta.luxuryPerHour).toBe(80);
  });

  test('emits actionable summary with reasonCode and evidence for scientist allocation', () => {
    const { hr, events, audit, city } = createHarness();
    hr.init();

    events.emit(events.E.HR_WORKER_REALLOC, {
      cityId: city.id,
      action: 'Alocando 15 cientistas',
      allocationAfter: {
        scientists: 25,
        workers: { wood: 30, tradegood: 20, priests: 0 },
      },
    });

    expect(audit.info).toHaveBeenCalled();
    const [, message, payload, loggedCityId] = audit.info.mock.calls.at(-1);

    expect(String(message)).toContain('Alocando 15 cientistas');
    expect(String(message)).toContain('gold/h');
    expect(String(message)).toContain('ciência/h');
    expect(String(message)).toContain('Impacto líquido');

    expect(loggedCityId).toBe(city.id);
    expect(payload.reasonCode).toBe('HR_TOWNHALL_IMMEDIATE_IMPACT');
    expect(Array.isArray(payload.evidence)).toBe(true);
    expect(payload.evidence.join(' | ')).toMatch(/goldFormula=\(citizens\*3\)-\(workers\*3\)-\(scientists\*6\)/);
    expect(payload.impact.delta.sciencePerHour).toBe(15);
  });
});

