import { TaskGuards } from '../../modules/TaskGuards.js';
import { TASK_TYPE } from '../../modules/taskTypes.js';
import { GameError } from '../../modules/GameClient.js';

function createHarness(overrides = {}) {
  const audit = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    ...(overrides.audit ?? {}),
  };

  const configData = {
    transportMinLoadFactor: 0.9,
    ...(overrides.configData ?? {}),
  };

  const config = {
    get: vi.fn((key) => configData[key]),
    ...(overrides.config ?? {}),
  };

  const cityMap = new Map([
    [101, {
      id: 101,
      name: 'Alpha',
      underConstruction: -1,
      lockedPositions: new Set(),
      freeTransporters: 20,
      maxTransporters: 20,
      buildings: {},
    }],
  ]);

  const state = {
    getActiveCityId: vi.fn(() => 101),
    getCity: vi.fn((id) => cityMap.get(Number(id)) ?? null),
    ...(overrides.state ?? {}),
  };

  const client = {
    navigate: vi.fn(async () => {}),
    ...(overrides.client ?? {}),
  };

  const reschedule = vi.fn();
  const cancelTask = vi.fn();
  const getCFO = overrides.getCFO ?? vi.fn(() => null);
  const getPendingTasks = overrides.getPendingTasks ?? (() => []);

  const guards = new TaskGuards({
    state,
    client,
    audit,
    config,
    getCFO,
    reschedule,
    cancelTask,
    getPendingTasks,
  });

  return {
    guards,
    state,
    client,
    audit,
    config,
    getCFO,
    reschedule,
    cancelTask,
    cityMap,
  };
}

describe('TaskGuards', () => {
  test('runGuards delegates BUILD to guardBuild', async () => {
    const { guards } = createHarness();
    const spy = vi.spyOn(guards, 'guardBuild').mockResolvedValue(undefined);

    await guards.runGuards({ type: TASK_TYPE.BUILD, cityId: 101, payload: { position: 1 } });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('guardNavigate navigates when active city differs', async () => {
    const { guards, client } = createHarness({
      state: {
        getActiveCityId: vi.fn(() => 202),
      },
    });

    await guards.guardNavigate(101);

    expect(client.navigate).toHaveBeenCalledWith(101);
  });

  test('guardBuild cancels task when another slot is already under construction', async () => {
    const { guards, cancelTask, cityMap } = createHarness();
    cityMap.set(101, {
      id: 101,
      name: 'Alpha',
      underConstruction: 5,
      lockedPositions: new Set(),
      buildings: { 5: { building: 'academy', completed: Math.floor(Date.now() / 1000) + 3600 } },
    });

    const task = {
      type: TASK_TYPE.BUILD,
      cityId: 101,
      status: 'pending',
      payload: { position: 3, building: 'wall', buildingView: 'wall' },
    };

    await expect(guards.guardBuild(task)).rejects.toThrow(GameError);
    expect(task.status).toBe('cancelled');
    expect(cancelTask).toHaveBeenCalledWith(task);
  });

  test('guardBuild reschedules when resources are insufficient', async () => {
    const cfo = { canAfford: vi.fn(() => false) };
    const { guards, reschedule } = createHarness({
      getCFO: vi.fn(() => cfo),
    });

    const task = {
      type: TASK_TYPE.BUILD,
      cityId: 101,
      payload: {
        position: 1,
        building: 'warehouse',
        buildingView: 'warehouse',
        cost: { wood: 1000 },
      },
    };

    await expect(guards.guardBuild(task)).rejects.toThrow(/recursos insuficientes/i);
    expect(reschedule).toHaveBeenCalledWith(task, 3_600_000, 'GUARD_BUILD_INSUFFICIENT_RESOURCES');
  });

  test('guardTransport rejects empty cargo', async () => {
    const { guards } = createHarness();

    await expect(guards.guardTransport({
      type: TASK_TYPE.TRANSPORT,
      payload: {
        fromCityId: 101,
        toCityId: 202,
        toIslandId: 77,
        cargo: { wood: 0, wine: 0 },
        boats: 1,
      },
    })).rejects.toThrow(/carga vazia/i);
  });

  test('guardTransport reschedules when no free boats', async () => {
    const { guards, reschedule, cityMap } = createHarness();
    cityMap.set(101, {
      id: 101,
      name: 'Alpha',
      underConstruction: -1,
      lockedPositions: new Set(),
      freeTransporters: 1,
      maxTransporters: 20,
      buildings: {},
    });

    const task = {
      type: TASK_TYPE.TRANSPORT,
      payload: {
        fromCityId: 101,
        toCityId: 202,
        toIslandId: 77,
        cargo: { wood: 1000 },
        boats: 2,
        estimatedReturnS: 1200,
      },
    };

    await expect(guards.guardTransport(task)).rejects.toThrow(/sem barcos livres/i);
    expect(reschedule).toHaveBeenCalledWith(task, 1_200_000, 'GUARD_TRANSPORT_NO_FREE_BOATS');
  });

  test('guardWineAdjust reschedules when city has zero wine and target level > 0', async () => {
    const { guards, reschedule, cityMap } = createHarness();
    cityMap.set(101, {
      id: 101,
      name: 'Alpha',
      underConstruction: -1,
      lockedPositions: new Set(),
      freeTransporters: 20,
      maxTransporters: 20,
      buildings: {},
      tavern: { wineLevel: 0 },
      resources: { wine: 0 },
    });

    const task = {
      type: TASK_TYPE.WINE_ADJUST,
      cityId: 101,
      payload: { wineLevel: 1, wineEmergency: true },
      status: 'pending',
    };

    await expect(guards.guardWineAdjust(task)).rejects.toThrow(/sem vinho disponível/i);
    expect(reschedule).toHaveBeenCalledWith(task, 60_000, 'GUARD_WINE_STOCK_EMPTY');
  });

  test('guardWineAdjust waits a bit longer when emergency wine transport is already pending', async () => {
    const { guards, reschedule, cityMap } = createHarness({
      getPendingTasks: () => ([
        {
          type: TASK_TYPE.TRANSPORT,
          status: 'pending',
          payload: {
            toCityId: 101,
            wineEmergency: true,
            cargo: { wine: 200 },
          },
        },
      ]),
    });

    cityMap.set(101, {
      id: 101,
      name: 'Alpha',
      underConstruction: -1,
      lockedPositions: new Set(),
      freeTransporters: 20,
      maxTransporters: 20,
      buildings: {},
      tavern: { wineLevel: 0 },
      resources: { wine: 0 },
    });

    const task = {
      type: TASK_TYPE.WINE_ADJUST,
      cityId: 101,
      payload: { wineLevel: 1, wineEmergency: true },
      status: 'pending',
    };

    await expect(guards.guardWineAdjust(task)).rejects.toThrow(/aguardando transporte de emergência/i);
    expect(reschedule).toHaveBeenCalledWith(task, 90_000, 'GUARD_WINE_AWAITING_EMERGENCY_TRANSPORT');
  });
});

