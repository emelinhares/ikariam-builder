import { HR } from '../../modules/HR.js';

describe('HR wine emergency retry coordination', () => {
  test('reduces emergency cooldown when COO reports no available source', () => {
    const handlers = new Map();
    const events = {
      E: {
        DC_HEADER_DATA: 'dc:headerData',
        HR_WORKER_REALLOC: 'hr:workerReallocated',
        COO_WINE_EMERGENCY_FAILED: 'coo:wineEmergencyFailed',
        QUEUE_TASK_FAILED: 'queue:taskFailed',
      },
      on: vi.fn((event, cb) => {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event).push(cb);
        return () => {};
      }),
      emit: vi.fn((event, payload) => {
        for (const cb of handlers.get(event) ?? []) cb(payload);
      }),
    };

    const audit = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const config = { get: vi.fn((k) => (k === 'wineEmergencyHours' ? 4 : 0)) };
    const city = {
      id: 101,
      name: 'RetryCity',
      resources: { wine: 0 },
      production: { wineSpendings: 0 },
      tavern: { wineLevel: 0 },
      buildings: [{ building: 'tavern', level: 4 }],
      economy: { satisfaction: 0, population: 200, growthPerHour: -1 },
    };
    const state = {
      getAllCities: vi.fn(() => [city]),
      getCity: vi.fn(() => city),
      isProbing: vi.fn(() => false),
      getActiveCityId: vi.fn(() => city.id),
      getConfidence: vi.fn(() => 'HIGH'),
    };
    const queue = { hasPendingType: vi.fn(() => false), getPending: vi.fn(() => []), add: vi.fn() };

    const hr = new HR({ events, audit, config, state, queue });
    hr.init();

    const now = Date.now();
    hr._wineEmergencyCooldown.set(city.id, now);

    events.emit(events.E.COO_WINE_EMERGENCY_FAILED, {
      cityId: city.id,
      retryInMs: 2 * 60 * 1000,
    });

    const lastEmit = hr._wineEmergencyCooldown.get(city.id);
    expect(lastEmit).toBeLessThan(now);
    expect(now - lastEmit).toBeGreaterThanOrEqual(8 * 60 * 1000);
  });

  test('resets emergency cooldown when emergency WINE_ADJUST fails', () => {
    const handlers = new Map();
    const events = {
      E: {
        DC_HEADER_DATA: 'dc:headerData',
        HR_WORKER_REALLOC: 'hr:workerReallocated',
        COO_WINE_EMERGENCY_FAILED: 'coo:wineEmergencyFailed',
        QUEUE_TASK_FAILED: 'queue:taskFailed',
      },
      on: vi.fn((event, cb) => {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event).push(cb);
        return () => {};
      }),
      emit: vi.fn((event, payload) => {
        for (const cb of handlers.get(event) ?? []) cb(payload);
      }),
    };

    const audit = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const config = { get: vi.fn((k) => (k === 'wineEmergencyHours' ? 4 : 0)) };
    const city = {
      id: 101,
      name: 'RetryCity',
      resources: { wine: 0 },
      production: { wineSpendings: 0 },
      tavern: { wineLevel: 0 },
      buildings: [{ building: 'tavern', level: 4 }],
      economy: { satisfaction: 0, population: 200, growthPerHour: -1 },
    };
    const state = {
      getAllCities: vi.fn(() => [city]),
      getCity: vi.fn(() => city),
      isProbing: vi.fn(() => false),
      getActiveCityId: vi.fn(() => city.id),
      getConfidence: vi.fn(() => 'HIGH'),
    };
    const queue = { hasPendingType: vi.fn(() => false), getPending: vi.fn(() => []), add: vi.fn() };

    const hr = new HR({ events, audit, config, state, queue });
    hr.init();

    hr._wineEmergencyCooldown.set(city.id, Date.now());

    events.emit(events.E.QUEUE_TASK_FAILED, {
      task: {
        type: 'WINE_ADJUST',
        cityId: city.id,
        payload: { wineEmergency: true, wineLevel: 1 },
      },
      error: 'Recursos insuficientes',
      fatal: false,
    });

    expect(hr._wineEmergencyCooldown.has(city.id)).toBe(false);
  });
});

