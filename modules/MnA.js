// MnA.js — Mergers & Acquisitions
// Detecta novas cidades fundadas na conta e aciona o protocolo de bootstrap:
// prioridade absoluta para palaceColony até corrupção = 0.

export class MnA {
    constructor({ events, audit, config, state, queue, storage }) {
        this._events  = events;
        this._audit   = audit;
        this._config  = config;
        this._state   = state;
        this._queue   = queue;
        this._storage = storage;
    }

    init() {
        // STATE_ALL_FRESH removido — orquestrado pelo Planner
    }

    async replan(ctx = null) { await this._detectNewCities(); }

    // ── Detecção de novas cidades ─────────────────────────────────────────────

    async _detectNewCities() {
        const currentIds = new Set(this._state.getAllCityIds());
        const stored     = await this._storage.get('knownCityIds').catch(() => null);
        const knownIds   = new Set(Array.isArray(stored) ? stored : []);

        for (const id of currentIds) {
            if (!knownIds.has(id)) {
                this._audit.info('MnA', `Nova cidade detectada: id=${id}`);
                this._handleNewCity(id);
            }
        }

        // Persistir lista atualizada
        await this._storage.set('knownCityIds', [...currentIds]).catch(() => {});
    }

    _handleNewCity(cityId) {
        const city = this._state.getCity(cityId);
        if (!city) return;

        this._audit.info('MnA',
            `Bootstrap de nova cidade: ${city.name ?? cityId} — priorizando palaceColony até corrupção = 0`,
            { cityId }
        );

        // A lógica de prioridade do palaceColony já está no CFO._buildingScore:
        // corruption > 0 → palaceColony recebe score = 100
        // Não precisamos enfileirar manualmente — o CFO vai cuidar no próximo replan.

        // Cancelar builds grandes desta cidade enquanto corrupção > 0
        // (proteção contra CFO enfileirar algo caro antes do palaceColony)
        const pending = this._queue.getPending(cityId);
        for (const task of pending) {
            if (task.type === 'BUILD' && task.payload?.building !== 'palaceColony') {
                if (city.economy.corruption > 0) {
                    this._queue.cancel(task.id);
                    this._audit.info('MnA',
                        `Cancelado build ${task.payload?.building} em ${city.name} — aguardar corrupção = 0`
                    );
                }
            }
        }
    }
}
