// COO.js — Chief Operating Officer
// Logística JIT: agendar transportes para que recursos cheguem antes das builds.
// Detectar overflow e redistribuir. Identificar hub central.
// Escuta QUEUE_TASK_ADDED (não CFO_BUILD_APPROVED) — desacoplado do CFO.

import { PORT_LOADING_SPEED, TRAVEL } from '../data/const.js';

export class COO {
    constructor({ events, audit, config, state, queue, client, storage }) {
        this._events  = events;
        this._audit   = audit;
        this._config  = config;
        this._state   = state;
        this._queue   = queue;
        this._client  = client;
        this._storage = storage;

        this._hub = null; // cidade hub identificada
    }

    init() {
        const E = this._events.E;

        // JIT: novo BUILD na fila → agendar transporte de recursos
        this._events.on(E.QUEUE_TASK_ADDED, ({ task }) => {
            if (task.type === 'BUILD') this._scheduleJITForBuild(task);
        });

        // Refresh completo: recalcular hub e verificar overflow
        this._events.on(E.STATE_ALL_FRESH, () => {
            this._hub = this._identifyHub();
            this._checkOverflow();
        });

        // Detecção de overflow — não agir durante fetchAllCities
        this._events.on(E.DC_HEADER_DATA, () => {
            if (this._state.isProbing()) return;
            if (!this._hub) return;
            const cityId = this._state.getActiveCityId();
            const city   = cityId ? this._state.getCity(cityId) : null;
            if (city && this._state.getConfidence(cityId) !== 'UNKNOWN') {
                this._checkCityOverflow(city);
            }
        });

        // Emergência de vinho: agendar transporte de vinho do hub
        this._events.on(E.HR_WINE_EMERGENCY, ({ cityId }) => {
            this._scheduleWineEmergency(cityId);
        });
    }

    replan() {
        this._hub = this._identifyHub();
        this._checkOverflow();
    }

    // ── JIT para BUILD ────────────────────────────────────────────────────────

    async _scheduleJITForBuild(buildTask) {
        const destCity = this._state.getCity(buildTask.cityId);
        if (!destCity || !buildTask.payload?.cost) return;

        const cost = buildTask.payload.cost;
        const inTransit = this._state.getInTransit(buildTask.cityId);
        this._audit.debug('COO',
            `JIT para build [${buildTask.id}] em ${destCity.name}: custo=${JSON.stringify(cost)} em_trânsito=${JSON.stringify(inTransit)}`
        );

        for (const [res, needed] of Object.entries(cost)) {
            if (!needed || needed <= 0) continue;
            if (res === 'wine') continue; // vinho é gerenciado pelo HR

            // Recursos disponíveis = estoque atual + em trânsito para esta cidade
            const onHand    = destCity.resources[res] ?? 0;
            const arriving  = inTransit[res] ?? 0;
            const effective = onHand + arriving;
            const deficit   = Math.max(0, needed - effective);

            this._audit.debug('COO',
                `JIT ${res}: precisa=${needed} tem=${onHand} em_trânsito=${arriving} efetivo=${effective} deficit=${deficit} em ${destCity.name}`
            );

            if (deficit <= 0) continue;

            const source = this._findSource(res, deficit, buildTask.cityId);
            if (!source) {
                this._audit.warn('COO',
                    `Sem fonte para ${res} (deficit ${deficit}) para build em ${destCity.name} — cidades com ${res}: ${this._state.getAllCities().filter(c => c.id !== buildTask.cityId).map(c => `${c.name}=${c.resources[res]??0}`).join(', ')}`,
                    { cityId: buildTask.cityId }
                );
                continue;
            }

            const eta = await this._calculateEta(source, destCity, deficit);
            if (!eta) continue; // journeyTime não disponível

            // Calcular quando despachar para chegar a tempo
            const buildStart = buildTask.scheduledFor ?? Date.now();
            const bufferMs   = this._config.get('transportSafetyBufferS') * 1000;
            const dispatchTs = buildStart - (eta.totalEta * 1000) - bufferMs;
            const sendAt     = Math.max(dispatchTs, Date.now());

            const boats = Math.ceil(deficit / 500); // cada navio carrega 500 de 1 recurso

            this._queue.add({
                type:     'TRANSPORT',
                priority: 10,
                cityId:   source.id,
                payload: {
                    fromCityId:       source.id,
                    toCityId:         destCity.id,
                    toIslandId:       destCity.islandId,
                    cargo:            { [res]: deficit },
                    boats,
                    totalCargo:       deficit,
                    estimatedReturnS: eta.travelTime * 2,
                },
                scheduledFor: sendAt,
                reason:       `COO JIT: ${res}+${deficit} para ${buildTask.payload.building} em ${destCity.name}`,
                module:       'COO',
                confidence:   this._state.getConfidence(source.id),
            });

            this._events.emit(this._events.E.COO_TRANSPORT_SCHED, {
                task: { res, deficit, source: source.id, dest: destCity.id, sendAt },
            });
        }
    }

