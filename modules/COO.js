// COO.js — Chief Operating Officer
// Logística JIT: agendar transportes para que recursos cheguem antes das builds.
// Detectar overflow e redistribuir. Identificar hub central.
// Escuta QUEUE_TASK_ADDED (não CFO_BUILD_APPROVED) — desacoplado do CFO.

import { PORT_LOADING_SPEED, TRAVEL, TradeGoodOrdinals } from '../data/const.js';
import { createEmptyResources } from './resourceContracts.js';

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

        // STATE_ALL_FRESH removido — orquestrado pelo Planner

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

    replan(ctx = null) {
        this._hub = this._identifyHub();
        this._checkOverflow();
        this._checkMinimumStocks(ctx);

        // Atualizar contexto com transportes já enfileirados para cada cidade
        if (ctx) {
            for (const [cityId, cityCtx] of ctx.cities) {
                cityCtx.pendingTransports = this._queue.getPending()
                    .filter(t => t.type === 'TRANSPORT' && t.payload?.toCityId === cityId);
            }
        }
    }

    // ── JIT para BUILD ────────────────────────────────────────────────────────

    async _scheduleJITForBuild(buildTask) {
        const destCity = this._state.getCity(buildTask.cityId);
        if (!destCity || !buildTask.payload?.cost) return;

        const cost      = buildTask.payload.cost;
        const inTransit = this._state.getInTransit(buildTask.cityId);

        // Construir ledger uma vez para toda a iteração de recursos
        const ledger = this._buildCommitmentLedger();

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

            // Tentar fonte única primeiro (mais simples, 1 transporte)
            const singleSource = this._findSource(res, deficit, buildTask.cityId, ledger);

            if (singleSource) {
                await this._enqueueJIT(singleSource, destCity, res, deficit, buildTask, ledger);
            } else {
                // Fonte única não tem o suficiente — tentar múltiplas fontes
                const sources = this._findMultiSource(res, deficit, buildTask.cityId, ledger);
                if (!sources) {
                    this._audit.warn('COO',
                        `Sem fonte(s) para ${res} (deficit ${deficit}) para build em ${destCity.name} — ` +
                        `estoques: ${this._state.getAllCities()
                            .filter(c => c.id !== buildTask.cityId)
                            .map(c => `${c.name}=${this._availableAfterCommitments(c.id, res, ledger)}`)
                            .join(', ')}`,
                        { cityId: buildTask.cityId }
                    );
                    continue;
                }

                this._audit.info('COO',
                    `JIT multi-fonte para ${res}+${deficit} em ${destCity.name}: ` +
                    sources.map(s => `${s.city.name}→${s.amount}`).join(' + ')
                );

                for (const { city: src, amount: partial } of sources) {
                    await this._enqueueJIT(src, destCity, res, partial, buildTask, ledger);
                }
            }
        }
    }

    /** Enfileira um TRANSPORT JIT e atualiza o ledger com o comprometimento. */
    async _enqueueJIT(sourceCity, destCity, res, amount, buildTask, ledger) {
        const eta = await this._calculateEta(sourceCity, destCity, amount);
        if (!eta) return;

        const buildStart = buildTask.scheduledFor ?? Date.now();
        const bufferMs   = this._config.get('transportSafetyBufferS') * 1000;
        const dispatchTs = buildStart - (eta.totalEta * 1000) - bufferMs;
        const sendAt     = Math.max(dispatchTs, Date.now());
        const boats      = Math.ceil(amount / 500);

        this._queue.add({
            type:     'TRANSPORT',
            priority: 10,
            cityId:   sourceCity.id,
            payload: {
                fromCityId:       sourceCity.id,
                toCityId:         destCity.id,
                toIslandId:       destCity.islandId,
                cargo:            { [res]: amount },
                boats,
                totalCargo:       amount,
                estimatedReturnS: eta.travelTime * 2,
            },
            scheduledFor: sendAt,
            reason:       `COO JIT: ${res}+${amount} para ${buildTask.payload.building} em ${destCity.name}`,
            module:       'COO',
            confidence:   this._state.getConfidence(sourceCity.id),
        });

        // Atualizar ledger para que próximos recursos deste ciclo não reusem este estoque
        const entry = ledger.get(sourceCity.id);
        if (entry && res in entry) entry[res] += amount;

        this._events.emit(this._events.E.COO_TRANSPORT_SCHED, {
            task: { res, amount, source: sourceCity.id, dest: destCity.id, sendAt },
        });
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
        const ledger = this._buildCommitmentLedger();
        const source = this._findSource('wine', toSend, cityId, ledger);
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

        // Construir ledger uma vez para todo o ciclo de overflow
        const ledger = this._buildCommitmentLedger();

        for (const city of cities) {
            const before = overflowCount;
            this._checkCityOverflow(city, ledger);
            if (overflowCount > before) overflowCount++;
        }

        // Resumo limpo independente de overflow
        const summaries = cities.map(c => {
            if (!c.maxResources || c.maxResources === 0) return null;
            const pct = Math.max(...Object.values(c.resources).map(v => v / c.maxResources * 100));
            return `${c.name}=${Math.round(pct)}%`;
        }).filter(Boolean);

        this._audit.debug('COO', `Overflow check: ${summaries.join(' | ')} (cap=${cities[0]?.maxResources ?? '?'})`);
    }

    _checkCityOverflow(city, ledger = null) {
        const _ledger = ledger ?? this._buildCommitmentLedger();
        const maxRes = city.maxResources;
        if (!maxRes || maxRes === 0) return;

        for (const [res, qty] of Object.entries(city.resources)) {
            if (qty < maxRes * 0.95) continue; // < 95% — sem overflow

            this._audit.warn('COO',
                `Overflow de ${res} em ${city.name}: ${qty}/${maxRes}`,
                { cityId: city.id }
            );

            const excess = qty - Math.floor(maxRes * 0.80); // manter 80%
            if (excess <= 0) continue;

            // Verificar se já há transporte pendente deste recurso desta cidade
            const existente = this._queue.getPending(city.id)
                .find(t => t.type === 'TRANSPORT' && t.payload?.cargo?.[res]);
            if (existente) {
                this._audit.debug('COO',
                    `Overflow ${res} em ${city.name}: TRANSPORT já pendente [${existente.id}] — ignorado`
                );
                continue;
            }

            // Destino inteligente: cidade que mais precisa do recurso
            // (menor estoque relativo à capacidade), fallback para hub
            const dest = this._findOverflowDest(res, city.id) ?? this._hub;
            if (!dest || dest.id === city.id) continue;

            // Verificar se dest tem espaço (não está também em overflow)
            const destCity  = this._state.getCity(dest.id);
            const destSpace = Math.max(0, (destCity?.maxResources ?? 0) - (destCity?.resources[res] ?? 0));
            const toSend    = Math.min(excess, destSpace > 0 ? destSpace : excess);
            if (toSend <= 0) continue;

            const boats = Math.ceil(toSend / 500);

            this._queue.add({
                type:     'TRANSPORT',
                priority: 30,
                cityId:   city.id,
                payload: {
                    fromCityId:  city.id,
                    toCityId:    dest.id,
                    toIslandId:  dest.islandId,
                    cargo:       { [res]: toSend },
                    boats,
                    totalCargo:  toSend,
                },
                scheduledFor: Date.now(),
                reason:       `COO Overflow: ${res}+${toSend} de ${city.name} → ${dest.name}`,
                module:       'COO',
                confidence:   this._state.getConfidence(city.id),
            });

            // Atualizar ledger para evitar double-counting neste ciclo
            const entry = _ledger.get(city.id);
            if (entry && res in entry) entry[res] += toSend;
        }
    }

    // ── Estoque mínimo proativo ───────────────────────────────────────────────
    //
    // Garante que todas as cidades mantenham estoque mínimo de cada recurso.
    // Roda após _checkOverflow() no ciclo do Planner (fase CAPACIDADE).
    // Não age sobre cidades com emergência de sustento (buildBlocked já tratado pelo HR).
    // Não enfileira se já há TRANSPORT pendente cobrindo o deficit.
    //
    // Mínimo por recurso: configurable via config.get('minStockByResource') ou fallback.
    // Padrão: 20% da capacidade máxima do armazém de cada cidade.

    _checkMinimumStocks(ctx = null) {
        const cities = this._state.getAllCities();
        if (!cities.length) return;

        const ledger = this._buildCommitmentLedger();

        // Fallback: mínimo padrão = fração da capacidade
        const minFraction = this._config.get('minStockFraction') ?? 0.20;
        const RESOURCES   = ['wood', 'marble', 'glass', 'sulfur']; // vinho tratado pelo HR

        for (const city of cities) {
            const maxRes = city.maxResources ?? 0;
            if (!maxRes) continue;

            // Pular cidades com emergência de sustento (HR está agindo)
            const cityCtx = ctx?.cities?.get(city.id);
            if (cityCtx?.hasCriticalSupply) continue;

            for (const res of RESOURCES) {
                const minTarget = Math.floor(maxRes * minFraction);
                const onHand    = city.resources?.[res] ?? 0;

                // Incluir recursos em trânsito chegando nesta cidade
                const inTransit  = this._state.getInTransit?.(city.id)?.[res] ?? 0;
                const inQueue    = this._queue.getPending()
                    .filter(t => t.type === 'TRANSPORT' && t.payload?.toCityId === city.id && t.payload?.cargo?.[res])
                    .reduce((sum, t) => sum + (t.payload.cargo[res] ?? 0), 0);
                const effective  = onHand + inTransit + inQueue;

                if (effective >= minTarget) continue;

                const deficit = minTarget - effective;

                // Já há transporte pendente cobrindo este recurso? (dupla verificação)
                const existing = this._queue.getPending(city.id)
                    .find(t => t.type === 'TRANSPORT' && t.payload?.toCityId === city.id && t.payload?.cargo?.[res]);
                if (existing) continue;

                // Tentar fonte única
                const source = this._findSource(res, deficit, city.id, ledger);
                if (source) {
                    this._audit.info('COO',
                        `Estoque mínimo: ${city.name} precisa +${deficit} de ${res} ` +
                        `(tem ${onHand}, mín=${minTarget}) — fonte: ${source.name}`
                    );
                    const boats = Math.ceil(deficit / 500);
                    this._queue.add({
                        type:     'TRANSPORT',
                        priority: 20,
                        cityId:   source.id,
                        payload: {
                            fromCityId:  source.id,
                            toCityId:    city.id,
                            toIslandId:  city.islandId,
                            cargo:       { [res]: deficit },
                            boats,
                            totalCargo:  deficit,
                            minStock:    true,
                        },
                        scheduledFor: Date.now(),
                        reason:       `COO MinStock: ${res}+${deficit} → ${city.name} (mín ${minTarget})`,
                        module:       'COO',
                        confidence:   this._state.getConfidence(source.id),
                    });
                    // Atualizar ledger para não alocar este estoque duas vezes
                    const entry = ledger.get(source.id);
                    if (entry && res in entry) entry[res] += deficit;

                    this._events.emit(this._events.E.COO_MIN_STOCK_SCHED, {
                        cityId: city.id, res, amount: deficit, source: source.id,
                    });
                } else {
                    // Tentar multi-fonte
                    const sources = this._findMultiSource(res, deficit, city.id, ledger);
                    if (!sources) {
                        this._audit.debug('COO',
                            `MinStock: sem fonte para ${res}+${deficit} em ${city.name} — recursos insuficientes no sistema`
                        );
                        continue;
                    }
                    this._audit.info('COO',
                        `Estoque mínimo multi-fonte: ${city.name} precisa +${deficit} de ${res} — ` +
                        sources.map(s => `${s.city.name}→${s.amount}`).join(' + ')
                    );
                    for (const { city: src, amount: partial } of sources) {
                        const boats = Math.ceil(partial / 500);
                        this._queue.add({
                            type:     'TRANSPORT',
                            priority: 20,
                            cityId:   src.id,
                            payload: {
                                fromCityId:  src.id,
                                toCityId:    city.id,
                                toIslandId:  city.islandId,
                                cargo:       { [res]: partial },
                                boats,
                                totalCargo:  partial,
                                minStock:    true,
                            },
                            scheduledFor: Date.now(),
                            reason:       `COO MinStock multi: ${res}+${partial} → ${city.name}`,
                            module:       'COO',
                            confidence:   this._state.getConfidence(src.id),
                        });
                        const entry = ledger.get(src.id);
                        if (entry && res in entry) entry[res] += partial;
                    }
                }
            }
        }
    }

    // ── Destino de overflow inteligente ──────────────────────────────────────

    /**
     * Encontra a cidade que mais precisa de `resource` (menor % de capacidade),
     * excluindo a cidade origem e cidades já em overflow do mesmo recurso.
     */
    _findOverflowDest(resource, excludeCityId) {
        const cities = this._state.getAllCities()
            .filter(c => c.id !== excludeCityId)
            .filter(c => {
                const max = c.maxResources ?? 0;
                if (max === 0) return false;
                // Não enviar para cidade que também está em overflow
                return (c.resources[resource] ?? 0) < max * 0.90;
            });

        if (!cities.length) return this._hub ?? null;

        // Cidade com menor % de estoque = mais necessitada
        return cities.sort((a, b) => {
            const pctA = (a.resources[resource] ?? 0) / (a.maxResources || 1);
            const pctB = (b.resources[resource] ?? 0) / (b.maxResources || 1);
            return pctA - pctB;
        })[0];
    }

    // ── Ledger de recursos comprometidos ─────────────────────────────────────
    //
    // Rastreia quanto de cada recurso em cada cidade já está destinado a algum lugar
    // (na fila de TRANSPORT + em trânsito saindo). Isso evita que _findSource
    // ofereça recursos que já foram alocados para outro transporte pendente.
    //
    // Estrutura: Map<cityId, { wood: N, wine: N, marble: N, glass: N, sulfur: N }>

    _buildCommitmentLedger() {
        const ledger = new Map();

        const init = (cityId) => {
            if (!ledger.has(cityId)) {
                ledger.set(cityId, createEmptyResources());
            }
            return ledger.get(cityId);
        };

        // 1. Transportes pendentes na fila (ainda não saíram)
        for (const task of this._queue.getPending()) {
            if (task.type !== 'TRANSPORT') continue;
            const from  = task.payload?.fromCityId;
            const cargo = task.payload?.cargo;
            if (!from || !cargo) continue;
            const entry = init(from);
            for (const [res, qty] of Object.entries(cargo)) {
                if (res in entry) entry[res] += Number(qty) || 0;
            }
        }

        // 2. Frotas em trânsito saindo (isReturn=false, isOwn=true)
        for (const mv of this._state.fleetMovements ?? []) {
            if (!mv.isOwn || mv.isReturn) continue;
            const from  = mv.originCityId ?? mv.sourceCityId;
            const cargo = mv.cargo;
            if (!from || !cargo) continue;
            const entry = init(from);
            for (const [res, qty] of Object.entries(cargo)) {
                if (res in entry) entry[res] += Number(qty) || 0;
            }
        }

        return ledger;
    }

    /**
     * Retorna quanto de `resource` a cidade `cityId` tem disponível
     * descontando o que já está comprometido no ledger.
     */
    _availableAfterCommitments(cityId, resource, ledger) {
        const city = this._state.getCity(cityId);
        if (!city) return 0;
        const committed = ledger.get(cityId)?.[resource] ?? 0;
        return Math.max(0, (city.resources[resource] ?? 0) - committed);
    }

    // ── Busca de fonte (ledger-aware) ─────────────────────────────────────────

    /** Cidades que produzem `resource` como tradegood da ilha. */
    _getProducers(resource) {
        const ordinal = TradeGoodOrdinals[resource.toUpperCase()];
        if (!ordinal) return [];
        return this._state.getAllCities().filter(c => c.tradegood === ordinal);
    }

    _findSource(resource, amount, excludeCityId, ledger = null) {
        const _ledger = ledger ?? this._buildCommitmentLedger();

        const cities = this._state.getAllCities()
            .filter(c => c.id !== excludeCityId)
            .filter(c => this._availableAfterCommitments(c.id, resource, _ledger) > amount * 1.1);

        if (!cities.length) return null;

        // Prioridade: produtor → hub → mais disponível
        const producer = this._getProducers(resource).find(p => cities.some(c => c.id === p.id));
        if (producer) return producer;

        if (this._hub && cities.some(c => c.id === this._hub.id)) return this._hub;

        return cities.sort((a, b) =>
            this._availableAfterCommitments(b.id, resource, _ledger) -
            this._availableAfterCommitments(a.id, resource, _ledger)
        )[0];
    }

    /** Múltiplas fontes para cobrir `amount`. Retorna [{city, amount}] ou null. */
    _findMultiSource(resource, amount, excludeCityId, ledger = null) {
        const _ledger = ledger ?? this._buildCommitmentLedger();
        const RESERVE = 0.10; // guardar 10% na fonte

        const producerIds = new Set(this._getProducers(resource).map(p => p.id));

        const candidates = this._state.getAllCities()
            .filter(c => c.id !== excludeCityId)
            .map(c => ({
                city:     c,
                avail:    Math.floor(this._availableAfterCommitments(c.id, resource, _ledger) * (1 - RESERVE)),
                producer: producerIds.has(c.id),
            }))
            .filter(e => e.avail > 0)
            // Produtores primeiro, depois por quantidade disponível
            .sort((a, b) => (b.producer - a.producer) || (b.avail - a.avail));

        const result  = [];
        let remaining = amount;

        for (const { city, avail } of candidates) {
            if (remaining <= 0) break;
            const send = Math.min(avail, remaining);
            result.push({ city, amount: Math.ceil(send) });
            remaining -= send;
        }

        // Só retorna se conseguiu cobrir o total
        return remaining <= 0 ? result : null;
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
