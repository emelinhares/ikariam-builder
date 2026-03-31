// CTO.js — Chief Technology Officer
// Gerencia a fila de pesquisas. Prioriza redutores de custo de construção.
// Não faz requests — emite tasks RESEARCH para o TaskQueue.

import { COST_REDUCERS } from '../data/research.js';
import { TASK_TYPE } from './taskTypes.js';

export class CTO {
    constructor({ events, audit, config, state, queue }) {
        this._events = events;
        this._audit  = audit;
        this._config = config;
        this._state  = state;
        this._queue  = queue;
    }

    init() {
        const E = this._events.E;
        this._events.on(E.STATE_RESEARCH,  () => this._checkAndQueue());
        // STATE_ALL_FRESH removido — orquestrado pelo Planner
    }

    replan(ctx = null) { this._checkAndQueue(); }

    // ── Avaliação ─────────────────────────────────────────────────────────────

    _checkAndQueue() {
        const research = this._state.research;
        if (!research) return;

        // Já tem pesquisa em andamento
        if (research.inProgress) {
            const eta = research.inProgress.finishTs
                ? research.inProgress.finishTs - this._state.getServerNow()
                : null;
            this._audit.debug('CTO',
                `Pesquisa em andamento — ETA: ${eta ? (eta / 3600).toFixed(1) + 'h' : 'desconhecido'}`
            );
            return;
        }

        const next = this._getNextResearch(research.investigated);
        if (!next) {
            this._audit.info('CTO', 'Todos os redutores de custo pesquisados — nada a fazer.');
            return;
        }

        // Verificar se já tem RESEARCH pendente na fila
        const alreadyQueued = this._queue.getPending()
            .some(t => t.type === TASK_TYPE.RESEARCH && t.payload?.researchId === next);
        if (alreadyQueued) return;

        // Encontrar cidade operacional para academia.
        const cities = this._state.getAllCities();
        const cityWithAcademy = this._pickOperationalAcademyCity(cities);

        if (!cityWithAcademy) {
            this._audit.warn('CTO',
                `Pesquisa #${next} não enfileirada: nenhuma cidade atende precondições operacionais da academia`
            );
            return;
        }

        this._audit.info('CTO',
            `Enfileirar pesquisa #${next} (redutor de custo) via ${cityWithAcademy.name}`
        );

        this._queue.add({
            type:     TASK_TYPE.RESEARCH,
            priority: 30,
            cityId:   cityWithAcademy.id,
            payload:  { researchId: next },
            scheduledFor: Date.now(),
            reason:   `CTO: Iniciar pesquisa #${next} (redutor de custo de construção)`,
            module:   'CTO',
            confidence: 'HIGH',
        });

        this._events.emit(this._events.E.CTO_RESEARCH_START, { researchId: next });
    }

    _pickOperationalAcademyCity(cities = []) {
        if (!Array.isArray(cities) || cities.length === 0) return null;

        const academyCities = cities
            .map((c) => {
                const academy = (c.buildings ?? [])
                    .filter(b => b.building === 'academy')
                    .sort((a, b) => (b.level ?? 0) - (a.level ?? 0))[0] ?? null;
                const scientists = Number(c.workers?.scientists ?? 0);
                return {
                    city: c,
                    academyLevel: Number(academy?.level ?? 0),
                    scientists,
                    confidence: this._state.getConfidence?.(c.id) ?? 'MEDIUM',
                };
            })
            .filter((entry) => entry.academyLevel > 0 && entry.scientists > 0)
            .filter((entry) => entry.confidence !== 'LOW');

        if (!academyCities.length) return null;

        academyCities.sort((a, b) =>
            (b.scientists - a.scientists) ||
            (b.academyLevel - a.academyLevel) ||
            (Number(a.city.id) - Number(b.city.id))
        );

        return academyCities[0].city;
    }

    _getNextResearch(investigated) {
        if (!investigated) return COST_REDUCERS[0] ?? null;
        for (const id of COST_REDUCERS) {
            if (!investigated.has(id)) return id;
        }
        return null; // todos pesquisados
    }
}
