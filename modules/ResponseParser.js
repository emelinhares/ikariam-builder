export class ResponseParser {
  static parse(url, text) {
    const events = [];
    let data;
    try {
      const trimmed = String(text ?? '').trim();
      if (!trimmed.startsWith('[')) return events;
      data = JSON.parse(trimmed);
      if (!Array.isArray(data)) return events;
    } catch {
      return events;
    }

    for (const cmd of data) {
      if (!Array.isArray(cmd) || cmd.length < 2) continue;
      const [name, payload] = cmd;
      if (name === 'updateGlobalData' && payload) {
        events.push({ type: 'globalData', url, payload });
      }
      if (name === 'fleetMoveList' && Array.isArray(payload)) {
        events.push({ type: 'fleetMoveList', payload });
      }
      if (name === 'changeView' && Array.isArray(payload)) {
        events.push({ type: 'changeView', payload });
      }
    }

    return events;
  }
}

