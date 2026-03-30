import { CFO } from '../../modules/CFO.js';

function createCfoHarness(overrides = {}) {
  const events = {
    E: {
      QUEUE_TASK_DONE: 'queue:taskDone',
      CFO_BUILD_APPROVED: 'cfo:buildApproved',
      CFO_BUILD_BLOCKED: 'cfo:buildBlocked',
    },
    on: vi.fn(),
    emit: vi.fn(),
  };

  const audit = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const city = {
    id: 101,
    name: 'Alpha',
    economy: {
      goldPerHour: 500,
      corruption: 0,
      population: 200,
      maxInhabitants: 600,
      growthPerHour: 30,
      satisfaction: 3,
    },
    workers: { scientists: 10 },
    resources: {
      wood: 10_000,
      wine: 2_000,
      marble: 10_000,
      glass: 10_000,
      sulfur: 10_000,
    },
    maxResources: {
      wood: 20_000,
      wine: 20_000,
      marble: 20_000,
      glass: 20_000,
      sulfur: 20_000,
    },
    lockedPositions: new Set(),
    buildings: [{ building: 'townHall', level: 0, position: 3 }],
    ...overrides.city,
  };

  const state = {
    research: { investigated: new Set() },
    getCity: vi.fn(() => city),
    getAllCities: vi.fn(() => [city]),
    getConfidence: vi.fn(() => 'HIGH'),
    getUnderConstruction: vi.fn(() => -1),
    getInTransit: vi.fn(() => ({})),
    ...overrides.state,
  };

  const queue = {
    hasPendingBuild: vi.fn(() => false),
    getPending: vi.fn(() => []),
    add: vi.fn(),
    ...overrides.queue,
  };

  const configMap = {
    roiThreshold: 2,
    goldProjectionHours: 12,
    ...overrides.config,
  };
  const config = {
    get: vi.fn((k) => configMap[k]),
  };

  const cfo = new CFO({ events, audit, config, state, queue });
  return { cfo, events, audit, state, queue, city };
}

describe('CFO Scope A (ROI + dedupe + rich reasons)', () => {
  test('dynamic ROI decreases as payback gets longer (townHall low lvl vs high lvl)', () => {
    const { cfo, city } = createCfoHarness();

    const roiL1 = cfo._calcROI('townHall', 1, 0, city);
    const roiL30 = cfo._calcROI('townHall', 30, 29, city);

    expect(roiL1).toBeGreaterThan(roiL30);
    expect(roiL1).toBeGreaterThan(roiL30 + 1);
  });

  test('blocks duplicate BUILD signature even when hasPendingBuild=false', () => {
    const duplicatePayload = {
      building: 'townHall',
      buildingView: 'townHall',
      position: 3,
      toLevel: 1,
    };

    const { cfo, queue, events } = createCfoHarness({
      queue: {
        hasPendingBuild: vi.fn(() => false),
        getPending: vi.fn(() => [
          { type: 'BUILD', cityId: 101, status: 'pending', payload: duplicatePayload },
        ]),
        add: vi.fn(),
      },
    });

    cfo.evaluateCity(101);

    expect(queue.add).not.toHaveBeenCalled();
    const blockedEvent = events.emit.mock.calls.find(
      ([evtName]) => evtName === events.E.CFO_BUILD_BLOCKED,
    );
    expect(blockedEvent).toBeTruthy();
    expect(blockedEvent[1].reasonCode).toBe('DUPLICATE_BUILD_SIGNATURE');
    expect(blockedEvent[1].reasonDetails.signature).toBe('townHall@3->1');
  });

  test('emits structured reasonDetails on ROI block and logs reason code', () => {
    const { cfo, events, audit, queue } = createCfoHarness({
      config: {
        roiThreshold: 11,
      },
    });

    cfo.evaluateCity(101);

    expect(queue.add).not.toHaveBeenCalled();
    const blockedEvent = events.emit.mock.calls.find(
      ([evtName]) => evtName === events.E.CFO_BUILD_BLOCKED,
    );
    expect(blockedEvent).toBeTruthy();
    expect(blockedEvent[1].reasonCode).toBe('ROI_BELOW_THRESHOLD');
    expect(blockedEvent[1].reasonDetails).toMatchObject({
      code: 'ROI_BELOW_THRESHOLD',
      building: 'townHall',
      toLevel: 1,
      roiThreshold: 11,
    });

    const infoMessages = audit.info.mock.calls.map(([, message]) => String(message));
    expect(infoMessages.some(m => m.includes('code=ROI_BELOW_THRESHOLD'))).toBe(true);
  });

  test('emits structured approval details and keeps queue add for valid candidate', () => {
    const { cfo, events, queue } = createCfoHarness();

    cfo.evaluateCity(101);

    expect(queue.add).toHaveBeenCalledTimes(1);

    const approvedEvent = events.emit.mock.calls.find(
      ([evtName]) => evtName === events.E.CFO_BUILD_APPROVED,
    );
    expect(approvedEvent).toBeTruthy();
    expect(approvedEvent[1].reasonCode).toBe('BUILD_APPROVED');
    expect(approvedEvent[1].reasonDetails).toMatchObject({
      code: 'BUILD_APPROVED',
      signature: 'townHall@3->1',
      building: 'townHall',
      position: 3,
      toLevel: 1,
    });
  });

  test('Scope D: local fail + global pass enfileira BUILD em waiting_resources com diagnóstico de caixa único', () => {
    const sourceCity = {
      id: 202,
      name: 'Beta',
      resources: {
        wood: 50_000,
        wine: 5_000,
        marble: 50_000,
        glass: 50_000,
        sulfur: 50_000,
      },
      maxResources: 100_000,
      economy: { goldPerHour: 500, corruption: 0 },
      lockedPositions: new Set(),
      buildings: [{ building: 'warehouse', level: 10, position: 4 }],
    };

    const { cfo, queue, events, state } = createCfoHarness({
      city: {
        resources: {
          wood: 0,
          wine: 0,
          marble: 0,
          glass: 0,
          sulfur: 0,
        },
      },
      config: {
        minStockFraction: 0.2,
      },
      state: {
        getAllCities: vi.fn(() => []),
      },
    });

    const localCity = state.getCity();
    state.getAllCities.mockReturnValue([localCity, sourceCity]);

    cfo.evaluateCity(101);

    expect(queue.add).toHaveBeenCalledTimes(1);
    const addedBuild = queue.add.mock.calls[0][0];
    expect(addedBuild.type).toBe('BUILD');
    expect(addedBuild.status).toBe('waiting_resources');
    expect(addedBuild.payload.waitingResources).toBe(true);
    expect(addedBuild.reasonCode).toBe('BUILD_WAITING_RESOURCES_GLOBAL_TREASURY');

    const approvedEvent = events.emit.mock.calls.find(
      ([evtName]) => evtName === events.E.CFO_BUILD_APPROVED,
    );
    expect(approvedEvent).toBeTruthy();
    expect(approvedEvent[1].reasonCode).toBe('BUILD_WAITING_RESOURCES_GLOBAL_TREASURY');
    expect(approvedEvent[1].reasonDetails.chosenAction).toBe('WAITING_RESOURCES_AND_REQUEST_JIT');
    expect(Array.isArray(approvedEvent[1].evidence)).toBe(true);
    expect(approvedEvent[1].evidence.join(' | ')).toMatch(/action=WAITING_RESOURCES_AND_REQUEST_JIT/i);
  });
});

