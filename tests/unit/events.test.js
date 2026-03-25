// tests/unit/events.test.js — barramento pub/sub

import Events from '../../modules/Events.js';

beforeEach(() => {
  // Limpa todos os listeners entre testes
  Events.clear('test:event');
  Events.clear('other:event');
  Events.clear('error:event');
});

describe('Events.on() + emit()', () => {
  test('handler é chamado com o payload correto', () => {
    const spy = vi.fn();
    Events.on('test:event', spy);
    Events.emit('test:event', { value: 42 });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith({ value: 42 });
  });

  test('múltiplos handlers são todos chamados', () => {
    const a = vi.fn();
    const b = vi.fn();
    Events.on('test:event', a);
    Events.on('test:event', b);
    Events.emit('test:event', 'hello');
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  test('evento sem listeners não lança erro', () => {
    expect(() => Events.emit('nenhum:listener', {})).not.toThrow();
  });
});

describe('Events.once()', () => {
  test('handler é chamado apenas uma vez', () => {
    const spy = vi.fn();
    Events.once('test:event', spy);
    Events.emit('test:event', 1);
    Events.emit('test:event', 2);
    Events.emit('test:event', 3);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(1);
  });

  test('once e on coexistem para o mesmo evento', () => {
    const once = vi.fn();
    const always = vi.fn();
    Events.once('test:event', once);
    Events.on('test:event', always);
    Events.emit('test:event', 'x');
    Events.emit('test:event', 'y');
    expect(once).toHaveBeenCalledOnce();
    expect(always).toHaveBeenCalledTimes(2);
  });
});

describe('Events.off()', () => {
  test('remove handler específico', () => {
    const spy = vi.fn();
    Events.on('test:event', spy);
    Events.off('test:event', spy);
    Events.emit('test:event', 'qualquer');
    expect(spy).not.toHaveBeenCalled();
  });

  test('off de handler não registrado não lança erro', () => {
    expect(() => Events.off('test:event', () => {})).not.toThrow();
  });

  test('off remove apenas o handler alvo, preservando os outros', () => {
    const a = vi.fn();
    const b = vi.fn();
    Events.on('test:event', a);
    Events.on('test:event', b);
    Events.off('test:event', a);
    Events.emit('test:event', null);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });
});

describe('Events.clear()', () => {
  test('remove todos os listeners do evento', () => {
    const a = vi.fn();
    const b = vi.fn();
    Events.on('test:event', a);
    Events.on('test:event', b);
    Events.clear('test:event');
    Events.emit('test:event', null);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  test('clear de evento inexistente não lança erro', () => {
    expect(() => Events.clear('evento:fantasma')).not.toThrow();
  });

  test('clear de um evento não afeta outros eventos', () => {
    const a = vi.fn();
    const b = vi.fn();
    Events.on('test:event', a);
    Events.on('other:event', b);
    Events.clear('test:event');
    Events.emit('other:event', null);
    expect(b).toHaveBeenCalledOnce();
  });
});

describe('tratamento de erros em handlers', () => {
  test('handler com erro não impede os demais de rodarem', () => {
    const badHandler = vi.fn(() => { throw new Error('boom'); });
    const goodHandler = vi.fn();
    Events.on('error:event', badHandler);
    Events.on('error:event', goodHandler);
    // Não deve lançar
    expect(() => Events.emit('error:event', null)).not.toThrow();
    expect(goodHandler).toHaveBeenCalledOnce();
  });
});
