// COO.js — Chief Operating Officer
// Logística JIT: agendar transportes para que recursos cheguem antes das builds.
// Detectar overflow e redistribuir. Identificar hub central.
// Escuta QUEUE_TASK_ADDED (não CFO_BUILD_APPROVED) — desacoplado do CFO.

import { PORT_LOADING_SPEED, TRAVEL } from '../data/const.js';
import { WINE_USE } from '../data/wine.js';
import { CITY_ROLE } from './CityClassifier.js';
import { EMPIRE_STAGE } from './EmpireStage.js';
import { GLOBAL_GOAL } from './GoalEngine.js';
import { TransportIntentRegistry } from './TransportIntentRegistry.js';
import { createEmptyResources } from './resourceContracts.js';
import { TASK_TYPE } from './taskTypes.js';
import { createSafeStorage } from './SafeStorage.js';
import { identifyHub, buildCityClassification } from './HubSelector.js';
import { checkCityOverflow } from './OverflowDetector.js';

const RESOURCES = ['wood', 'wine', 'marble', 'glass', 'sulfur'];

export class COO {
    constructor({ events, audit, config, state, queue, client, storage, transportIntentRegistry = null }) {
        this._events  = events;
        this._audit   = audit;
        this._config  = config;
        this._state   = state;
        this._queue   = queue;
        this._client  = client;
        this._storage = storage;
        this._safeStorage = createSafeStorage(storage, { module: 'COO', audit });
        this._transportIntentRegistry = transportIntentRegistry;

        this._hub = null; // cidade hub identificada
        this._cityClassifications = new Map();
        this._strategicCtx = { stage: null, globalGoal: null };
        this._unsubscribers = [];
    }

    getHub() {
        return this._hub ? { ...this._hub } : null;
    }

    getCityClassifications() {
        return new Map(this._cityClassifications);
    }

    init() {
        const E = this._events.E;

        // JIT: novo BUILD na fila → agendar transporte de recursos
        this._trackUnsub(this._events.on(E.QUEUE_TASK_ADDED, ({ task }) => {
            if (task.type === TASK_TYPE.BUILD) this._scheduleJITForBuild(task);
        }));

        // STATE_ALL_FRESH removido — orquestrado pelo Planner

        // Detecção de overflow — não agir durante fetchAllCities
        this._trackUnsub(this._events.on(E.DC_HEADER_DATA, () => {
            if (this._state.isProbing()) return;
            if (!this._hub) return;
            const cityId = this._state.getActiveCityId();
            const city   = cityId ? this._state.getCity(cityId) : null;
            if (city && this._state.getConfidence(cityId) !== 'UNKNOWN') {
                this._checkCityOverflow(city);
            }
        }));

        // Emergência de vinho: agendar transporte de vinho do hub
        this._trackUnsub(this._events.on(E.HR_WINE_EMERGENCY, (payload = {}) => {
            this._scheduleWineEmergency(payload.cityId, payload);
        }));
    }

    shutdown() {
        for (const unsub of this._unsubscribers.splice(0)) {
            try { unsub(); } catch { /* best-effort */ }
        }
    }

    _trackUnsub(unsub) {
        if (typeof unsub === 'function') this._unsubscribers.push(unsub);
    }

    replan(ctx = null) {
        this._strategicCtx = {
            stage: ctx?.stage ?? null,
            globalGoal: ctx?.globalGoal ?? null,
            growthPolicy: ctx?.growthPolicy ?? null,
            fleetPolicy: ctx?.fleetPolicy ?? null,
        };
        const strategicGoal = ctx?.globalGoal ?? null;
        if (strategicGoal) {
            this._audit.debug('COO', `Replan com objetivo global=${strategicGoal}`);
        }
        this._hub = this._identifyHub();
        this._cityClassifications = this._buildCityClassification();
        this._checkOverflow();
        this._checkMinimumStocks(ctx);
        this._planFleetCapex(ctx);

        // Atualizar contexto com transportes já enfileirados para cada cidade
        if (ctx) {
            for (const [cityId, cityCtx] of ctx.cities) {
                cityCtx.pendingTransports = this._queue.getPending()
                    .filter(t => t.type === TASK_TYPE.TRANSPORT && t.payload?.toCityId === cityId);
            }
        }
    }

