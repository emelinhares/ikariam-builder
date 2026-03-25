// Patrol.js — patrulha orientada a eventos
//
// Decisão por cidade:
//   1. Construindo         → lê endUpgradeTime → agenda visita para endTime + 30s
//   2. Livre + recursos OK → delega a Goals.runGoals imediatamente
//   3. Livre + sem rec. + barcos chegando → militaryAdvisor → agenda arrivalTs + 60s
//   4. Livre + sem rec. + sem barcos:
//        ≤ 4h → aguarda produção local → agenda retry na hora exata
//        > 4h → delega ao Goals para sourcing externo
//
// scheduleNextPatrolCheck usa setTimeout para o timestamp exato — sem polling.

import Game from './Game.js';
import ResourceCache from './ResourceCache.js';
import Goals, { runGoals } from './Goals.js';
import Storage from './Storage.js';
import Events from './Events.js';

// ─── Constantes ───────────────────────────────────────────────────────────────
const BUILD_FINISH_BUFFER_S = 30;     // segundos após fim de construção
const ARRIVAL_BUFFER_S      = 60;     // segundos após chegada de barcos
const MIN_INTERVAL_S        = 120;    // intervalo mínimo entre visitas (2min)
const MAX_INTERVAL_S        = 3600;   // intervalo máximo (1h)

// ─── Chaves de persistência ───────────────────────────────────────────────────
const SK_ACTIVE   = 'patrol_active';
const SK_SCHEDULE = 'patrol_schedule'; // { [cityId]: nextCheckTimestamp (Unix s) }
const SK_CURRENT  = 'patrol_current';

// ─── Estado interno ───────────────────────────────────────────────────────────
let _active   = false;
let _schedule = {};   // { [cityId]: nextCheckTimestamp }
let _timers   = {};   // { [cityId]: timeoutId }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _clamp(seconds) {
    return Math.max(MIN_INTERVAL_S, Math.min(MAX_INTERVAL_S, seconds));
}

function _saveSchedule() {
    Storage.set(SK_SCHEDULE, _schedule);
}

/**
 * Lê o timestamp de chegada do próximo transporte entrante para a cidade.
 * Usa ikariam.backgroundView.screen.data.militaryAdvisor (se disponível).
 * Retorna null se não há barcos chegando.
 */
function _nextArrivalTs(cityId) {
    try {
        const advisor = window.ikariam?.backgroundView?.screen?.data?.militaryAdvisor;
        if (!advisor) return null;

        const entries = Array.isArray(advisor) ? advisor : Object.values(advisor);
        let earliest = null;

        for (const entry of entries) {
            if (entry.targetCityId !== cityId && entry.target_city_id !== cityId) continue;
            const arrivalTs = entry.arrivalTime ?? entry.arrival_time ?? null;
            if (!arrivalTs) continue;
            if (earliest === null || arrivalTs < earliest) earliest = arrivalTs;
        }

        return earliest;
    } catch (e) {
        return null;
    }
}

// ─── Visita a uma cidade ──────────────────────────────────────────────────────

/**
 * Visita uma cidade, decide o que fazer e retorna segundos até o próximo check.
 */
async function _visitCity(cityId) {
    Storage.set(SK_CURRENT, cityId);
    ResourceCache.refresh(cityId);

    // 1. Está construindo?
    if (Game.isBuilding(cityId)) {
        const finishTs = Math.floor(Game.getQueueFinishTime(cityId) / 1000);
        const waitS    = _clamp((finishTs - Game.getServerTime()) + BUILD_FINISH_BUFFER_S);
        Events.emit('patrol:scheduled', { cityId, reason: 'building', waitS, finishTs });
        return waitS;
    }

    // 2. Tenta avançar goals
    const result = await runGoals(cityId);

    switch (result) {
        case 'built': {
            // Construção iniciada — volta quando terminar
            const finishTs = Math.floor(Game.getQueueFinishTime(cityId) / 1000);
            const waitS    = finishTs
                ? _clamp((finishTs - Game.getServerTime()) + BUILD_FINISH_BUFFER_S)
                : MIN_INTERVAL_S;
            Events.emit('patrol:scheduled', { cityId, reason: 'built', waitS });
            return waitS;
        }

        case 'done':
            Events.emit('patrol:scheduled', { cityId, reason: 'done' });
            return MAX_INTERVAL_S;

        case 'waiting_queue': {
            const finishTs = Math.floor(Game.getQueueFinishTime(cityId) / 1000);
            const waitS    = _clamp((finishTs - Game.getServerTime()) + BUILD_FINISH_BUFFER_S);
            Events.emit('patrol:scheduled', { cityId, reason: 'waiting_queue', waitS });
            return waitS;
        }

        case 'waiting':
        case 'waiting_resources': {
            // 3. Barcos chegando com recursos?
            const arrivalTs = _nextArrivalTs(cityId);
            if (arrivalTs) {
                const waitS = _clamp((arrivalTs - Game.getServerTime()) + ARRIVAL_BUFFER_S);
                Events.emit('patrol:scheduled', { cityId, reason: 'arrival', waitS, arrivalTs });
                return waitS;
            }

            // 4. Sem barcos — calcula espera por produção local
            const goal = Goals.getNextGoal(cityId);
            if (!goal) return MAX_INTERVAL_S;

            const costs = goal.position !== null
                ? await Game.fetchCosts(cityId, goal.position)
                : null;

            if (!costs) return _clamp(30 * 60);

            const hoursLocal = ResourceCache.hoursUntilResources(cityId, costs);

            if (hoursLocal !== Infinity && hoursLocal <= 4) {
                const waitS = _clamp(Math.ceil(hoursLocal * 3600));
                Events.emit('patrol:scheduled', {
                    cityId, reason: 'local_production', waitS, hoursLocal,
                });
                return waitS;
            }

            // > 4h — sourcing externo já foi delegado ao Goals; retry em 4h
            Events.emit('patrol:scheduled', { cityId, reason: 'sourcing', hoursLocal });
            return _clamp(4 * 3600);
        }

        default:
            return MIN_INTERVAL_S;
    }
}

