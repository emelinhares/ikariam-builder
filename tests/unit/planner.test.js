import { Planner } from '../../modules/Planner.js';

function createPlannerHarness(overrides = {}) {
  const listeners = new Map();
  const events = {
    E: {
      STATE_ALL_FRESH: 'state:allFresh',
      QUEUE_TASK_DONE: 'queue:taskDone',
      QUEUE_TASK_FAILED: 'queue:taskFailed',
      HR_WINE_EMERGENCY: 'hr:wineEmergency',
      HR_WINE_ADJUSTED: 'hr:wineAdjusted',
      PLANNER_CYCLE_START: 'planner:cycleStart',
      PLANNER_CYCLE_DONE: 'planner:cycleDone',
    },
    on: vi.fn((evt, cb) => listeners.set(evt, cb)),
    emit: vi.fn(),
    _listeners: listeners,
  };

  const audit = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const configMap = {
    wineEmergencyHours: 4,
    ...overrides.config,
  };
  const config = {
    get: vi.fn((k) => configMap[k]),
  };

  const cities = [
    {
      id: 101,
      name: 'A',
      resources: { wine: 20 },
      production: { wineSpendings: 10 },
      tavern: { wineLevel: 1 },
      economy: { satisfaction: 5 },
      underConstruction: -1,
      buildings: [],
    },
    {
      id: 202,
      name: 'B',
      resources: { wine: 80 },
      production: { wineSpendings: 0 },
      tavern: { wineLevel: 2 },
      economy: { satisfaction: 3 },
      underConstruction: -1,
      buildings: [],
    },
    {
      id: 303,
      name: 'C',
      resources: { wine: 0 },
      production: { wineSpendings: 0 },
      tavern: { wineLevel: 0 },
      economy: { satisfaction: -1 },
      underConstruction: -1,
      buildings: [],
    },
  ];
  const cityMap = new Map(cities.map(c => [c.id, c]));

  const state = {
    getAllCities: vi.fn(() => cities),
    getCity: vi.fn((id) => cityMap.get(id) ?? null),
    getServerNowMs: vi.fn(() => 1_700_000_000_000),
    fleetMovements: [],
    ...overrides.state,
  };

  const queue = {
    getPending: vi.fn(() => ([
      { type: 'TRANSPORT', payload: { toCityId: 202 } },
      { type: 'BUILD', payload: { toCityId: 202 } },
    ])),
    ...overrides.queue,
  };

  const hr = { replan: vi.fn() };
  const cfo = {
    replan: vi.fn((ctx) => {
      const cityCtx = ctx.cities.get(202);
      if (cityCtx) cityCtx.buildApprovedBy = 'CFO';
    }),
  };
  const coo = { replan: vi.fn() };
  const cto = { replan: vi.fn() };
  const cso = { replan: vi.fn() };
  const mna = { replan: vi.fn(async () => {}) };

  const planner = new Planner({
    events,
    audit,
    config,
    state,
    queue,
    hr,
    cfo,
    coo,
    cto,
    cso,
    mna,
    ...overrides.deps,
  });

  return { planner, events, audit, state, queue, hr, cfo, coo, cto, cso, mna };
}