    // ── Emergência de vinho ───────────────────────────────────────────────────

    _scheduleWineEmergency(cityId) {
        const city = this._state.getCity(cityId);
        if (!city) return;

        const wineSpendings = city.production.wineSpendings;
        if (!wineSpendings || wineSpendings <= 0) return;

        // Enviar suficiente para 24h
        const needed = wineSpendings * 24;

        // Vinho já comprometido = em trânsito (frotas) + pendente na fila
        const inTransit = this._state.getInTransit(cityId);
        const queuedWine = this._queue.getPending()
            .filter(t => t.type === 'TRANSPORT' && t.payload?.toCityId === cityId && t.payload?.cargo?.wine)
            .reduce((sum, t) => sum + (t.payload.cargo.wine ?? 0), 0);
        const committed = (inTransit.wine ?? 0) + queuedWine;

        if (committed >= needed) {
            this._audit.debug('COO',
                `Emergência vinho ${city.name}: já há ${committed}u comprometidos (${inTransit.wine}u em trânsito + ${queuedWine}u na fila) ≥ ${needed}u necessários — ignorado`
            );
            return;
        }

        const toSend = needed - committed;
        const allCities = this._state.getAllCities().filter(c => c.id !== cityId);
        const source = this._findSource('wine', toSend, cityId);
        if (!source) {
            this._audit.warn('COO',
                `Sem fonte de vinho para emergência em ${city.name}: precisa=${toSend} (total=${needed} committed=${committed}), estoques=${allCities.map(c => `${c.name}=${c.resources.wine??0}`).join(', ')}`,
                { cityId }
            );
            return;
        }

        this._audit.info('COO',
            `Emergência vinho: ${city.name} precisa ${toSend}u de vinho` +
            (committed > 0 ? ` (já há ${committed}u comprometidos)` : '') +
            ` — fonte: ${source.name} (tem ${source.resources.wine}u)`
        );

        // Cada navio carrega max 500 unidades de UM recurso por coluna.
        const boats = Math.ceil(toSend / 500);

        this._queue.add({
            type:     'TRANSPORT',
            priority: 0,  // urgente
            cityId:   source.id,
            payload: {
                fromCityId:   source.id,
                toCityId:     cityId,
                toIslandId:   city.islandId,
                cargo:        { wine: toSend },
                boats,
                totalCargo:   toSend,
                wineEmergency: true,
            },
            scheduledFor: Date.now(),
            reason:       `COO: Emergência de vinho em ${city.name} — enviar ${toSend}u`,
            module:       'COO',
            confidence:   'HIGH',
        });
    }

    // ── Overflow ──────────────────────────────────────────────────────────────

    _checkOverflow() {
        const cities = this._state.getAllCities();
        let overflowCount = 0;

        for (const city of cities) {
            const before = overflowCount;
            this._checkCityOverflow(city);
            if (overflowCount > before) overflowCount++; // contado dentro de _checkCityOverflow
        }

        // Resumo limpo independente de overflow
        const summaries = cities.map(c => {
            if (!c.maxResources || c.maxResources === 0) return null;
            const pct = Math.max(...Object.values(c.resources).map(v => v / c.maxResources * 100));
            return `${c.name}=${Math.round(pct)}%`;
        }).filter(Boolean);

        this._audit.debug('COO', `Overflow check: ${summaries.join(' | ')} (cap=${cities[0]?.maxResources ?? '?'})`);
    }

    _checkCityOverflow(city) {
        const maxRes = city.maxResources;
        if (!maxRes || maxRes === 0) return;

        for (const [res, qty] of Object.entries(city.resources)) {
            if (qty < maxRes * 0.95) continue; // < 95% — sem overflow

            this._audit.warn('COO',
                `Overflow de ${res} em ${city.name}: ${qty}/${maxRes}`,
                { cityId: city.id }
            );

            // Enviar excedente para o hub (se identificado)
            if (!this._hub || this._hub.id === city.id) continue;
            const excess = qty - Math.floor(maxRes * 0.80); // manter 80%
            if (excess <= 0) continue;

            const boats = Math.ceil(excess / 500); // cada navio carrega 500 de 1 recurso

            // Verificar se já há transporte pendente deste recurso desta cidade
            const existente = this._queue.getPending(city.id)
                .find(t => t.type === 'TRANSPORT' && t.payload?.cargo?.[res]);
            if (existente) {
                this._audit.debug('COO',
                    `Overflow ${res} em ${city.name}: TRANSPORT já pendente [${existente.id}] — ignorado`
                );
                continue;
            }

            this._queue.add({
                type:     'TRANSPORT',
                priority: 30,
                cityId:   city.id,
                payload: {
                    fromCityId:  city.id,
                    toCityId:    this._hub.id,
                    toIslandId:  this._hub.islandId,
                    cargo:       { [res]: excess },
                    boats,
                    totalCargo:  excess,
                },
                scheduledFor: Date.now(),
                reason:       `COO Overflow: ${res}+${excess} de ${city.name} → hub`,
                module:       'COO',
                confidence:   this._state.getConfidence(city.id),
            });
        }
    }

