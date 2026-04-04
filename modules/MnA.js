// MnA.js — Mergers & Acquisitions
// Detecta novas cidades fundadas na conta e aciona o protocolo de bootstrap:
// prioridade absoluta para palaceColony até corrupção = 0.

import { getCost } from '../data/buildings.js';
import { TASK_TYPE } from './taskTypes.js';
import { createSafeStorage } from './SafeStorage.js';

export class MnA {
    constructor({ events, audit, config, state, queue, storage }) {
        this._events  = events;
        this._audit   = audit;
        this._config  = config;
        this._state   = state;
        this._queue   = queue;
        this._storage = storage;
        this._safeStorage = createSafeStorage(storage, { module: 'MnA', audit });
    }

    init() {
        // STATE_ALL_FRESH removido — orquestrado pelo Planner
    }

    async replan(ctx = null) { await this._detectNewCities(); }

    // ── Detecção de novas cidades ─────────────────────────────────────────────

    async _detectNewCities() {
        const currentIds = new Set(this._state.getAllCityIds());
        const stored     = await this._safeStorage.get('knownCityIds', null);
        const knownIds   = new Set(Array.isArray(stored) ? stored : []);

        for (const id of currentIds) {
            if (!knownIds.has(id)) {
                this._audit.info('MnA', `Nova cidade detectada: id=${id}`);
                this._handleNewCity(id);
            }
        }

        // Persistir lista atualizada
        await this._safeStorage.set('knownCityIds', [...currentIds]);
    }

    _handleNewCity(cityId) {
        const city = this._state.getCity(cityId);
        if (!city) return;

        this._audit.info('MnA',
            `Bootstrap de nova cidade: ${city.name ?? cityId} — priorizando palaceColony até corrupção = 0`,
            { cityId }
        );

        // Bootstrap-first: não depender do próximo ciclo do CFO para primeira ação.
        this._enqueueBootstrapPalaceColony(city);

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

    _enqueueBootstrapPalaceColony(city) {
        const corruption = Number(city?.economy?.corruption ?? 0);
        if (corruption <= 0) return;

        const pending = this._queue.getPending(city.id);
        const alreadyQueued = pending.some((task) =>
            task.type === TASK_TYPE.BUILD && task.payload?.building === 'palaceColony'
        );
        if (alreadyQueued) return;

        const slot = (city.buildings ?? []).find((b) => b.building === 'palaceColony');
        if (!slot) {
            this._audit.warn('MnA',
                `Bootstrap palaceColony não enfileirado em ${city.name ?? city.id}: slot da residência do governador não encontrado`,
                { cityId: city.id }
            );
            return;
        }

        const toLevel = Number(slot.level ?? 0) + 1;
        const cost = getCost('palaceColony', toLevel);
        if (!cost) {
            this._audit.warn('MnA',
                `Bootstrap palaceColony sem tabela de custo para nível ${toLevel} em ${city.name ?? city.id}`,
                { cityId: city.id }
            );
            return;
        }

        this._queue.add({
            type: TASK_TYPE.BUILD,
            priority: 0,
            cityId: city.id,
            payload: {
                building: 'palaceColony',
                position: slot.position,
                buildingView: 'palaceColony',
                templateView: 'palaceColony',
                cost,
                toLevel,
                currentLevel: toLevel - 1,
                bootstrap: true,
            },
            scheduledFor: Date.now(),
            reason: 'MnA bootstrap-first: priorizar palaceColony em nova cidade com corrupção',
            reasonCode: 'MNA_BOOTSTRAP_PALACECOLONY',
            module: 'MnA',
            confidence: this._state.getConfidence?.(city.id) ?? 'HIGH',
        });

        this._audit.info('MnA',
            `Bootstrap-first: BUILD palaceColony enfileirado para ${city.name ?? city.id} (corrupção=${corruption.toFixed(3)})`,
            { cityId: city.id }
        );
    }
}
