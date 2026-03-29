// CSO.js — Chief Security Officer
// Monitora capital em risco (recursos acima do safe do armazém).
// O NOISE scheduling está em TaskQueue._scheduleNoise — CSO apenas recebe os eventos.

import { getWarehouseSafe } from '../data/effects.js';

export class CSO {
    constructor({ events, audit, config, state, queue }) {
        this._events = events;
        this._audit  = audit;
        this._config = config;
        this._state  = state;
        this._queue  = queue;
    }

    init() {
        const E = this._events.E;
        // STATE_ALL_FRESH removido — orquestrado pelo Planner
    }

    replan(ctx = null) {
        for (const city of this._state.getAllCities()) {
            this._checkCapitalRisk(city);
        }
    }

    // ── Capital em risco ──────────────────────────────────────────────────────

    _checkCapitalRisk(city) {
        // Calcular capacidade safe do armazém (nível mais alto presente)
        // CAMPO CORRETO: b.building (string), não b.buildingId (inexistente no StateManager)
        const warehouseLevel = (city.buildings || [])
            .filter(b => b.building === 'warehouse')
            .reduce((sum, b) => sum + (b.level ?? 0), 0);
        const safeCapacity = getWarehouseSafe(warehouseLevel);

        // Total de recursos acima do safe (saqueáveis)
        const atRisk = Object.values(city.resources).reduce((sum, qty) =>
            sum + Math.max(0, qty - safeCapacity), 0
        );

        if (atRisk <= this._config.get('capitalRiskThreshold')) return;

        this._events.emit(this._events.E.CSO_CAPITAL_RISK, {
            cityId: city.id,
            atRisk,
        });

        this._audit.warn('CSO',
            `Capital em risco em ${city.name}: ${atRisk.toLocaleString()} unidades acima do safe (${safeCapacity})`,
            { cityId: city.id }
        );

        // Protocolo: antecipar CFO para consumir os recursos em build
        // CFO.evaluateCity trata palaceColony com prioridade se corrupção > 0
        // Aqui apenas emitimos o evento — COO reage via HR_WINE_EMERGENCY e overflow
    }
}