    _planFleetCapex(ctx = null) {
        const fleetPolicy = ctx?.fleetPolicy ?? this._strategicCtx?.fleetPolicy ?? null;
        const buyNow = Number(fleetPolicy?.recommendedCargoShipsToBuy ?? 0);
        if (buyNow <= 0) return;

        const alreadyQueued = this._queue.getPending()
            .some((t) => t.type === TASK_TYPE.NAVIGATE && t.reasonCode === 'FLEET_CAPEX_RECOMMENDATION');
        if (alreadyQueued) return;

        const cities = this._state.getAllCities();
        const city = cities.find((c) => c?.isCapital) ?? cities[0];
        if (!city?.id) return;

        const evidence = [
            `fleetReadiness=${Number(fleetPolicy?.fleetReadiness ?? 0).toFixed(2)}`,
            `freeCargoShips=${Number(fleetPolicy?.freeCargoShips ?? 0)}`,
            `totalCargoShips=${Number(fleetPolicy?.totalCargoShips ?? 0)}`,
            `recommendedCargoShipsToBuy=${buyNow}`,
            ...(Array.isArray(fleetPolicy?.fleetBlockingFactors)
                ? fleetPolicy.fleetBlockingFactors.map((f) => `fleetBlock=${f}`)
                : []),
        ];

        this._queue.add({
            type: TASK_TYPE.NAVIGATE,
            priority: 8,
            cityId: city.id,
            payload: {
                view: 'port',
                fleetRecommendation: true,
                recommendedCargoShipsToBuy: buyNow,
            },
            scheduledFor: Date.now(),
            reason: `COO Fleet CAPEX: recomendar compra de ${buyNow} navios de carga`,
            reasonCode: 'FLEET_CAPEX_RECOMMENDATION',
            evidence,
            module: 'COO',
            confidence: this._state.getConfidence(city.id),
        });
    }

    // ── JIT para BUILD ────────────────────────────────────────────────────────

