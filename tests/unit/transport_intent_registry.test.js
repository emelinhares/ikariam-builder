import { TransportIntentRegistry, TRANSPORT_INTENT_STATUS } from '../../modules/TransportIntentRegistry.js';

describe('TransportIntentRegistry', () => {
  test('gera intentId estável por finalidade/origem/destino/recurso/bucket', () => {
    const id1 = TransportIntentRegistry.buildIntentId({
      purpose: 'jitBuild',
      fromCityId: 101,
      toCityId: 202,
      resource: 'wood',
      amount: 490,
    });
    const id2 = TransportIntentRegistry.buildIntentId({
      purpose: 'jitBuild',
      fromCityId: 101,
      toCityId: 202,
      resource: 'wood',
      amount: 500,
    });

    expect(id1).toBe('tp:jitBuild|f:101|t:202|r:wood|b:500');
    expect(id2).toBe(id1);
  });

  test('reconcilia loading no porto como operação iniciada e bloqueia reenqueue', () => {
    const storage = { get: vi.fn(async () => null), set: vi.fn(async () => {}) };
    const state = {
      fleetMovements: [
        {
          isOwn: true,
          isReturn: false,
          originCityId: 101,
          targetCityId: 202,
          cargo: { wood: 500 },
          state: 'loading',
          progressPct: 0,
        },
      ],
      getInTransit: vi.fn(() => ({ wood: 500 })),
    };
    const queue = { getActive: vi.fn(() => []), getHistory: vi.fn(() => []), getTransportReservations: vi.fn(() => []) };
    const registry = new TransportIntentRegistry({ storage, state, queue, audit: { warn: vi.fn() } });

    const result = registry.reconcileEquivalent({
      purpose: 'jitBuild',
      fromCityId: 101,
      toCityId: 202,
      resource: 'wood',
      amount: 500,
    });

    expect(result.shouldSkipEnqueue).toBe(true);
    expect(result.status).toBe(TRANSPORT_INTENT_STATUS.CONFIRMED_MOVING);
    expect(result.evidence.join('|')).toMatch(/fleetMovement=loading/);
  });

  test('ensureFromTaskData anexa intentId no payload do transporte', () => {
    const storage = { get: vi.fn(async () => null), set: vi.fn(async () => {}) };
    const registry = new TransportIntentRegistry({ storage, audit: { warn: vi.fn() } });

    const taskData = {
      type: 'TRANSPORT',
      cityId: 101,
      module: 'COO',
      payload: {
        fromCityId: 101,
        toCityId: 202,
        cargo: { marble: 1200 },
        minStock: true,
      },
    };

    const record = registry.ensureFromTaskData(taskData);

    expect(record.intentId).toBe('tp:minStock|f:101|t:202|r:marble|b:1500');
    expect(taskData.payload.intentId).toBe(record.intentId);
    expect(taskData.payload.transportIntent).toEqual(expect.objectContaining({
      purpose: 'minStock',
      resource: 'marble',
      amountBucket: 1500,
    }));
  });

  test('expira intent PLANNED sem despacho após timeout e libera novo enqueue', () => {
    const storage = { get: vi.fn(async () => null), set: vi.fn(async () => {}) };
    const queue = {
      getActive: vi.fn(() => []),
      getHistory: vi.fn(() => []),
      getTransportReservations: vi.fn(() => []),
    };
    const registry = new TransportIntentRegistry({ storage, queue, audit: { warn: vi.fn() } });

    const taskData = {
      type: 'TRANSPORT',
      cityId: 101,
      module: 'COO',
      payload: {
        fromCityId: 101,
        toCityId: 202,
        cargo: { wine: 500 },
        wineEmergency: true,
      },
    };

    const record = registry.ensureFromTaskData(taskData);

    const before = registry.reconcileEquivalent({
      purpose: 'wineEmergency',
      fromCityId: 101,
      toCityId: 202,
      resource: 'wine',
      amount: 500,
    });
    expect(before.shouldSkipEnqueue).toBe(true);
    expect(before.status).toBe(TRANSPORT_INTENT_STATUS.PLANNED);

    const stale = registry._records.get(record.intentId);
    stale.createdAt = Date.now() - (registry._plannedDispatchTtlMs + 1_000);
    stale.updatedAt = stale.createdAt;
    registry._expireOld(Date.now());

    const after = registry.reconcileEquivalent({
      purpose: 'wineEmergency',
      fromCityId: 101,
      toCityId: 202,
      resource: 'wine',
      amount: 500,
    });
    expect(after.shouldSkipEnqueue).toBe(false);
    expect(after.status).toBe(TRANSPORT_INTENT_STATUS.EXPIRED);
  });
});