// ─── Agendamento ──────────────────────────────────────────────────────────────

/**
 * Agenda o próximo check de uma cidade para `atTimestamp` (Unix, segundos).
 * Usa setTimeout para o instante exato — sem polling.
 */
function _scheduleCity(cityId, atTimestamp) {
    if (_timers[cityId]) clearTimeout(_timers[cityId]);

    _schedule[cityId] = atTimestamp;
    _saveSchedule();

    const delayMs = Math.max(0, (atTimestamp - Game.getServerTime()) * 1000);

    _timers[cityId] = setTimeout(async () => {
        if (!_active) return;
        const waitS  = await _visitCity(cityId);
        const nextTs = Game.getServerTime() + waitS;
        _scheduleCity(cityId, nextTs);
    }, delayMs);
}

// ─── API pública ──────────────────────────────────────────────────────────────

const Patrol = {

    async init() {
        _active = (await Storage.get(SK_ACTIVE)) ?? false;
        const raw = (await Storage.get(SK_SCHEDULE)) ?? {};
        // Sanitiza: descarta timestamps inválidos (ms em vez de s, expirados, etc.)
        const now = Math.floor(Date.now() / 1000);
        _schedule = {};
        for (const [id, ts] of Object.entries(raw)) {
            const s = ts > 1e10 ? Math.floor(ts / 1000) : ts; // normaliza ms→s
            if (typeof s === 'number' && s > now && s < now + 7 * 24 * 3600) {
                _schedule[id] = s;
            }
        }
    },

    isActive()    { return _active; },
    getSchedule() { return { ..._schedule }; },

    /**
     * Inicia a patrulha.
     * Se já há schedule salvo (resume após reload), respeta os timestamps.
     * Caso contrário, visita todas as cidades imediatamente.
     */
    async start() {
        _active = true;
        Storage.set(SK_ACTIVE, true);

        const cities = Game.getCities();
        const now    = Game.getServerTime();

        for (const city of cities) {
            // Se há timestamp salvo futuro, usa; caso contrário, agora
            const scheduled = _schedule[city.id] ?? now;
            _scheduleCity(city.id, Math.max(scheduled, now));
        }

        console.log(`[Patrol] Iniciada — ${cities.length} cidade(s).`);
    },

    stop() {
        _active = false;
        Storage.set(SK_ACTIVE, false);
        for (const id of Object.keys(_timers)) clearTimeout(_timers[id]);
        _timers = {};
        console.log('[Patrol] Parada.');
    },

    /** Força visita imediata a uma cidade. */
    async visitNow(cityId) {
        const waitS  = await _visitCity(cityId);
        const nextTs = Game.getServerTime() + waitS;
        if (_active) _scheduleCity(cityId, nextTs);
        return waitS;
    },

    /** Retorna status de agendamento de cada cidade. */
    nextChecks() {
        return Game.getCities().map(c => ({
            cityId:    c.id,
            cityName:  c.name,
            nextTs:    _schedule[c.id] ?? null,
            inSeconds: _schedule[c.id]
                ? Math.max(0, _schedule[c.id] - Game.getServerTime())
                : null,
        }));
    },
};

// ─── Exportações para Builder / inject.js ─────────────────────────────────────

export async function runPatrol() {
    return Patrol.start();
}

export function scheduleNextPatrolCheck(cityId, waitS) {
    const nextTs = Game.getServerTime() + waitS;
    _scheduleCity(cityId, nextTs);
}

export default Patrol;
