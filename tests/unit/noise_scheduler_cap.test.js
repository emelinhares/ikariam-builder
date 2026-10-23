import { NoiseScheduler } from '../../modules/NoiseScheduler.js';

describe('NoiseScheduler — um ruído por vez', () => {
  function harness(temRuidoPendente) {
    const queue = {
      add: vi.fn(),
      hasPendingType: vi.fn(() => temRuidoPendente),
    };
    const state = { getAllCities: vi.fn(() => [{ id: 1, name: 'Alpha' }]) };
    const config = { get: vi.fn((k) => ({ noiseFrequencyMin: 1, noiseFrequencyMax: 2 }[k])) };
    return { ns: new NoiseScheduler({ queue, state, config }), queue };
  }

  test('enfileira quando não há ruído pendente', () => {
    const { ns, queue } = harness(false);
    ns._scheduleNoise();
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  test('não enfileira um segundo ruído enquanto o primeiro espera', () => {
    const { ns, queue } = harness(true);
    ns._scheduleNoise();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
