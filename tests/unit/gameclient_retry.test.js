import { GameClient, GameError } from '../../modules/GameClient.js';

function createClient() {
  const events = {
    E: { QUEUE_BLOCKED: 'queue:blocked' },
    emit: vi.fn(),
  };
  const audit = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const config = { get: vi.fn(() => 0) };
  const state = {
    getActiveCityId: vi.fn(() => 101),
    getCity: vi.fn(() => ({ id: 101, buildings: [{ building: 'port', position: 1 }] })),
    setActiveCityId: vi.fn(),
  };
  const dc = {
    getToken: vi.fn(() => 'token-1'),
    setToken: vi.fn(),
  };

  return { client: new GameClient({ events, audit, config, state, dc }), events, audit };
}

describe('GameClient retry helper and circuit breaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('retries with backoff and succeeds on later attempt', async () => {
    const { client } = createClient();
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new GameError('HTTP_ERROR', `transient-${calls}`);
      return 'ok';
    });

    const promise = client._retryWithBackoff(fn, { label: 'test-op', maxAttempts: 3 });
    await vi.runAllTimersAsync();
    const out = await promise;

    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(client._consecutiveFailures).toBe(0);
  });

  test('aborts immediately on fatal error without retry', async () => {
    const { client } = createClient();
    const fn = vi.fn(async () => {
      throw new GameError('PARSE_ERROR', 'fatal parse');
    });

    await expect(client._retryWithBackoff(fn, { label: 'fatal-op', maxAttempts: 3 }))
      .rejects.toMatchObject({ type: 'PARSE_ERROR' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('opens circuit breaker after 5 consecutive failures and blocks new requests', async () => {
    const { client, events } = createClient();
    const failFn = vi.fn(async () => {
      throw new GameError('HTTP_ERROR', 'network down');
    });

    for (let i = 0; i < 5; i += 1) {
      await expect(client._retryWithBackoff(failFn, { label: 'fail', maxAttempts: 1 }))
        .rejects.toMatchObject({ type: 'HTTP_ERROR' });
    }

    expect(client._circuitOpenUntil).toBeGreaterThan(Date.now());
    expect(events.emit).toHaveBeenCalledWith(
      'queue:blocked',
      expect.objectContaining({ reason: expect.stringContaining('circuit breaker aberto') })
    );

    const blockedFn = vi.fn(async () => 'should-not-run');
    await expect(client._retryWithBackoff(blockedFn, { label: 'blocked', maxAttempts: 1 }))
      .rejects.toMatchObject({
        type: 'GUARD',
        meta: expect.objectContaining({ code: 'GAMECLIENT_CIRCUIT_OPEN' }),
      });
    expect(blockedFn).not.toHaveBeenCalled();
  });

  test('resets circuit breaker after cooldown and allows requests again', async () => {
    const { client } = createClient();
    const failFn = vi.fn(async () => {
      throw new GameError('HTTP_ERROR', 'network down');
    });

    for (let i = 0; i < 5; i += 1) {
      await expect(client._retryWithBackoff(failFn, { label: 'fail', maxAttempts: 1 }))
        .rejects.toMatchObject({ type: 'HTTP_ERROR' });
    }

    vi.advanceTimersByTime(60_000);

    const successFn = vi.fn(async () => 'recovered');
    const out = await client._retryWithBackoff(successFn, { label: 'recover', maxAttempts: 1 });

    expect(out).toBe('recovered');
    expect(successFn).toHaveBeenCalledTimes(1);
    expect(client._circuitOpenUntil).toBe(0);
    expect(client._consecutiveFailures).toBe(0);
  });
});