    // ── Busca de fonte ────────────────────────────────────────────────────────

    _findSource(resource, amount, excludeCityId) {
        const cities = this._state.getAllCities()
            .filter(c => c.id !== excludeCityId)
            .filter(c => (c.resources[resource] ?? 0) > amount * 1.3); // margem 30%

        if (!cities.length) return null;

        // Preferir hub, depois cidade com mais estoque
        if (this._hub && cities.find(c => c.id === this._hub.id)) {
            return this._hub;
        }

        return cities.sort((a, b) =>
            (b.resources[resource] ?? 0) - (a.resources[resource] ?? 0)
        )[0];
    }

    // ── ETA de transporte ─────────────────────────────────────────────────────

    async _calculateEta(originCity, destCity, cargo) {
        const V           = this._getCityLoadingSpeed(originCity);
        const loadingTime = Math.ceil((cargo / V) * 60); // segundos

        let travelTime;

        if (originCity.islandId === destCity.islandId) {
            travelTime = this._config.get('sameIslandTravelS') ?? TRAVEL.SAME_ISLAND_S;
        } else {
            const worldConst = this._config.get('worldSpeedConst');
            if (worldConst) {
                const D = Math.hypot(
                    destCity.coords[0] - originCity.coords[0],
                    destCity.coords[1] - originCity.coords[1]
                );
                travelTime = Math.ceil(D * worldConst + (this._config.get('departureFixedS') ?? TRAVEL.DEPARTURE_FIXED_S));
            } else {
                // Tentar obter via probe (cache por rota)
                const cacheKey = `jt_${originCity.id}_${destCity.id}`;
                let cached = null;
                if (this._storage) {
                    cached = await this._storage.get(cacheKey).catch(() => null);
                }

                if (!cached) {
                    cached = await this._client.probeJourneyTime(originCity.id, destCity.id);
                    if (cached && this._storage) {
                        this._storage.set(cacheKey, cached).catch(() => {});
                    }
                }

                if (cached) {
                    travelTime = cached;
                } else {
                    this._audit.warn('COO',
                        `journeyTime indisponível para rota ${originCity.id}→${destCity.id} — JIT desabilitado`
                    );
                    return null;
                }
            }
        }

        this._audit.debug('COO',
            `ETA ${originCity.name}→${destCity.name}: carga=${cargo} loadingSpeed=${V} loadingTime=${loadingTime}s travelTime=${travelTime}s totalEta=${loadingTime + travelTime}s`
        );
        return { loadingTime, travelTime, totalEta: loadingTime + travelTime };
    }

    _getCityLoadingSpeed(city) {
        // campo correto é 'building' (não 'buildingId') — ver StateManager._onScreenData
        const ports = (city.buildings ?? []).filter(b => b.building === 'port');
        if (!ports.length) return PORT_LOADING_SPEED[1]; // fallback nível 1

        return ports.reduce((sum, p) => {
            return sum + (PORT_LOADING_SPEED[p.level] ?? PORT_LOADING_SPEED[1]);
        }, 0);
    }

    // ── Hub ───────────────────────────────────────────────────────────────────

    _identifyHub() {
        const cities = this._state.getAllCities();
        if (!cities.length) return null;

        // Hub: cidade com maior capacidade de armazém + melhor posição central
        let best = null, bestScore = -Infinity;

        for (const city of cities) {
            const warehouseLevel = Math.max(
                0,
                ...(city.buildings || [])
                    .filter(b => b.building === 'warehouse')
                    .map(b => b.level ?? 0)
            );
            const capacityScore = warehouseLevel * 10;
            const centralScore  = this._centralityScore(city, cities);
            const total         = capacityScore + centralScore;

            if (total > bestScore) {
                bestScore = total;
                best      = city;
            }
        }

        if (best && best !== this._hub) {
            this._audit.info('COO', `Hub identificado: ${best.name}`);
        }
        return best;
    }

    _centralityScore(city, allCities) {
        if (allCities.length < 2) return 0;
        const others = allCities.filter(c => c.id !== city.id);
        const avgDist = others.reduce((sum, c) =>
            sum + Math.hypot(c.coords[0] - city.coords[0], c.coords[1] - city.coords[1]), 0
        ) / others.length;
        return Math.max(0, 50 - avgDist); // quanto mais central, maior score
    }
}
