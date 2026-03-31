import { TaskQueue } from '../../modules/TaskQueue.js';
import { GameError } from '../../modules/GameClient.js';

function createQueueHarness(overrides = {}) {
  const events = {
    E: {
      QUEUE_TASK_ADDED: 'queue:taskAdded',
      QUEUE_TASK_STARTED: 'queue:taskStarted',
      QUEUE_TASK_DONE: 'queue:taskDone',
      QUEUE_TASK_FAILED: 'queue:taskFailed',
      QUEUE_TASK_CANCELLED: 'queue:taskCancelled',
      QUEUE_MODE_CHANGED: 'queue:modeChanged',
    },
    emit: vi.fn(),
  };

  const audit = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const configData = {
    operationMode: 'FULL-AUTO',
    transportMinLoadFactor: 0.9,
    noiseFrequencyMin: 8,
    noiseFrequencyMax: 15,
    guardConsumesAttempt: true,
    ...overrides.config,
  };

  const config = {
    get: vi.fn((key) => configData[key]),
    set: vi.fn(async () => {}),
  };

  const cityMap = new Map([
    [101, { id: 101, name: 'Origem', freeTransporters: 20, maxTransporters: 20 }],
  ]);

  const state = {
    isProbing: vi.fn(() => false),
    getActiveCityId: vi.fn(() => 101),
    getCity: vi.fn((id) => cityMap.get(id) ?? null),
    ...overrides.state,
  };

  const client = {
    navigate: vi.fn(async () => {}),
    ...overrides.client,
  };

  const storage = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
  };

  const queue = new TaskQueue({ events, audit, config, state, client, storage });
  return { queue, events, audit, config, state, client, storage };
}

describe('TaskQueue transport guards', () => {
  test('rejeita payload sem destino', async () => {
    const { queue } = createQueueHarness();

    await expect(queue._guardTransport({
      payload: {
        fromCityId: 101,
        toCityId: null,
        toIslandId: 999,
        cargo: { wood: 500 },
        boats: 1,
      },
    })).rejects.toThrow(GameError);
  });

  test('rejeita origem = destino', async () => {
    const { queue } = createQueueHarness();

    await expect(queue._guardTransport({
      payload: {
        fromCityId: 101,
        toCityId: 101,
        toIslandId: 999,
        cargo: { wood: 500 },
        boats: 1,
      },
    })).rejects.toThrow(/origem e destino iguais/i);
  });

  test('rejeita carga vazia', async () => {
    const { queue } = createQueueHarness();

    await expect(queue._guardTransport({
      payload: {
        fromCityId: 101,
        toCityId: 202,
        toIslandId: 999,
        cargo: { wood: 0, wine: 0 },
        boats: 1,
      },
    })).rejects.toThrow(/carga vazia/i);
  });

  test('rejeita quando navios não cobrem maior coluna de carga', async () => {
    const { queue } = createQueueHarness();

    await expect(queue._guardTransport({
      payload: {
        fromCityId: 101,
        toCityId: 202,
        toIslandId: 999,
        cargo: { wood: 1600, wine: 100 }, // precisa 4 navios para madeira
        boats: 3,
      },
    })).rejects.toThrow(/navios insuficientes/i);
  });

  test('bloqueia carga pequena quando não essencial (load factor baixo)', async () => {
    const { queue } = createQueueHarness({ config: { transportMinLoadFactor: 0.9 } });

    await expect(queue._guardTransport({
      module: 'COO',
      payload: {
        fromCityId: 101,
        toCityId: 202,
        toIslandId: 999,
        cargo: { wood: 100 },
        boats: 1,
      },
    })).rejects.toThrow(/carga .*mínimo/i);
  });

  test('permite exceção controlada de load factor para JIT build', async () => {
    const { queue } = createQueueHarness({ config: { transportMinLoadFactor: 0.9 } });

    await expect(queue._guardTransport({
      module: 'COO',
      reasonCode: 'COO_JIT_TRANSPORT_FOR_BUILD',
      payload: {
        fromCityId: 101,
        toCityId: 202,
        toIslandId: 999,
        cargo: { wood: 100 },
        boats: 1,
        jitBuild: true,
      },
    })).resolves.not.toThrow();
  });

  test('permite exceção controlada de load factor para min-stock e overflow', async () => {
    const { queue } = createQueueHarness({ config: { transportMinLoadFactor: 0.9 } });

    await expect(queue._guardTransport({
      module: 'COO',
      payload: {
        fromCityId: 101,
        toCityId: 202,
        toIslandId: 999,
        cargo: { marble: 120 },
        boats: 1,
        minStock: true,
      },
    })).resolves.not.toThrow();

    await expect(queue._guardTransport({
      module: 'COO',
      payload: {
        fromCityId: 101,
        toCityId: 202,
        toIslandId: 999,
        cargo: { sulfur: 150 },
        boats: 1,
        overflowRelief: true,
      },
    })).resolves.not.toThrow();
  });
});

