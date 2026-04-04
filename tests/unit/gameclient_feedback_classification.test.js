import { GameClient } from '../../modules/GameClient.js';

function createClient() {
  const events = { E: {}, emit: vi.fn() };
  const audit = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const config = { get: vi.fn(() => 0) };
  const state = {
    getActiveCityId: vi.fn(() => 101),
    getCity: vi.fn(() => ({ id: 101, buildings: [{ building: 'tavern', position: 10 }] })),
    setActiveCityId: vi.fn(),
  };
  const dc = {
    getToken: vi.fn(() => 'token-1'),
    setToken: vi.fn(),
  };

  return new GameClient({ events, audit, config, state, dc });
}

describe('GameClient feedback classification for deterministic refusal', () => {
  test('classifies provideFeedback text "Recursos insuficientes" as deterministic resource refusal', () => {
    const client = createClient();
    const signals = client._extractSignals([
      ['provideFeedback', [{ location: 5, text: 'Recursos insuficientes ', type: 11 }]],
    ]);

    expect(signals.hasDeterministicResourceRefusal).toBe(true);
    expect(signals.hasFeedbackError).toBe(true);
    expect(signals.refusalReasonCode).toBe('SERVER_REFUSED_INSUFFICIENT_RESOURCES');
  });

  test('setTavernWine surfaces deterministic refusal metadata without throwing GUARD inconclusive', async () => {
    const client = createClient();
    client._enqueue = vi.fn(async (fn) => fn());
    client._postWithContext = vi.fn(async () => ({
      data: [
        ['provideFeedback', [{ location: 5, text: 'Recursos insuficientes ', type: 11 }]],
      ],
      tokenRotated: false,
    }));

    const result = await client.setTavernWine(101, 10, 1);

    expect(result.deterministicRefusal).toBe(true);
    expect(result.refusalReasonCode).toBe('SERVER_REFUSED_INSUFFICIENT_RESOURCES');
    expect(result.refusalMessage).toContain('Recursos insuficientes');
  });
});

