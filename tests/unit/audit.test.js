// tests/unit/audit.test.js — reasoning log e telemetria

import { vi } from 'vitest';

// Mocks para dependências de Audit
vi.mock('../../modules/Storage.js', () => ({
  default: {
    get: vi.fn(async () => null),
    set: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('../../modules/Game.js', () => ({
  default: {
    getServerTime: vi.fn(() => 1700000000),
  },
}));

import Audit, { REASON } from '../../modules/Audit.js';
import Storage from '../../modules/Storage.js';
import Game from '../../modules/Game.js';

beforeEach(async () => {
  vi.clearAllMocks();
  Storage.get.mockResolvedValue(null);
  await Audit.reset();
});

describe('REASON constants', () => {
  test('constantes definidas', () => {
    expect(REASON.WAITING_LOCAL).toBe('waiting_local');
    expect(REASON.WINE_CRITICAL).toBe('wine_critical');
    expect(REASON.GOAL_ENQUEUED).toBe('goal_enqueued');
    expect(REASON.PATROL_SCHEDULED).toBe('patrol_scheduled');
  });
});

describe('Audit.reason()', () => {
  test('registra entrada no log', () => {
    Audit.reason(REASON.WINE_CRITICAL, 'Cidade X em estado crítico de vinho');
    const log = Audit.getLog();
    expect(log).toHaveLength(1);
    expect(log[0].type).toBe(REASON.WINE_CRITICAL);
    expect(log[0].msg).toBe('Cidade X em estado crítico de vinho');
    expect(log[0].ts).toBe(1700000000);
  });

  test('registra data opcional', () => {
    Audit.reason(REASON.GOAL_ENQUEUED, 'Construção enfileirada', { building: 'academy', level: 5 });
    const log = Audit.getLog();
    expect(log[0].data).toEqual({ building: 'academy', level: 5 });
  });

  test('sem data não inclui campo data na entrada', () => {
    Audit.reason(REASON.XHR_SYNC, 'sync');
    expect(Audit.getLog()[0].data).toBeUndefined();
  });
});

describe('log circular (MAX 200)', () => {
  test('log nunca excede 200 entradas', () => {
    for (let i = 0; i < 250; i++) {
      Audit.reason(REASON.XHR_SYNC, `sync ${i}`);
    }
    const log = Audit.getLog();
    expect(log.length).toBeLessThanOrEqual(200);
  });

  test('entradas mais antigas são descartadas', () => {
    for (let i = 0; i < 210; i++) {
      Audit.reason(REASON.XHR_SYNC, `sync ${i}`);
    }
    const log = Audit.getLog();
    // A entrada 0 foi descartada; a mais antiga agora é sync 10+
    expect(log[0].msg).not.toBe('sync 0');
  });

  test('getLog(limit) limita os resultados', () => {
    for (let i = 0; i < 20; i++) Audit.reason(REASON.XHR_SYNC, `${i}`);
    expect(Audit.getLog(5)).toHaveLength(5);
  });
});

describe('Audit.incTransportAvoided()', () => {
  test('incrementa contador e goldSaved', () => {
    Audit.incTransportAvoided(200);
    Audit.incTransportAvoided(150);
    const stats = Audit.getStats();
    expect(stats.transportsAvoided).toBe(2);
    expect(stats.goldSaved).toBe(350);
  });

  test('registra entrada no log automaticamente', () => {
    Audit.incTransportAvoided(100);
    const log = Audit.getLog();
    expect(log.some(e => e.type === REASON.TRANSPORT_SKIP)).toBe(true);
  });
});

describe('Audit.incXhrSync()', () => {
  test('incrementa xhrSyncs', () => {
    Audit.incXhrSync();
    Audit.incXhrSync();
    Audit.incXhrSync();
    expect(Audit.getStats().xhrSyncs).toBe(3);
  });
});

describe('Audit.recordHeartbeat()', () => {
  test('incrementa heartbeats', () => {
    Audit.recordHeartbeat();
    Audit.recordHeartbeat();
    expect(Audit.getStats().heartbeats).toBe(2);
  });

  test('calcula média móvel do intervalo', () => {
    // Primeiro heartbeat: sem intervalo ainda
    Game.getServerTime.mockReturnValueOnce(1000);
    Audit.recordHeartbeat();
    expect(Audit.getStats().heartbeatAvgS).toBeNull();

    // Segundo heartbeat: 60s depois
    Game.getServerTime.mockReturnValueOnce(1060);
    Audit.recordHeartbeat();
    expect(Audit.getStats().heartbeatAvgS).toBe(60);

    // Terceiro heartbeat: 30s depois (média ponderada)
    Game.getServerTime.mockReturnValueOnce(1090);
    Audit.recordHeartbeat();
    // 60 * 0.8 + 30 * 0.2 = 48 + 6 = 54
    expect(Audit.getStats().heartbeatAvgS).toBe(54);
  });
});

describe('Audit.clearLog()', () => {
  test('limpa o log mas mantém estatísticas', () => {
    Audit.reason(REASON.WINE_NORMAL, 'teste');
    Audit.incXhrSync();
    Audit.clearLog();
    expect(Audit.getLog()).toHaveLength(0);
    expect(Audit.getStats().xhrSyncs).toBe(1); // stats preservados
  });
});

describe('Audit.getStats()', () => {
  test('retorna cópia das stats (não referência)', () => {
    const stats = Audit.getStats();
    stats.transportsAvoided = 9999;
    expect(Audit.getStats().transportsAvoided).toBe(0);
  });

  test('startedAt é definido no init', async () => {
    Game.getServerTime.mockReturnValue(1700000000);
    await Audit.init();
    expect(Audit.getStats().startedAt).toBe(1700000000);
  });
});
