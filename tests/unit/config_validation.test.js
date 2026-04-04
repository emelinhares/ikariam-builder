import { Config } from '../../modules/Config.js';

describe('Config validation + deep merge', () => {
  test('init deep merges nested maxBuyPrice', async () => {
    const storage = {
      get: vi.fn(async () => ({
        maxBuyPrice: { wood: 1234 },
      })),
      set: vi.fn(async () => {}),
    };
    const cfg = new Config(storage);
    await cfg.init();

    const mbp = cfg.get('maxBuyPrice');
    expect(mbp.wood).toBe(1234);
    expect(mbp.wine).toBe(Infinity);
    expect(mbp.marble).toBe(Infinity);
  });

  test('set validates type/range', async () => {
    const storage = { get: vi.fn(async () => null), set: vi.fn(async () => {}) };
    const cfg = new Config(storage);
    await cfg.init();

    await expect(cfg.set('minStockFraction', 0.3)).resolves.toBeUndefined();
    await expect(cfg.set('minStockFraction', 3)).rejects.toThrow(/Config inválida/);
    await expect(cfg.set('operationMode', 'INVALID')).rejects.toThrow(/Config inválida/);
  });
});

