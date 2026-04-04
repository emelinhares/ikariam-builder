import { TASK_TYPE } from './taskTypes.js';

export class NoiseScheduler {
    constructor({ queue, state, config }) {
        this._queue = queue;
        this._state = state;
        this._config = config;

        this._noiseCounter = 0;
        this._nextNoiseAt = this._newNoiseThreshold();
    }

    _newNoiseThreshold() {
        const min = this._config.get('noiseFrequencyMin') ?? 8;
        const max = this._config.get('noiseFrequencyMax') ?? 15;
        return min + Math.floor(Math.random() * (max - min));
    }

    _scheduleNoise() {
        this._noiseCounter = 0;
        this._nextNoiseAt = this._newNoiseThreshold();

        const views = ['embassy', 'barracks', 'museum', 'academy', 'temple'];
        const view = views[Math.floor(Math.random() * views.length)];
        const cities = this._state.getAllCities();
        if (!cities.length) return;
        const city = cities[Math.floor(Math.random() * cities.length)];

        this._queue.add({
            type: TASK_TYPE.NOISE,
            priority: 50,
            cityId: city.id,
            payload: { view },
            scheduledFor: Date.now() + 5_000 + Math.random() * 25_000,
            reason: `Mimetismo: visita aleatória a ${view}`,
            module: 'CSO',
            confidence: 'HIGH',
            maxAttempts: 1,
        });
    }

    noteRealActionAndScheduleIfNeeded() {
        this._noiseCounter++;
        if (this._noiseCounter >= this._nextNoiseAt) this._scheduleNoise();
    }
}

