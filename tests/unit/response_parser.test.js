import { ResponseParser } from '../../modules/ResponseParser.js';

describe('ResponseParser', () => {
  test('parses updateGlobalData, fleetMoveList and changeView commands', () => {
    const raw = JSON.stringify([
      ['updateGlobalData', { headerData: { income: 100 } }],
      ['fleetMoveList', [{ id: 1 }]],
      ['changeView', ['townHall', '<div/>', { viewScriptParams: { cityId: 101 } }]],
    ]);

    const events = ResponseParser.parse('https://game.test', raw);
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('globalData');
    expect(events[1].type).toBe('fleetMoveList');
    expect(events[2].type).toBe('changeView');
  });

  test('returns empty array for invalid payload', () => {
    expect(ResponseParser.parse('u', '{bad')).toEqual([]);
    expect(ResponseParser.parse('u', '  {}')).toEqual([]);
  });
});

