import { createSafeStorage } from '../../modules/SafeStorage.js';

describe('createSafeStorage()', () => {
  test('get/set/remove passam quando storage funciona', async () => {
    const storage = {
      get: vi.fn(async () => 123),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };

    const safe = createSafeStorage(storage, { module: 'Spec' });

    await expect(safe.get('k')).resolves.toBe(123);
    await expect(safe.set('k', 'v')).resolves.toBe(true);
    await expect(safe.remove('k')).resolves.toBe(true);
  });

  test('retorna fallback em get e loga warning ao falhar', async () => {
    const err = new Error('boom-get');
    const storage = {
      get: vi.fn(async () => { throw err; }),
    };
    const warn = vi.fn();
    const audit = { warn: vi.fn() };

    const safe = createSafeStorage(storage, { module: 'Spec', warn, audit });

    await expect(safe.get('missing', 'fallback')).resolves.toBe('fallback');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(audit.warn).toHaveBeenCalledTimes(1);
  });

  test('set/remove retornam false e logam warning ao falhar', async () => {
    const errSet = new Error('boom-set');
    const errRemove = new Error('boom-remove');
    const storage = {
      set: vi.fn(async () => { throw errSet; }),
      remove: vi.fn(async () => { throw errRemove; }),
    };
    const warn = vi.fn();
    const audit = { warn: vi.fn() };

    const safe = createSafeStorage(storage, { module: 'Spec', warn, audit });

    await expect(safe.set('a', 1)).resolves.toBe(false);
    await expect(safe.remove('a')).resolves.toBe(false);

    expect(warn).toHaveBeenCalledTimes(2);
    expect(audit.warn).toHaveBeenCalledTimes(2);
  });
});

