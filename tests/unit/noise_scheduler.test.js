import { NoiseScheduler } from '../../modules/NoiseScheduler.js';

describe('NoiseScheduler', () => {
  test('schedules NOISE after threshold and resets counter', () => {
    const added = [];
    const scheduler = new NoiseScheduler({
      queue: { add: (t) => added.push(t) },
      state: { getAllCities: () => [{ id: 101 }, { id: 202 }] },
      config: { get: (k) => ({ noiseFrequencyMin: 1, noiseFrequencyMax: 2 }[k]) },
    });

    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0);
    scheduler.noteRealActionAndScheduleIfNeeded();

    expect(added).toHaveLength(1);
    expect(added[0].type).toBe('NOISE');
    expect(added[0].cityId).toBe(101);
    rnd.mockRestore();
  });
});

