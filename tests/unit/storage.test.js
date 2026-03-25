// tests/unit/storage.test.js — bridge Storage.js via postMessage

// Precisamos importar DEPOIS do setup que configura o postMessage mock
import Storage, { _key } from '../../modules/Storage.js';

beforeEach(() => {
  _clearChromeStore();
  vi.clearAllMocks();
});

describe('_key() — prefixo automático', () => {
  test('gera chave com prefixo IA_<server>_<world>_<avatar>_<name>', () => {
    const k = _key('port_queue');
    // host = s73-br.ikariam.gameforge.com → server=br, world=s73, avatar=42
    expect(k).toBe('IA_br_s73_42_port_queue');
  });

  test('chaves diferentes para nomes diferentes', () => {
    expect(_key('foo')).not.toBe(_key('bar'));
  });
});

describe('Storage.set() + get()', () => {
  test('valor armazenado é recuperado corretamente', async () => {
    Storage.set('test_key', { x: 1, y: 2 });
    const val = await Storage.get('test_key');
    expect(val).toEqual({ x: 1, y: 2 });
  });

  test('get de chave inexistente retorna null', async () => {
    const val = await Storage.get('chave_que_nao_existe');
    expect(val).toBeNull();
  });

  test('armazena strings', async () => {
    Storage.set('str', 'hello');
    expect(await Storage.get('str')).toBe('hello');
  });

  test('armazena arrays', async () => {
    Storage.set('arr', [1, 2, 3]);
    expect(await Storage.get('arr')).toEqual([1, 2, 3]);
  });

  test('armazena booleanos', async () => {
    Storage.set('flag', false);
    expect(await Storage.get('flag')).toBe(false);
  });
});

describe('Storage.remove()', () => {
  test('chave removida não é mais recuperada', async () => {
    Storage.set('to_remove', 99);
    Storage.remove('to_remove');
    // pequeno delay para o postMessage async processar
    await new Promise(r => setTimeout(r, 10));
    const val = await Storage.get('to_remove');
    expect(val).toBeNull();
  });
});

describe('Storage.getSync() + setSync()', () => {
  test('getSync retorna fallback para chave inexistente', () => {
    const val = Storage.getSync('nao_existe', 'default');
    expect(val).toBe('default');
  });

  test('setSync + getSync armazena e recupera sincrono', () => {
    Storage.setSync('sync_key', { a: 1 });
    expect(Storage.getSync('sync_key')).toEqual({ a: 1 });
  });
});