describe('Planner', () => {
  test('builda contexto com cidade crítica e pending transports por destino', () => {
    const { planner } = createPlannerHarness();

    const ctx = planner._buildContext(Date.now());

    const c101 = ctx.cities.get(101);
    const c202 = ctx.cities.get(202);
    const c303 = ctx.cities.get(303);

    expect(c101.wineHours).toBe(2);
    expect(c101.hasCriticalSupply).toBe(true);

    // fallback de wineSpendings usa WINE_USE[tavern.wineLevel] (=8 no nível 2)
    expect(c202.wineHours).toBe(10);
    expect(c202.hasCriticalSupply).toBe(false);
    expect(c202.pendingTransports).toHaveLength(1);

    // satisfação <= 0 bloqueia mesmo sem consumo de vinho
    expect(c303.wineHours).toBe(Infinity);
    expect(c303.hasCriticalSupply).toBe(true);

    expect(c303.wineBootstrapNeeded).toBeFalsy();

    expect(ctx.stage).toBe('MULTI_CITY_EARLY');
    expect(ctx.globalGoal).toBe('SURVIVE');
    expect(ctx.goalReason).toBe('critical_supply_or_cashflow_pressure');
    expect(ctx.growthPolicy).toBeTruthy();
    expect(ctx.growthPolicy.growthStage).toBe('CONSOLIDATE_NEW_CITY');
    expect(Array.isArray(ctx.growthPolicy.milestoneBlockingFactors)).toBe(true);
    expect(typeof ctx.readiness.workforceReadiness).toBe('number');
    expect(Array.isArray(ctx.readiness.blockingFactors)).toBe(true);
    expect(ctx.workforcePolicy).toBeTruthy();

    const wf202 = ctx.cities.get(202);
    expect(typeof wf202.idlePopulation).toBe('number');
    expect(typeof wf202.workforceUtilization).toBe('number');
    expect(typeof wf202.productionFloorMet).toBe('boolean');
    expect(Array.isArray(wf202.workforceBlockingFactors)).toBe(true);
    expect(Array.isArray(wf202.workforceReasons)).toBe(true);
  });

  test('marca buildBlocked apenas para cidades com emergência', () => {
    const { planner } = createPlannerHarness();
    const ctx = planner._buildContext(Date.now());

    planner._markBuildBlocked(ctx);

    expect(ctx.cities.get(101).buildBlocked).toBe(true);
    expect(ctx.cities.get(202).buildBlocked).toBe(false);
    expect(ctx.cities.get(303).buildBlocked).toBe(true);
  });

  test('marca cidade como crítica por wine bootstrap mesmo sem wineSpendings ativos', () => {
    const { planner } = createPlannerHarness({
      state: {
        getAllCities: vi.fn(() => ([
          {
            id: 909,
            name: 'BootstrapTown',
            resources: { wine: 0 },
            production: { wineSpendings: 0 },
            tavern: { wineLevel: 0 },
            buildings: [{ building: 'tavern', level: 4 }],
            typed: { populationGrowthPerHour: 0, populationUtilization: 0.95 },
            economy: { satisfaction: 1, population: 330, maxInhabitants: 340 },
            underConstruction: -1,
          },
        ])),
      },
      queue: {
        getPending: vi.fn(() => []),
      },
    });

    const ctx = planner._buildContext(Date.now());
    const c909 = ctx.cities.get(909);
    expect(c909.wineHours).toBe(Infinity);
    expect(c909.wineBootstrapNeeded).toBe(true);
    expect(c909.hasCriticalSupply).toBe(true);
  });

  test('executa fases na ordem e emite resumo do ciclo', async () => {
    const { planner, hr, coo, cfo, cto, cso, mna, events } = createPlannerHarness();
    const order = [];

    hr.replan.mockImplementation(() => order.push('HR'));
    coo.replan.mockImplementation(() => order.push('COO'));
    cfo.replan.mockImplementation((ctx) => {
      order.push('CFO');
      const cityCtx = ctx.cities.get(202);
      if (cityCtx) cityCtx.buildApprovedBy = 'CFO';
    });
    cto.replan.mockImplementation(() => order.push('CTO'));
    cso.replan.mockImplementation(() => order.push('CSO'));
    mna.replan.mockImplementation(async () => { order.push('MnA'); });

    await planner.runCycle(1_700_000_000_000);

    expect(order).toEqual(['HR', 'COO', 'CFO', 'CTO', 'CSO', 'MnA']);

    const doneEvt = events.emit.mock.calls.find(
      ([evtName]) => evtName === events.E.PLANNER_CYCLE_DONE,
    );
    expect(doneEvt).toBeTruthy();

    const payload = doneEvt[1];
    expect(payload.ctx.stage).toBe('MULTI_CITY_EARLY');
    expect(payload.ctx.globalGoal).toBe('SURVIVE');
    expect(payload.summary.stage).toBe('MULTI_CITY_EARLY');
    expect(payload.summary.globalGoal).toBe('SURVIVE');
    expect(payload.summary.growthStage).toBe('CONSOLIDATE_NEW_CITY');
    expect(payload.summary.nextMilestone).toBe('NEW_CITY_BASELINE_STABILITY');
    expect(Array.isArray(payload.summary.milestoneBlockingFactors)).toBe(true);
    expect(typeof payload.summary.workforceReadiness).toBe('number');
    expect(Array.isArray(payload.summary.workforceBlockingFactors)).toBe(true);
    expect(Array.isArray(payload.summary.workforceReasons)).toBe(true);
    expect(payload.summary.citiesWithEmergency).toEqual(expect.arrayContaining([101, 303]));
    expect(payload.summary.citiesWithBuildBlocked).toEqual(expect.arrayContaining([101, 303]));
    expect(payload.summary.buildsApproved).toBe(1);
    expect(payload.summary.modulesRan).toEqual(['HR', 'COO', 'CFO', 'CTO', 'CSO', 'MnA']);
  });

  test('wake-up reativo também é agendado para WINE_ADJUST e eventos HR críticos', () => {
    const { planner, events } = createPlannerHarness();
    planner.init();

    const reactiveSpy = vi.spyOn(planner, '_scheduleReactiveCycle').mockImplementation(() => {});

    const onDone = events._listeners.get(events.E.QUEUE_TASK_DONE);
    onDone?.({ task: { type: 'WINE_ADJUST', cityId: 101 } });

    const onWineEmergency = events._listeners.get(events.E.HR_WINE_EMERGENCY);
    onWineEmergency?.({ cityId: 202 });

    const onWineAdjusted = events._listeners.get(events.E.HR_WINE_ADJUSTED);
    onWineAdjusted?.({ cityId: 303 });

    expect(reactiveSpy).toHaveBeenCalledWith('WINE_ADJUST');
    expect(reactiveSpy).toHaveBeenCalledWith('HR_WINE_EMERGENCY', 'CITY_202');
    expect(reactiveSpy).toHaveBeenCalledWith('HR_WINE_ADJUSTED', 'CITY_303');
  });
});

