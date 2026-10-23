import { StateManager } from '../../modules/StateManager.js';

function createEvents() {
  return {
    E: {
      DC_HEADER_DATA: 'dc:headerData', DC_MODEL_REFRESH: 'dc:modelRefresh',
      DC_SCREEN_DATA: 'dc:screenData', DC_FLEET_MOVEMENTS: 'dc:fleetMovements',
      DC_TOWNHALL_DATA: 'dc:townhallData', QUEUE_TASK_STARTED: 'queue:taskStarted',
      QUEUE_TASK_DONE: 'queue:taskDone', QUEUE_TASK_FAILED: 'queue:taskFailed',
      STATE_CITY_UPDATED: 'state:cityUpdated', STATE_RESEARCH: 'state:researchUpdated',
      STATE_READY: 'state:ready', STATE_ALL_FRESH: 'state:allCitiesFresh',
      STATE_CYCLE_REPORT: 'state:cycleReport',
    },
    on: vi.fn(), emit: vi.fn(),
  };
}
const createAudit = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function harness({ cidades = 5, msPorProbe = 8_000 } = {}) {
  const config = {
    get: vi.fn((k) => ({
      heartbeatFocusMs: 60_000,
      maxProbeFractionOfHeartbeat: 0.33,   // orçamento = 20s
    }[k])),
  };
  const state = new StateManager({ events: createEvents(), audit: createAudit(), config });
  for (let i = 1; i <= cidades; i++) state.cities.set(100 + i, { id: 100 + i, name: `C${i}` });
  state._emitCycleReport = () => {};   // relatório de ciclo não é o que se testa aqui

  const sondadas = [];
  const client = {
    acquireSession: vi.fn(async (fn) => fn()),
    probeCityData: vi.fn(async (id) => { sondadas.push(id); vi.advanceTimersByTime(msPorProbe); }),
    fetchMilitaryAdvisor: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
  };
  return { state, client, sondadas };
}

describe('StateManager — orçamento da janela de probing', () => {
  test('para quando o orçamento acaba, em vez de varrer todas as cidades', async () => {
    vi.useFakeTimers();
    try {
      const { state, client, sondadas } = harness();
      await state.fetchAllCities(client);

      // orçamento 20s, 8s por cidade: entram 3 e sobram 2
      expect(sondadas.length).toBe(3);
      expect(client.probeCityData).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });

  test('o ciclo seguinte começa pelas que ficaram para trás', async () => {
    vi.useFakeTimers();
    try {
      const { state, client, sondadas } = harness();
      await state.fetchAllCities(client);
      const primeiras = [...sondadas];
      sondadas.length = 0;

      await state.fetchAllCities(client);

      // as duas não sondadas vêm primeiro — ninguém fica parado para sempre
      const atrasadas = [101, 102, 103, 104, 105].filter(id => !primeiras.includes(id));
      expect(sondadas.slice(0, atrasadas.length).sort()).toEqual(atrasadas.sort());
    } finally { vi.useRealTimers(); }
  });

  test('sonda ao menos uma cidade mesmo com orçamento estourado', async () => {
    vi.useFakeTimers();
    try {
      const { state, client, sondadas } = harness({ msPorProbe: 90_000 });
      await state.fetchAllCities(client);

      expect(sondadas.length).toBe(1);
    } finally { vi.useRealTimers(); }
  });
});
