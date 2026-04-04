import { checkCityOverflow, scheduleOverflowTransport } from '../../modules/OverflowDetector.js';

describe('OverflowDetector', () => {
  test('scheduleOverflowTransport builds transport payload', () => {
    const task = scheduleOverflowTransport({
      city: { id: 101, name: 'Src' },
      dest: { id: 202, name: 'Dst', islandId: 99 },
      resource: 'wood',
      amount: 1000,
      confidence: 'HIGH',
    });

    expect(task.type).toBe('TRANSPORT');
    expect(task.payload.cargo.wood).toBe(1000);
    expect(task.payload.toCityId).toBe(202);
    expect(task.payload.overflowRelief).toBe(true);
  });

  test('checkCityOverflow enqueues relief when city is near cap and destination has space', () => {
    const city = {
      id: 1,
      name: 'Src',
      maxResources: 10_000,
      resources: { wood: 9800, wine: 0, marble: 0, glass: 0, sulfur: 0 },
    };
    const dest = {
      id: 2,
      name: 'Dst',
      islandId: 88,
      maxResources: 10_000,
      resources: { wood: 1000, wine: 0, marble: 0, glass: 0, sulfur: 0 },
    };

    const queue = { getPending: () => [] };
    const state = {
      getCity: (id) => (id === 2 ? dest : city),
      getConfidence: () => 'HIGH',
    };
    const ledger = new Map([[1, { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 }]]);
    const classifications = new Map([[1, { overflowFlags: { wood: true }, productionPerHour: { wood: 500 } }]]);
    const enqueued = [];

    const scheduled = checkCityOverflow({
      city,
      classifications,
      ledger,
      queue,
      config: { overflowTargetTimeToCapHours: 6 },
      hub: dest,
      state,
      getReservedCoverage: () => 0,
      findOverflowDest: () => dest,
      enqueueTransportTask: (task) => enqueued.push(task),
      audit: { warn: vi.fn() },
    });

    expect(scheduled).toBe(1);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].payload.fromCityId).toBe(1);
    expect(enqueued[0].payload.toCityId).toBe(2);
  });
});