    async _scheduleJITForBuild(buildTask) {
        const destCity = this._state.getCity(buildTask.cityId);
        if (!destCity || !buildTask.payload?.cost) return;

        const classifications = this._buildCityClassification({
            buildFocusCityIds: new Set([buildTask.cityId]),
        });

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
            const singleSource = this._findSource(res, deficit, buildTask.cityId, ledger, classifications);

            if (singleSource) {
                await this._enqueueJIT(singleSource, destCity, res, deficit, buildTask, ledger);
            } else {
                // Fonte única não tem o suficiente — tentar múltiplas fontes
                const sources = this._findMultiSource(res, deficit, buildTask.cityId, ledger, classifications);
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
        const sourceClass = this._cityClassifications.get(sourceCity.id) ?? null;
        const sourceSafetyStock = this._getCitySafetyStock(sourceCity, res, sourceClass);
        const sourceOnHand = Number(sourceCity.resources?.[res] ?? 0);
        const sourceAfter = Math.max(0, sourceOnHand - amount);
        const reasonCode = 'COO_JIT_TRANSPORT_FOR_BUILD';
        const evidence = [
            `buildTaskId=${buildTask.id}`,
            `buildCityId=${buildTask.cityId}`,
            `resource=${res}`,
            `amount=${amount}`,
            `sourceCityId=${sourceCity.id}`,
            `destCityId=${destCity.id}`,
            `sourceOnHand=${sourceOnHand}`,
            `sourceSafetyStock=${sourceSafetyStock}`,
            `sourceAfterDispatch=${sourceAfter}`,
            `etaTotalS=${eta.totalEta}`,
            `scheduledFor=${new Date(sendAt).toISOString()}`,
        ];

        this._enqueueTransportTask({
            type:     TASK_TYPE.TRANSPORT,
            priority: 10,
            cityId:   sourceCity.id,
            payload: {
                fromCityId:       sourceCity.id,
                toCityId:         destCity.id,
                toIslandId:       destCity.islandId,
                cargo:            { [res]: amount },
                boats,
                totalCargo:       amount,
                jitBuild:         true,
                logisticPurpose:  'jitBuild',
                estimatedReturnS: eta.travelTime * 2,
            },
            scheduledFor: sendAt,
            reason:       `COO JIT: ${res}+${amount} para ${buildTask.payload.building} em ${destCity.name}`,
            reasonCode,
            evidence,
            module:       'COO',
            confidence:   this._state.getConfidence(sourceCity.id),
        });

        // Atualizar ledger para que próximos recursos deste ciclo não reusem este estoque
        const entry = ledger.get(sourceCity.id);
        if (entry && res in entry) entry[res] += amount;

        this._events.emit(this._events.E.COO_TRANSPORT_SCHED, {
            task: { res, amount, source: sourceCity.id, dest: destCity.id, sendAt, reasonCode, evidence },
        });
    }

    // ── Emergência de vinho ───────────────────────────────────────────────────

    _scheduleWineEmergency(cityId, emergencyCtx = {}) {
        const city = this._state.getCity(cityId);
        if (!city) return;

        const wineSpendingsRaw = Number(city.production?.wineSpendings ?? 0);
        const recoveryLevel = Math.max(1, Number(emergencyCtx?.recoveryWineLevel ?? city.tavern?.wineLevel ?? 0));
        const bootstrapRecovery = Boolean(emergencyCtx?.bootstrapRecovery);
        const bootstrapFallbackSpendings = WINE_USE[recoveryLevel] ?? WINE_USE[1] ?? 4;
        const requestedAmount = Number(emergencyCtx?.targetWineAmount ?? 0);
        const wineSpendings = wineSpendingsRaw > 0
            ? wineSpendingsRaw
            : Number(emergencyCtx?.recoveryWinePerHour ?? bootstrapFallbackSpendings);
        if ((!wineSpendings || wineSpendings <= 0) && requestedAmount <= 0) return;

        // Enviar buffer ajustado por maturidade estratégica
        const policy = this._resolveTransportPolicy(this._strategicCtx);
        const coverageHours = bootstrapRecovery
            ? policy.wineBootstrapCoverageHours
            : (emergencyCtx?.wineMode === 'IMPORT_WINE' ? policy.wineRecoveryCoverageHours : policy.wineEmergencyCoverageHours);
        const needed = requestedAmount > 0
            ? requestedAmount
            : (wineSpendings * coverageHours);

        const purpose = bootstrapRecovery
            ? 'wineBootstrap'
            : (emergencyCtx?.wineMode === 'IMPORT_WINE' ? 'wineRecovery' : 'wineEmergency');
        const committed = this._getReservedCoverage(cityId, 'wine', purpose);

        if (committed >= needed) {
            this._audit.debug('COO',
                `Emergência vinho ${city.name}: já há ${committed}u comprometidos para ${purpose} ≥ ${needed}u necessários — ignorado`
            );
            return;
        }

        const toSend = needed - committed;
        const allCities = this._state.getAllCities().filter(c => c.id !== cityId);
        const ledger = this._buildCommitmentLedger();
        const classifications = this._buildCityClassification();
        const source = this._findSource('wine', toSend, cityId, ledger, classifications);
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

        this._enqueueTransportTask({
            type:     TASK_TYPE.TRANSPORT,
            priority: bootstrapRecovery ? policy.wineBootstrapPriority : policy.wineRecoveryPriority,
            cityId:   source.id,
            payload: {
                fromCityId:   source.id,
                toCityId:     cityId,
                toIslandId:   city.islandId,
                cargo:        { wine: toSend },
                boats,
                totalCargo:   toSend,
                wineEmergency: true,
                wineBootstrapRecovery: bootstrapRecovery,
                wineRecovery: !bootstrapRecovery && purpose === 'wineRecovery',
                logisticPurpose: purpose,
                recoveryWineLevel: bootstrapRecovery ? recoveryLevel : null,
            },
            scheduledFor: Date.now(),
            reason:       bootstrapRecovery
                ? `COO: Recuperação de taberna em ${city.name} — enviar ${toSend}u de vinho`
                : (purpose === 'wineRecovery'
                    ? `COO: Recuperação de sustento em ${city.name} — enviar ${toSend}u de vinho`
                    : `COO: Emergência de vinho em ${city.name} — enviar ${toSend}u`),
            module:       'COO',
            confidence:   'HIGH',
        });
    }

    // ── Overflow ──────────────────────────────────────────────────────────────

    _checkOverflow() {
        const classifications = this._buildCityClassification();
        this._cityClassifications = classifications;

        const cities = this._state.getAllCities().slice().sort((a, b) => {
            const pa = classifications.get(a.id)?.storagePressure ?? 0;
            const pb = classifications.get(b.id)?.storagePressure ?? 0;
            return pb - pa;
        });
        let overflowCount = 0;

        // Construir ledger uma vez para todo o ciclo de overflow
        const ledger = this._buildCommitmentLedger();

        for (const city of cities) {
            overflowCount += this._checkCityOverflow(city, ledger, classifications);
        }

        // Resumo limpo independente de overflow
        const summaries = cities.map(c => {
            if (!c.maxResources || c.maxResources === 0) return null;
            const pct = Math.max(...Object.values(c.resources).map(v => v / c.maxResources * 100));
            return `${c.name}=${Math.round(pct)}%`;
        }).filter(Boolean);

        this._audit.debug('COO',
            `Overflow check: ${summaries.join(' | ')} (cap=${cities[0]?.maxResources ?? '?'}) overflows=${overflowCount}`
        );
    }

    _checkCityOverflow(city, ledger = null, classifications = null) {
        return checkCityOverflow({
            city,
            classifications: classifications ?? this._cityClassifications,
            ledger: ledger ?? this._buildCommitmentLedger(),
            queue: this._queue,
            config: {
                overflowTargetTimeToCapHours: this._config.get('overflowTargetTimeToCapHours') ?? 6,
            },
            hub: this._hub,
            state: this._state,
            getReservedCoverage: (toCityId, resource, purpose) => this._getReservedCoverage(toCityId, resource, purpose),
            findOverflowDest: (resource, excludeCityId, cls, amountHint) => this._findOverflowDest(resource, excludeCityId, cls, amountHint),
            enqueueTransportTask: (task) => this._enqueueTransportTask(task),
            audit: this._audit,
        });
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
        const strategicGoal = ctx?.globalGoal ?? null;
        const cities = this._state.getAllCities();
        if (!cities.length) return;

        const ledger = this._buildCommitmentLedger();
        const classifications = this._buildCityClassification();
        this._cityClassifications = classifications;

        // Fallback: mínimo padrão = fração da capacidade
        const policy = this._resolveTransportPolicy(ctx ?? this._strategicCtx);
        const minFraction = policy.minStockFraction;
        const RESOURCES   = ['wood', 'marble', 'glass', 'sulfur']; // vinho tratado pelo HR
        const hasPendingWineRecovery = this._queue.getPending().some((t) =>
            t.type === TASK_TYPE.TRANSPORT && (
                t.payload?.wineEmergency === true
                || t.payload?.wineBootstrapRecovery === true
                || t.payload?.cargo?.wine > 0
            )
        );

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
                const reserved = this._getReservedCoverage(city.id, res, 'minStock');
                const effective  = onHand + reserved;

                if (effective >= minTarget) continue;

                const deficit = minTarget - effective;

                // Já há cobertura comprometida para este destino/recurso/finalidade?
                if (reserved >= deficit) continue;

                // Tentar fonte única
                const source = this._findSource(res, deficit, city.id, ledger, classifications);
                if (source) {
                    this._audit.info('COO',
                        `Estoque mínimo: ${city.name} precisa +${deficit} de ${res} ` +
                        `(tem ${onHand}, mín=${minTarget}) — fonte: ${source.name}`
                    );
                    const boats = Math.ceil(deficit / 500);
                    const priorityShift = hasPendingWineRecovery && (res === 'marble' || res === 'glass' || res === 'sulfur')
                        ? 8
                        : 0;
                    this._enqueueTransportTask({
                        type:     TASK_TYPE.TRANSPORT,
                        priority: policy.minStockPriority + priorityShift,
                        cityId:   source.id,
                        payload: {
                            fromCityId:  source.id,
                            toCityId:    city.id,
                            toIslandId:  city.islandId,
                            cargo:       { [res]: deficit },
                            boats,
                            totalCargo:  deficit,
                            minStock:    true,
                            logisticPurpose: 'minStock',
                            strategicGoal,
                            strategicStage: (ctx ?? this._strategicCtx)?.stage ?? null,
                        },
                        scheduledFor: Date.now(),
                        reason:       `COO MinStock: ${res}+${deficit} → ${city.name} (mín ${minTarget})` +
                            (strategicGoal ? ` [goal=${strategicGoal}]` : ''),
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
                    const sources = this._findMultiSource(res, deficit, city.id, ledger, classifications);
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
                        const priorityShift = hasPendingWineRecovery && (res === 'marble' || res === 'glass' || res === 'sulfur')
                            ? 8
                            : 0;
                        this._enqueueTransportTask({
                            type:     TASK_TYPE.TRANSPORT,
                            priority: policy.minStockPriority + priorityShift,
                            cityId:   src.id,
                            payload: {
                                fromCityId:  src.id,
                                toCityId:    city.id,
                                toIslandId:  city.islandId,
                                cargo:       { [res]: partial },
                                boats,
                                totalCargo:  partial,
                                minStock:    true,
                                logisticPurpose: 'minStock',
                                strategicGoal,
                                strategicStage: (ctx ?? this._strategicCtx)?.stage ?? null,
                            },
                            scheduledFor: Date.now(),
                            reason:       `COO MinStock multi: ${res}+${partial} → ${city.name}` +
                                (strategicGoal ? ` [goal=${strategicGoal}]` : ''),
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
    _findOverflowDest(resource, excludeCityId, classifications = null, amountHint = 0) {
        const _classifications = classifications ?? this._cityClassifications;
        const cities = this._state.getAllCities()
            .filter(c => c.id !== excludeCityId)
            .filter(c => {
                const max = c.maxResources ?? 0;
                if (max === 0) return false;
                const current = c.resources[resource] ?? 0;
                const space = Math.max(0, max - current);
                if (space <= 0) return false;
                const cls = _classifications.get(c.id);
                if (cls?.overflowFlags?.[resource]) return false;
                return true;
            });

        if (!cities.length) return this._hub ?? null;

        // Preferir cidades com necessidade real e espaço disponível.
        return cities.sort((a, b) => {
            const clsA = _classifications.get(a.id);
            const clsB = _classifications.get(b.id);
            const maxA = a.maxResources || 1;
            const maxB = b.maxResources || 1;
            const needA = clsA?.deficitFlags?.[resource] ? 1 : 0;
            const needB = clsB?.deficitFlags?.[resource] ? 1 : 0;
            if (needB !== needA) return needB - needA;
            const pctA = (a.resources[resource] ?? 0) / (a.maxResources || 1);
            const pctB = (b.resources[resource] ?? 0) / (b.maxResources || 1);
            if (pctA !== pctB) return pctA - pctB;

            const spaceA = Math.max(0, maxA - (a.resources[resource] ?? 0));
            const spaceB = Math.max(0, maxB - (b.resources[resource] ?? 0));
            if (amountHint > 0 && Math.abs(spaceB - spaceA) > 0) return spaceB - spaceA;

            const pressureA = clsA?.storagePressure ?? 1;
            const pressureB = clsB?.storagePressure ?? 1;
            return pressureA - pressureB;
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
            if (task.type !== TASK_TYPE.TRANSPORT) continue;
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

    _resolveTransportPurpose(payload = {}) {
        if (payload?.wineBootstrapRecovery) return 'wineBootstrap';
        if (payload?.wineRecovery) return 'wineRecovery';
        if (payload?.wineEmergency) return 'wineEmergency';
        if (payload?.jitBuild) return 'jitBuild';
        if (payload?.minStock) return 'minStock';
        if (payload?.overflowRelief) return 'overflowRelief';
        return payload?.logisticPurpose ?? 'generic';
    }

    _reservationKey(toCityId, resource, purpose) {
        return `${Number(toCityId)}|${String(resource)}|${String(purpose)}`;
    }

    _buildPurposeReservations() {
        const map = new Map();
        const add = (toCityId, resource, purpose, amount) => {
            if (!toCityId || !resource || !purpose) return;
            const qty = Number(amount) || 0;
            if (qty <= 0) return;
            const key = this._reservationKey(toCityId, resource, purpose);
            map.set(key, (map.get(key) ?? 0) + qty);
        };

        const reservations = this._queue?.getTransportReservations?.() ?? [];
        if (reservations.length > 0) {
            for (const r of reservations) {
                add(r.toCityId, r.resource, r.purpose, r.amount);
            }
        } else {
            // Fallback para stubs de teste e integrações antigas sem getTransportReservations().
            const pending = this._queue?.getPending?.() ?? [];
            for (const t of pending) {
                if (t?.type !== TASK_TYPE.TRANSPORT) continue;
                const p = t.payload ?? {};
                const purpose = this._resolveTransportPurpose(p);
                for (const [res, qty] of Object.entries(p.cargo ?? {})) {
                    add(p.toCityId, res, purpose, qty);
                }
            }
        }

        return map;
    }

    _getReservedCoverage(toCityId, resource, purpose) {
        const byPurpose = this._buildPurposeReservations();
        const purposeQty = byPurpose.get(this._reservationKey(toCityId, resource, purpose)) ?? 0;
        const inTransitAny = Number(this._state.getInTransit?.(toCityId)?.[resource] ?? 0);
        return Math.max(0, purposeQty + inTransitAny);
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

    _findSource(resource, amount, excludeCityId, ledger = null, classifications = null) {
        const _ledger = ledger ?? this._buildCommitmentLedger();
        const _classifications = classifications ?? this._cityClassifications;

        const cities = this._state.getAllCities()
            .filter(c => c.id !== excludeCityId)
            .map(c => {
                const cityClass = _classifications.get(c.id) ?? null;
                const safetyStock = this._getCitySafetyStock(c, resource, cityClass);
                const available = Math.max(0, this._availableAfterCommitments(c.id, resource, _ledger) - safetyStock);
                return {
                    city: c,
                    available,
                    producer: this._isProducerForResource(cityClass, resource),
                };
            })
            .filter(e => e.available >= amount)
            .sort((a, b) => {
                if (b.producer !== a.producer) return Number(b.producer) - Number(a.producer);
                const aHub = this._hub && a.city.id === this._hub.id ? 1 : 0;
                const bHub = this._hub && b.city.id === this._hub.id ? 1 : 0;
                if (bHub !== aHub) return bHub - aHub;
                return b.available - a.available || Number(a.city.id) - Number(b.city.id);
            });

        if (!cities.length) return null;
        return cities[0].city;
    }

    /** Múltiplas fontes para cobrir `amount`. Retorna [{city, amount}] ou null. */
    _findMultiSource(resource, amount, excludeCityId, ledger = null, classifications = null) {
        const _ledger = ledger ?? this._buildCommitmentLedger();
        const _classifications = classifications ?? this._cityClassifications;

        const candidates = this._state.getAllCities()
            .filter(c => c.id !== excludeCityId)
            .map(c => ({
                city:     c,
                avail:    Math.max(0,
                    Math.floor(
                        this._availableAfterCommitments(c.id, resource, _ledger) -
                        this._getCitySafetyStock(c, resource, _classifications.get(c.id) ?? null)
                    )
                ),
                producer: this._isProducerForResource(_classifications.get(c.id) ?? null, resource),
            }))
            .filter(e => e.avail > 0)
            // Produtores primeiro, depois por quantidade disponível
            .sort((a, b) => (b.producer - a.producer) || (b.avail - a.avail) || (Number(a.city.id) - Number(b.city.id)));

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

    _enqueueTransportTask(taskData) {
        if (taskData?.type !== TASK_TYPE.TRANSPORT) return this._queue.add(taskData);

        const payload = taskData.payload ?? {};
        const purpose = this._resolveTransportPurpose(payload);
        const mainCargo = TransportIntentRegistry.resolveMainCargo(payload.cargo ?? {});

        if (this._transportIntentRegistry) {
            const reconcile = this._transportIntentRegistry.reconcileEquivalent({
                purpose,
                fromCityId: Number(payload.fromCityId ?? taskData.cityId ?? NaN),
                toCityId: Number(payload.toCityId ?? NaN),
                resource: mainCargo.resource,
                amount: mainCargo.amount,
            });
            if (reconcile.shouldSkipEnqueue) {
                const evidence = reconcile.evidence.join(';');
                this._audit.info('COO',
                    `TRANSPORT skip por reconciliação intent=${reconcile.intentId} status=${reconcile.status} evidence=${evidence}`
                );
                return {
                    id: reconcile.intentId,
                    type: TASK_TYPE.TRANSPORT,
                    status: 'reconciled',
                    cityId: taskData.cityId,
                    payload: { ...payload, intentId: reconcile.intentId },
                    reconciliation: reconcile,
                };
            }
            this._transportIntentRegistry.ensureFromTaskData(taskData);
        }

        return this._queue.add(taskData);
    }

    _getCitySafetyStock(city, resource, cityClass = null) {
        const policy = this._resolveTransportPolicy(this._strategicCtx);
        const fraction = policy.minStockFraction;
        const producerMultiplier = this._config.get('producerSafetyStockMultiplier') ?? 1.35;
        const maxResRaw = city?.maxResources;
        const maxRes = typeof maxResRaw === 'number'
            ? maxResRaw
            : Number(maxResRaw?.[resource] ?? 0);
        const base = Math.floor(Math.max(0, maxRes) * fraction);
        const isProducer = this._isProducerForResource(cityClass, resource);
        return isProducer ? Math.ceil(base * producerMultiplier) : base;
    }

    _resolveTransportPolicy(ctx = null) {
        const stage = ctx?.stage ?? null;
        const goal = ctx?.globalGoal ?? null;
        const growthStage = ctx?.growthPolicy?.growthStage ?? ctx?.growthStage ?? null;
        const resourceFocus = ctx?.growthPolicy?.recommendedResourceFocus ?? null;
        const baseMinStockFraction = this._config.get('minStockFraction') ?? 0.20;

        const policy = {
            minStockFraction: baseMinStockFraction,
            minStockPriority: 20,
            wineEmergencyCoverageHours: 24,
            wineBootstrapCoverageHours: 12,
            wineBootstrapPriority: 0,
            wineRecoveryCoverageHours: 16,
            wineRecoveryPriority: 2,
        };

        if (stage === EMPIRE_STAGE.BOOTSTRAP) {
            policy.minStockFraction = Math.max(baseMinStockFraction, 0.25);
            policy.minStockPriority = 24;
            policy.wineEmergencyCoverageHours = 18;
            policy.wineBootstrapCoverageHours = 12;
        } else if (stage === EMPIRE_STAGE.PRE_EXPANSION) {
            policy.minStockFraction = Math.max(baseMinStockFraction, 0.30);
            policy.minStockPriority = 16;
            policy.wineEmergencyCoverageHours = 30;
            policy.wineBootstrapCoverageHours = 16;
        } else if (stage === EMPIRE_STAGE.MULTI_CITY_EARLY) {
            policy.minStockFraction = Math.max(baseMinStockFraction, 0.28);
            policy.minStockPriority = 12;
            policy.wineEmergencyCoverageHours = 28;
            policy.wineBootstrapCoverageHours = 14;
        }

        if (goal === GLOBAL_GOAL.PREPARE_EXPANSION) {
            policy.minStockFraction = Math.max(policy.minStockFraction, 0.32);
            policy.minStockPriority = Math.min(policy.minStockPriority, 14);
        }
        if (goal === GLOBAL_GOAL.CONSOLIDATE_NEW_CITY) {
            policy.minStockFraction = Math.max(policy.minStockFraction, 0.30);
            policy.minStockPriority = Math.min(policy.minStockPriority, 12);
        }
        if (goal === GLOBAL_GOAL.SURVIVE) {
            policy.minStockPriority = Math.max(policy.minStockPriority, 26);
            policy.wineEmergencyCoverageHours = Math.max(policy.wineEmergencyCoverageHours, 36);
            policy.wineBootstrapCoverageHours = Math.max(policy.wineBootstrapCoverageHours, 18);
        }

        // Overlay incremental da policy de crescimento (sem substituir stage/goal atuais).
        if (growthStage === 'BOOTSTRAP_CITY') {
            policy.minStockFraction = Math.max(policy.minStockFraction, 0.26);
            policy.minStockPriority = Math.max(policy.minStockPriority, 24);
            policy.wineEmergencyCoverageHours = Math.max(policy.wineEmergencyCoverageHours, 20);
            policy.wineBootstrapCoverageHours = Math.max(policy.wineBootstrapCoverageHours, 14);
        } else if (growthStage === 'STABILIZE_CITY') {
            policy.minStockFraction = Math.max(policy.minStockFraction, 0.28);
            policy.minStockPriority = Math.max(policy.minStockPriority, 20);
            policy.wineEmergencyCoverageHours = Math.max(policy.wineEmergencyCoverageHours, 24);
            policy.wineBootstrapCoverageHours = Math.max(policy.wineBootstrapCoverageHours, 16);
        } else if (growthStage === 'THROUGHPUT_GROWTH') {
            policy.minStockFraction = Math.max(policy.minStockFraction, 0.24);
            policy.minStockPriority = Math.max(policy.minStockPriority, 18);
        } else if (growthStage === 'PREPARE_EXPANSION') {
            policy.minStockFraction = Math.max(policy.minStockFraction, 0.32);
            policy.minStockPriority = Math.min(policy.minStockPriority, 14);
            policy.wineEmergencyCoverageHours = Math.max(policy.wineEmergencyCoverageHours, 30);
            policy.wineBootstrapCoverageHours = Math.max(policy.wineBootstrapCoverageHours, 16);
        } else if (growthStage === 'CONSOLIDATE_NEW_CITY') {
            policy.minStockFraction = Math.max(policy.minStockFraction, 0.30);
            policy.minStockPriority = Math.min(policy.minStockPriority, 12);
            policy.wineEmergencyCoverageHours = Math.max(policy.wineEmergencyCoverageHours, 28);
            policy.wineBootstrapCoverageHours = Math.max(policy.wineBootstrapCoverageHours, 16);
        }

        if (resourceFocus === 'SUPPLY_STABILITY') {
            policy.minStockFraction = Math.max(policy.minStockFraction, 0.30);
        } else if (resourceFocus === 'EXPANSION_STOCKPILE') {
            policy.minStockFraction = Math.max(policy.minStockFraction, 0.33);
            policy.minStockPriority = Math.min(policy.minStockPriority, 12);
        }

        return policy;
    }

    _isProducerForResource(cityClass, resource) {
        if (!cityClass) return false;
        if (resource === 'wine') return cityClass.roles?.includes(CITY_ROLE.PRODUCER_WINE) ?? false;
        if (resource === 'marble') return cityClass.roles?.includes(CITY_ROLE.PRODUCER_MARBLE) ?? false;
        if (resource === 'glass') return cityClass.roles?.includes(CITY_ROLE.PRODUCER_CRYSTAL) ?? false;
        if (resource === 'sulfur') return cityClass.roles?.includes(CITY_ROLE.PRODUCER_SULFUR) ?? false;
        return false;
    }

    _buildCityClassification({ buildFocusCityIds = null } = {}) {
        return buildCityClassification({
            cities: this._state.getAllCities(),
            queuePending: this._queue.getPending(),
            getInTransit: (cityId) => this._state.getInTransit?.(cityId) ?? createEmptyResources(),
            config: {
                minStockFraction: this._config.get('minStockFraction') ?? 0.20,
                overflowThresholdPct: this._config.get('overflowThresholdPct') ?? 0.95,
                overflowTimeToCapHours: this._config.get('overflowTimeToCapHours') ?? 2,
            },
            hubCityId: this._hub?.id ?? null,
            buildFocusCityIds,
        });
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
                    cached = await this._safeStorage.get(cacheKey, null);
                }

                if (!cached) {
                    cached = await this._client.probeJourneyTime(originCity.id, destCity.id);
                    if (cached && this._storage) {
                        await this._safeStorage.set(cacheKey, cached);
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
        const best = identifyHub(this._state.getAllCities());
        if (best && best !== this._hub) {
            this._audit.info('COO', `Hub identificado: ${best.name}`);
        }
        return best;
    }

}
