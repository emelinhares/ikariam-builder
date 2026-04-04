// HR.js — Human Resources
// Monitora estoque de vinho e ajusta o nível da taberna.
// Trigger em DC_HEADER_DATA (a cada XHR) para detecção mais rápida possível.

import { getMinWineLevel, getMaxServableWineLevel, WINE_USE } from '../data/wine.js';
import { EMPIRE_STAGE } from './EmpireStage.js';
import { GLOBAL_GOAL } from './GoalEngine.js';
import { TASK_TYPE } from './taskTypes.js';
import { evaluateWineSustainPolicy, WINE_MODE } from './WineSustainPolicy.js';

export class HR {
    constructor({ events, audit, config, state, queue }) {
        this._events = events;
        this._audit  = audit;
        this._config = config;
        this._state  = state;
        this._queue  = queue;

        // Cooldown: evitar flood de WINE_EMERGENCY — Map<cityId, lastEmittedTs>
        this._wineEmergencyCooldown = new Map();
        this._COOLDOWN_MS = 10 * 60 * 1000; // 10 minutos entre emissões por cidade

        // Anti-oscilação: nível mínimo confirmado que mantém satisfaction >= 1
        // Map<cityId, number> — atualizado quando satisfaction < 1 após tentativa de baixar
        this._wineLevelFloor = new Map();
        // Última população conhecida — para resetar floor quando pop cresce
        this._lastPopulation = new Map();
        this._unsubscribers = [];
    }

    init() {
        const E = this._events.E;

        // Verificação a cada headerData — não agir durante fetchAllCities
        this._trackUnsub(this._events.on(E.DC_HEADER_DATA, () => {
            if (this._state.isProbing()) return;
            const cityId = this._state.getActiveCityId();
            if (!cityId || this._state.getConfidence(cityId) === 'UNKNOWN') return;
            const city = this._state.getCity(cityId);
            if (!city) return;

            // Resetar floor se população cresceu (mais pessoas = pode precisar de mais vinho)
            const prevPop = this._lastPopulation.get(cityId) ?? 0;
            const curPop  = city.economy?.population ?? 0;
            if (curPop > prevPop) {
                this._wineLevelFloor.delete(cityId);
                this._audit.debug('HR',
                    `Pop de ${city.name} cresceu (${prevPop}→${curPop}) — floor de vinho resetado`
                );
            }
            this._lastPopulation.set(cityId, curPop);

            this._checkWineRisk(city);
        }));

        // Log periódico de status de vinho (max 1x por ciclo de fetchAllCities)
        this._lastWineLog = new Map(); // cityId → { hours, ts }

        // STATE_ALL_FRESH removido — orquestrado pelo Planner

        // Scope D — simulação imediata de impacto econômico para realocação em TownHall.
        // Permite que chamadores emitam HR_WORKER_REALLOC com "allocationAfter" para
        // obter/logar o impacto antes da confirmação final.
        this._trackUnsub(this._events.on(E.HR_WORKER_REALLOC, (payload = {}) => {
            const cityId = Number(payload.cityId ?? 0);
            if (!cityId || !payload.allocationAfter) return;
            this.simulateTownHallImmediateImpact({
                cityId,
                allocationAfter: payload.allocationAfter,
                action: payload.action,
                emitDecisionRecord: payload.emitDecisionRecord !== false,
            });
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
        const cities = this._state.getAllCities();

        // Relatório de ciclo — snapshot consolidado de vinho em todas as cidades
        const lines = cities.map(c => {
            const wine = c.resources?.wine ?? 0;
            const signals = this._resolveCitySignals(c);
            let spendings = signals.wineSpendings;
            if (spendings <= 0 && c.tavern?.wineLevel > 0) {
                spendings = WINE_USE[c.tavern.wineLevel] ?? 0;
            }
            const hours = spendings > 0 ? (wine / spendings).toFixed(1) : '∞';
            const sat   = signals.happinessScore;
            const flag  = (spendings > 0 && wine / spendings < this._config.get('wineEmergencyHours'))
                ? ' ⚠' : (sat !== null && sat <= 0 ? ' ⚠sat' : '');
            return `${c.name}=${hours}h sat=${sat ?? '?'} nv${c.tavern?.wineLevel ?? 0}${flag}`;
        });
        this._audit.info('HR', `Ciclo vinho: ${lines.join(' | ')}`);

        for (const city of cities) {
            this._checkWineRisk(city, true, ctx); // ignorar cooldown no replan explícito
            this._checkWineLevel(city, ctx);
            this._checkWorkforce(city, ctx);
        }
    }

    _checkWorkforce(city, ctx = null) {
        if (!ctx?.cities || !(ctx.cities instanceof Map)) return;

        const cityCtx = ctx.cities.get(city.id);
        if (!cityCtx) return;

        const currentScientists = Number(city?.workers?.scientists ?? 0);
        const recommendedScientists = Number(cityCtx.recommendedScientists ?? currentScientists);
        const idlePopulation = Number(cityCtx.idlePopulation ?? 0);
        const productionFloorMet = Boolean(cityCtx.productionFloorMet);
        const blockingFactors = Array.isArray(cityCtx.workforceBlockingFactors)
            ? cityCtx.workforceBlockingFactors
            : [];
        const reasons = Array.isArray(cityCtx.workforceReasons)
            ? cityCtx.workforceReasons
            : [];

        // Reação explícita: cidade com população ociosa + produção insuficiente não fica silenciosa.
        if (idlePopulation > 0 && !productionFloorMet) {
            cityCtx.workforceActionRecommendation = {
                type: 'WORKFORCE_REALLOCATE_IDLE',
                cityId: city.id,
                recommendedWorkersWood: Number(cityCtx.recommendedWorkersWood ?? city.workers?.wood ?? 0),
                recommendedWorkersTradegood: Number(cityCtx.recommendedWorkersTradegood ?? city.workers?.tradegood ?? 0),
                recommendedScientists,
                blockingFactors,
                reasons,
            };
        }

        if (blockingFactors.length > 0) {
            this._audit.debug('HR',
                `Workforce ${city.name}: bloqueada (${blockingFactors.join(' | ')})`
            );
            return;
        }

        // Integração incremental executável no contrato atual: ajuste de cientistas via WORKER_REALLOC.
        if (recommendedScientists <= currentScientists) return;
        if (this._queue.hasPendingType(TASK_TYPE.WORKER_REALLOC, city.id)) return;

        const academy = (city.buildings ?? [])
            .filter(b => b.building === 'academy')
            .sort((a, b) => (b.level ?? 0) - (a.level ?? 0))[0] ?? null;
        if (!academy?.position && academy?.position !== 0) {
            cityCtx.workforceBlockingFactors = [
                ...(Array.isArray(cityCtx.workforceBlockingFactors) ? cityCtx.workforceBlockingFactors : []),
                'academy_position_missing_for_scientist_realloc',
            ];
            return;
        }

        this._queue.add({
            type: TASK_TYPE.WORKER_REALLOC,
            priority: 28,
            cityId: city.id,
            payload: {
                position: academy.position,
                scientists: recommendedScientists,
                stage: ctx?.stage ?? null,
                strategicGoal: ctx?.globalGoal ?? null,
            },
            scheduledFor: Date.now(),
            reason: `HR Workforce: cientistas ${currentScientists}→${recommendedScientists} (idle=${idlePopulation}, growth=${ctx?.growthPolicy?.growthStage ?? 'N/A'})`,
            module: 'HR',
            confidence: this._state.getConfidence?.(city.id) ?? 'MEDIUM',
            maxAttempts: 4,
        });

        this._events.emit(this._events.E.HR_WORKER_REALLOC, {
            cityId: city.id,
            action: `Alocar ${recommendedScientists - currentScientists} população ociosa para cientistas`,
            allocationAfter: {
                scientists: recommendedScientists,
            },
            source: 'WORKFORCE_POLICY',
        });

        this._audit.info('HR',
            `Workforce ${city.name}: enfileirado WORKER_REALLOC para ${recommendedScientists} cientistas (antes=${currentScientists}, idle=${idlePopulation})`
        );
    }

    _resolveWinePolicy(ctx = null) {
        const baseThreshold = this._config.get('wineEmergencyHours');
        const stage = ctx?.stage ?? null;
        const goal = ctx?.globalGoal ?? null;
        const growthStage = ctx?.growthPolicy?.growthStage ?? null;
        const resourceFocus = ctx?.growthPolicy?.recommendedResourceFocus ?? null;

        const policy = {
            emergencyHoursThreshold: baseThreshold,
            emergencyMinWineLevel: 0,
            lowerOnlyIfSatisfactionAtLeast: 1,
            raiseIfSatisfactionBelow: 1,
        };

        if (stage === EMPIRE_STAGE.BOOTSTRAP || stage === EMPIRE_STAGE.EARLY_GROWTH) {
            policy.emergencyHoursThreshold = baseThreshold + 1.5;
            policy.emergencyMinWineLevel = 1;
            policy.lowerOnlyIfSatisfactionAtLeast = 3;
            policy.raiseIfSatisfactionBelow = 2;
        } else if (stage === EMPIRE_STAGE.PRE_EXPANSION) {
            policy.emergencyHoursThreshold = baseThreshold + 1;
            policy.emergencyMinWineLevel = 1;
            policy.lowerOnlyIfSatisfactionAtLeast = 2;
            policy.raiseIfSatisfactionBelow = 1.5;
        } else if (stage === EMPIRE_STAGE.MULTI_CITY_EARLY) {
            policy.emergencyHoursThreshold = baseThreshold + 1;
            policy.emergencyMinWineLevel = 1;
            policy.lowerOnlyIfSatisfactionAtLeast = 2.5;
            policy.raiseIfSatisfactionBelow = 2;
        }

        if (goal === GLOBAL_GOAL.SURVIVE) {
            policy.emergencyHoursThreshold = Math.max(policy.emergencyHoursThreshold, baseThreshold + 2);
            policy.emergencyMinWineLevel = Math.max(policy.emergencyMinWineLevel, 1);
            policy.raiseIfSatisfactionBelow = Math.max(policy.raiseIfSatisfactionBelow, 2);
        } else if (goal === GLOBAL_GOAL.CONSOLIDATE_NEW_CITY) {
            policy.lowerOnlyIfSatisfactionAtLeast = Math.max(policy.lowerOnlyIfSatisfactionAtLeast, 2.5);
            policy.raiseIfSatisfactionBelow = Math.max(policy.raiseIfSatisfactionBelow, 1.8);
        }

        // Overlay incremental de GrowthPolicy para early game.
        if (growthStage === 'BOOTSTRAP_CITY') {
            policy.emergencyHoursThreshold = Math.max(policy.emergencyHoursThreshold, baseThreshold + 2);
            policy.emergencyMinWineLevel = Math.max(policy.emergencyMinWineLevel, 1);
            policy.lowerOnlyIfSatisfactionAtLeast = Math.max(policy.lowerOnlyIfSatisfactionAtLeast, 3);
            policy.raiseIfSatisfactionBelow = Math.max(policy.raiseIfSatisfactionBelow, 2);
        } else if (growthStage === 'STABILIZE_CITY') {
            policy.emergencyHoursThreshold = Math.max(policy.emergencyHoursThreshold, baseThreshold + 1.5);
            policy.lowerOnlyIfSatisfactionAtLeast = Math.max(policy.lowerOnlyIfSatisfactionAtLeast, 2.5);
            policy.raiseIfSatisfactionBelow = Math.max(policy.raiseIfSatisfactionBelow, 1.8);
        } else if (growthStage === 'PREPARE_EXPANSION' || growthStage === 'CONSOLIDATE_NEW_CITY') {
            policy.emergencyHoursThreshold = Math.max(policy.emergencyHoursThreshold, baseThreshold + 1);
            policy.emergencyMinWineLevel = Math.max(policy.emergencyMinWineLevel, 1);
        }

        if (resourceFocus === 'WINE_AND_GOLD_STABILITY' || resourceFocus === 'SUPPLY_STABILITY') {
            policy.emergencyHoursThreshold = Math.max(policy.emergencyHoursThreshold, baseThreshold + 2);
            policy.raiseIfSatisfactionBelow = Math.max(policy.raiseIfSatisfactionBelow, 2);
        }

        return policy;
    }

    // ── Risco de esgotamento ──────────────────────────────────────────────────

    _resolveCitySignals(city) {
        const typed = city?.typed ?? {};
        const workersByResource = city?.workersByResource ?? city?.workers ?? {};

        return {
            happinessScore: typed.happinessScore ?? city?.economy?.satisfaction ?? null,
            happinessState: typed.happinessState ?? null,
            populationGrowthPerHour: Number(typed.populationGrowthPerHour ?? city?.economy?.growthPerHour ?? 0),
            populationUsed: Number(typed.populationUsed ?? city?.economy?.population ?? 0),
            maxInhabitants: Number(typed.maxInhabitants ?? city?.economy?.maxInhabitants ?? 0),
            populationUtilization: Number(typed.populationUtilization ?? 0),
            wineSpendings: Number(typed.wineSpendings ?? city?.production?.wineSpendings ?? 0),
            workersByResource: {
                wood: Number(workersByResource.wood ?? city?.workers?.wood ?? 0),
                tradegood: Number(workersByResource.tradegood ?? city?.workers?.tradegood ?? 0),
                scientists: Number(workersByResource.scientists ?? city?.workers?.scientists ?? 0),
                priests: Number(workersByResource.priests ?? city?.workers?.priests ?? 0),
                citizens: Number(workersByResource.citizens ?? city?.economy?.citizens ?? 0),
            },
        };
    }

    _checkWineRisk(city, ignoreCooldown = false, ctx = null) {
        const signals = this._resolveCitySignals(city);
        const wine = Number(city.resources?.wine ?? 0);
        const policy = this._resolveWinePolicy(ctx);
        const sustain = evaluateWineSustainPolicy({
            city,
            signals,
            ctx,
            emergencyHours: policy.emergencyHoursThreshold,
        });
        const threshold = sustain.emergencyHoursThreshold;
        const hoursLeft = sustain.wineCoverageHours;
        const spendings = sustain.effectiveWineSpendings;

        if (ctx?.cities instanceof Map) {
            const cityCtx = ctx.cities.get(city.id);
            if (cityCtx) {
                cityCtx.wineSustain = sustain;
                cityCtx.wineHours = sustain.wineCoverageHours;
                cityCtx.wineBootstrapNeeded = sustain.needsTavernBootstrap;
                cityCtx.hasCriticalSupply = sustain.wineRiskLevel === 'CRITICAL' || sustain.needsWineImport;
            }
        }

        if (sustain.wineMode === WINE_MODE.BOOTSTRAP_TAVERN
            || sustain.wineMode === WINE_MODE.CRITICAL_NO_WINE
            || sustain.wineMode === WINE_MODE.IMPORT_WINE) {
            this._triggerWineEmergency(city, sustain, ignoreCooldown, ctx);
            return;
        }

        // Log apenas quando estado muda significativamente (evitar flood por DC_HEADER_DATA)
        this._logWineIfChanged(city, wine, Math.max(1, spendings), Number.isFinite(hoursLeft) ? hoursLeft : Infinity, threshold);
    }

    _triggerWineEmergency(city, sustain, ignoreCooldown = false, ctx = null) {
        const now = Date.now();
        if (!ignoreCooldown) {
            const lastEmit = this._wineEmergencyCooldown.get(city.id) ?? 0;
            if (now - lastEmit < this._COOLDOWN_MS) {
                this._audit.debug('HR',
                    `Vinho ${city.name}: emergência em cooldown por mais ${Math.round((this._COOLDOWN_MS - (now - lastEmit)) / 60000)}min`
                );
                return;
            }
        }
        this._wineEmergencyCooldown.set(city.id, now);

        const bootstrapRecovery = sustain.wineMode === WINE_MODE.BOOTSTRAP_TAVERN
            || sustain.wineMode === WINE_MODE.CRITICAL_NO_WINE;

        this._events.emit(this._events.E.HR_WINE_EMERGENCY, {
            cityId: city.id,
            hoursLeft: sustain.wineCoverageHours,
            bootstrapRecovery,
            wineRecovery: sustain.wineMode === WINE_MODE.BOOTSTRAP_TAVERN,
            recoveryWineLevel: sustain.targetWineLevel,
            recoveryWinePerHour: sustain.effectiveWineSpendings,
            targetWineAmount: sustain.targetWineAmount,
            targetWineCoverageHours: sustain.targetWineCoverageHours,
            wineMode: sustain.wineMode,
            wineReasons: sustain.wineReasons,
            wineBlockingFactors: sustain.wineBlockingFactors,
        });

        this._audit.warn('HR',
            `SUSTENTO DE VINHO em ${city.name}: mode=${sustain.wineMode} risk=${sustain.wineRiskLevel} cov=${Number.isFinite(sustain.wineCoverageHours) ? sustain.wineCoverageHours.toFixed(1) : '∞'}h`,
            { cityId: city.id }
        );

        if (sustain.needsTavernAdjustment && !this._queue.hasPendingType(TASK_TYPE.WINE_ADJUST, city.id)) {
            const targetLevel = Math.max(0, sustain.targetWineLevel);
            if (targetLevel !== (city.tavern?.wineLevel ?? 0)) {
                this._queue.add({
                    type: TASK_TYPE.WINE_ADJUST,
                    priority: 0,
                    cityId: city.id,
                    payload: {
                        wineLevel: targetLevel,
                        wineEmergency: true,
                        wineBootstrap: sustain.needsTavernBootstrap,
                    },
                    scheduledFor: Date.now(),
                    reason: `HR Sustain: taberna ${city.tavern?.wineLevel ?? 0}→${targetLevel} (${sustain.wineMode})`,
                    module: 'HR',
                    confidence: 'HIGH',
                    maxAttempts: 5,
                });
            }
        }

        if (ctx?.cities instanceof Map) {
            const cityCtx = ctx.cities.get(city.id);
            if (cityCtx) {
                if (cityCtx.markWineHandled) {
                    cityCtx.markWineHandled({ wineBootstrapNeeded: sustain.needsTavernBootstrap });
                } else {
                    cityCtx.wineEmergencyHandled = true;
                    cityCtx.wineBootstrapNeeded = sustain.needsTavernBootstrap;
                }
            }
        }
    }

    _checkWineBootstrapRecovery(city, signals, ignoreCooldown = false, ctx = null) {
        const tavernBuilding = (city.buildings ?? []).find((b) => b.building === 'tavern');
        const tavernExists = Number(tavernBuilding?.level ?? 0) > 0;
        if (!tavernExists) return;

        const wine = Number(city.resources?.wine ?? 0);
        if (wine > 0) return;

        const policy = this._resolveWinePolicy(ctx);
        const growthStage = ctx?.growthPolicy?.growthStage ?? null;
        const strategicGoal = ctx?.globalGoal ?? null;

        const isStrategicRecoveryStage =
            growthStage === 'BOOTSTRAP_CITY'
            || growthStage === 'STABILIZE_CITY'
            || growthStage === 'CONSOLIDATE_NEW_CITY'
            || strategicGoal === GLOBAL_GOAL.SURVIVE
            || strategicGoal === GLOBAL_GOAL.CONSOLIDATE_NEW_CITY;

        const satisfaction = signals.happinessScore;
        const growthPerHour = Number(signals.populationGrowthPerHour ?? 0);
        const popUtil = Number(signals.populationUtilization ?? 0);
        const needsStability =
            (satisfaction !== null && satisfaction <= 1)
            || growthPerHour <= 0
            || popUtil >= 0.9;

        if (!isStrategicRecoveryStage && !needsStability) return;

        const now = Date.now();
        if (!ignoreCooldown) {
            const lastEmit = this._wineEmergencyCooldown.get(city.id) ?? 0;
            if (now - lastEmit < this._COOLDOWN_MS) {
                this._audit.debug('HR',
                    `Wine bootstrap ${city.name}: cooldown por mais ${Math.round((this._COOLDOWN_MS - (now - lastEmit)) / 60000)}min`
                );
                return;
            }
        }
        this._wineEmergencyCooldown.set(city.id, now);

        const recoveryWineLevel = Math.max(1, Number(policy.emergencyMinWineLevel ?? 0));
        const recoveryWinePerHour = WINE_USE[recoveryWineLevel] ?? WINE_USE[1] ?? 4;

        this._events.emit(this._events.E.HR_WINE_EMERGENCY, {
            cityId: city.id,
            hoursLeft: 0,
            bootstrapRecovery: true,
            recoveryWineLevel,
            recoveryWinePerHour,
            growthStage,
            strategicGoal,
        });

        this._audit.warn('HR',
            `BOOTSTRAP DE VINHO em ${city.name}: vinho zerado com consumo inativo (taberna=${city.tavern?.wineLevel ?? 0}, sat=${satisfaction ?? 'N/A'}, growth=${growthPerHour}/h)`,
            { cityId: city.id }
        );

        if (ctx) {
            const cityCtx = ctx.cities.get(city.id);
            if (cityCtx) {
                if (cityCtx.markWineHandled) {
                    cityCtx.markWineHandled({ wineBootstrapNeeded: true });
                } else {
                    cityCtx.wineEmergencyHandled = true;
                    cityCtx.wineBootstrapNeeded = true;
                }
            }
        }
    }

    // ── Log inteligente de vinho ──────────────────────────────────────────────

    _logWineIfChanged(city, wine, spendings, hoursLeft, threshold) {
        const last = this._lastWineLog?.get(city.id);

        // Thresholds de urgência para forçar log
        const BOUNDS = [1, 4, 8, 24, 48];
        const crossedBound = last != null && BOUNDS.some(b =>
            (last.hours >= b && hoursLeft < b) || (last.hours < b && hoursLeft >= b)
        );

        // Log se: primeira vez, cruzou threshold, variou >10%, ou passou 5min
        const changed = !last ||
            crossedBound ||
            Math.abs(hoursLeft - last.hours) / Math.max(last.hours, 1) > 0.10 ||
            (Date.now() - last.ts) > 300_000;

        if (!changed) return;

        if (!this._lastWineLog) this._lastWineLog = new Map();
        this._lastWineLog.set(city.id, { hours: hoursLeft, ts: Date.now() });

        const urgency = hoursLeft < threshold ? '⚠ CRÍTICO' : hoursLeft < 8 ? '⚠ BAIXO' : 'ok';
        this._audit.debug('HR',
            `Vinho ${city.name}: ${wine}u ÷ ${spendings}/h = ${hoursLeft.toFixed(1)}h [${urgency}] taverna nv.${city.tavern?.wineLevel ?? '?'}`
        );
    }

    // ── Ajuste de nível da taberna baseado em satisfação ─────────────────────
    //
    // Objetivo: manter satisfaction >= 1 (população cresce) com o mínimo de vinho.
    //
    // Lógica:
    //   satisfaction > 1 e nível > floor → estamos acima do necessário → tentar baixar 1
    //   satisfaction == 1               → nível ideal → não mexer
    //   satisfaction < 1 e nível < max  → precisamos de mais → subir 1 + atualizar floor
    //
    // Anti-oscilação (_wineLevelFloor):
    //   Quando satisfaction cai < 1, registramos que o nível atual é o floor.
    //   Nunca baixamos abaixo do floor — evita loop subir/descer infinito.
    //   O floor é limpo quando a população cresce (satisfazer nível mais alto é necessário).

    _checkWineLevel(city, ctx = null) {
        const current      = city.tavern?.wineLevel ?? 0;
        const signals = this._resolveCitySignals(city);
        const satisfaction = signals.happinessScore;
        const policy       = this._resolveWinePolicy(ctx);

        // Sem taberna física — nada a fazer
        const tavernBuilding = (city.buildings ?? []).find(b => b.building === 'tavern');
        const tavernLevel    = tavernBuilding?.level ?? 0;
        if (!tavernLevel) return;

        const maxServable = getMaxServableWineLevel(tavernLevel);

        // null = jogo não reportou ainda → aguardar dado real antes de agir
        if (satisfaction === null) return;

        // Não interferir durante emergência real — _checkWineRisk cuida de satisfaction <= 0
        if (satisfaction <= 0) return;

        // Sem ajuste pendente (evitar sobreposição)
        if (this._queue.getPending(city.id).some(t => t.type === TASK_TYPE.WINE_ADJUST)) return;

        // Segurança: servidor debita 1h de vinho ao mudar nível
        const wine      = city.resources?.wine ?? 0;
        const spendings = signals.wineSpendings > 0
            ? signals.wineSpendings
            : (WINE_USE[current] ?? 0);
        const hoursLeft = spendings > 0 ? wine / spendings : Infinity;
        if (hoursLeft < 2) {
            this._audit.debug('HR',
                `WINE_ADJUST bloqueado em ${city.name}: estoque ${hoursLeft.toFixed(1)}h < 2h`
            );
            return;
        }

        const floor = this._wineLevelFloor.get(city.id) ?? 0;

        let targetLevel = current;
        const growthPerHour = Number(signals.populationGrowthPerHour ?? 0);
        const popUtil = Number(signals.populationUtilization ?? 0);

        if ((popUtil < 0.75 && growthPerHour > 0 && satisfaction > policy.lowerOnlyIfSatisfactionAtLeast)
            && current > 0 && current > floor) {
            // Cidade com folga de habitação e crescimento sustentável → reduzir custo de vinho.
            targetLevel = current - 1;
        } else if (satisfaction > policy.lowerOnlyIfSatisfactionAtLeast && current > 0 && current > floor) {
            // Acima do necessário e acima do floor confirmado → tentar baixar 1 nível
            targetLevel = current - 1;
        } else if ((satisfaction < policy.raiseIfSatisfactionBelow || (popUtil >= 0.9 && growthPerHour <= 0))
            && current < maxServable) {
            // Insuficiente → subir 1 nível e registrar que o nível atual é o floor mínimo
            targetLevel = current + 1;
            this._wineLevelFloor.set(city.id, targetLevel);
            this._audit.debug('HR',
                `Floor de vinho de ${city.name} atualizado para nv.${targetLevel} (sat=${satisfaction})`
            );
        } else {
            return; // nível correto ou limitado pelo floor/max
        }

        const direction = targetLevel > current ? '↑' : '↓';
        this._audit.info('HR',
            `Ajuste taberna ${city.name}: nv.${current}${direction}${targetLevel} ` +
            `(sat=${satisfaction} floor=${floor} tavernMax=${maxServable})`
        );

        this._queue.add({
            type:     TASK_TYPE.WINE_ADJUST,
            priority: 20,
            cityId:   city.id,
            payload:  { wineLevel: targetLevel },
            scheduledFor: Date.now(),
            reason:   `HR: taberna ${current}${direction}${targetLevel} (sat=${satisfaction})`,
            module:   'HR',
            confidence: this._state.getConfidence(city.id),
        });

        this._events.emit(this._events.E.HR_WINE_ADJUSTED, {
            cityId:   city.id,
            oldLevel: current,
            newLevel: targetLevel,
        });
    }

    // ── Scope D: simulador imediato de impacto TownHall ───────────────────────

    /**
     * Simula impacto imediato de realocação TownHall (workers/scientists/citizens).
     *
     * Fórmula mandatória (gold/h):
     *   Novo_Ouro_H = (Cidadãos_Livres * 3) - (Trabalhadores * 3) - (Cientistas * 6)
     */
    simulateTownHallImmediateImpact({
        cityId,
        allocationAfter = {},
        action = null,
        emitDecisionRecord = true,
    } = {}) {
        const city = this._state.getCity?.(cityId);
        if (!city) return null;

        const before = this._buildTownHallAllocationSnapshot(city, {});
        const after  = this._buildTownHallAllocationSnapshot(city, allocationAfter);

        const beforeGoldPerHour = this._calcTownHallGoldPerHour(before);
        const afterGoldPerHour  = this._calcTownHallGoldPerHour(after);
        const deltaGoldPerHour  = afterGoldPerHour - beforeGoldPerHour;

        const woodPerWorker = before.woodWorkers > 0
            ? (Number(city.production?.wood ?? 0) / before.woodWorkers)
            : 0;
        const luxuryPerWorker = before.luxuryWorkers > 0
            ? (Number(city.production?.tradegood ?? 0) / before.luxuryWorkers)
            : 0;

        const woodBeforePerHour   = Number(city.production?.wood ?? 0);
        const luxuryBeforePerHour = Number(city.production?.tradegood ?? 0);
        const woodAfterPerHour    = Math.round(after.woodWorkers * woodPerWorker);
        const luxuryAfterPerHour  = Math.round(after.luxuryWorkers * luxuryPerWorker);

        const deltaWoodPerHour   = woodAfterPerHour - woodBeforePerHour;
        const deltaLuxuryPerHour = luxuryAfterPerHour - luxuryBeforePerHour;
        const deltaSciencePerHour = after.scientists - before.scientists;

        const baselineCashflow = Math.abs(beforeGoldPerHour);
        const impactPct = baselineCashflow > 0
            ? (deltaGoldPerHour / baselineCashflow) * 100
            : (deltaGoldPerHour === 0 ? 0 : (deltaGoldPerHour > 0 ? 100 : -100));

        const reasonCode = 'HR_TOWNHALL_IMMEDIATE_IMPACT';
        const evidence = [
            `cityId=${city.id}`,
            `before.citizens=${before.citizens}`,
            `before.workers=${before.workersTotal}`,
            `before.scientists=${before.scientists}`,
            `after.citizens=${after.citizens}`,
            `after.workers=${after.workersTotal}`,
            `after.scientists=${after.scientists}`,
            `goldFormula=(citizens*3)-(workers*3)-(scientists*6)`,
            `goldBeforePerHour=${beforeGoldPerHour}`,
            `goldAfterPerHour=${afterGoldPerHour}`,
            `delta.goldPerHour=${deltaGoldPerHour}`,
            `delta.woodPerHour=${deltaWoodPerHour}`,
            `delta.luxuryPerHour=${deltaLuxuryPerHour}`,
            `delta.sciencePerHour=${deltaSciencePerHour}`,
            `impact.cashflowPct=${impactPct.toFixed(1)}%`,
        ];

        const summary = this._buildTownHallImpactSummary({
            action,
            deltaSciencePerHour,
            deltaGoldPerHour,
            impactPct,
        });

        const decision = {
            cityId: city.id,
            reasonCode,
            evidence,
            summary,
            before: {
                citizens: before.citizens,
                workers: before.workersTotal,
                scientists: before.scientists,
                woodPerHour: woodBeforePerHour,
                luxuryPerHour: luxuryBeforePerHour,
                goldPerHour: beforeGoldPerHour,
            },
            after: {
                citizens: after.citizens,
                workers: after.workersTotal,
                scientists: after.scientists,
                woodPerHour: woodAfterPerHour,
                luxuryPerHour: luxuryAfterPerHour,
                goldPerHour: afterGoldPerHour,
            },
            delta: {
                woodPerHour: deltaWoodPerHour,
                luxuryPerHour: deltaLuxuryPerHour,
                sciencePerHour: deltaSciencePerHour,
                goldPerHour: deltaGoldPerHour,
                cashflowPct: Number(impactPct.toFixed(1)),
            },
        };

        if (emitDecisionRecord) {
            this._audit.info('HR', summary, {
                reasonCode,
                evidence,
                impact: decision,
            }, city.id);
        }

        return decision;
    }

    _calcTownHallGoldPerHour({ citizens, workersTotal, scientists }) {
        // Novo_Ouro_H = (Cidadãos_Livres * 3) - (Trabalhadores * 3) - (Cientistas * 6)
        return (citizens * 3) - (workersTotal * 3) - (scientists * 6);
    }

    _buildTownHallAllocationSnapshot(city, allocationAfter = {}) {
        const signals = this._resolveCitySignals(city);
        const population = Number(signals.populationUsed ?? city.economy?.population ?? 0);

        const beforeWoodWorkers = Number(signals.workersByResource.wood ?? city.workers?.wood ?? 0);
        const beforeLuxuryWorkers = Number(signals.workersByResource.tradegood ?? city.workers?.tradegood ?? 0);
        const beforePriests = Number(signals.workersByResource.priests ?? city.workers?.priests ?? 0);
        const beforeScientists = Number(signals.workersByResource.scientists ?? city.workers?.scientists ?? 0);
        const beforeWorkersTotal = beforeWoodWorkers + beforeLuxuryWorkers + beforePriests;

        const inferredCitizens = Math.max(0, population - beforeWorkersTotal - beforeScientists);
        const cityCitizens = Number(city.economy?.citizens ?? inferredCitizens);

        let woodWorkers = beforeWoodWorkers;
        let luxuryWorkers = beforeLuxuryWorkers;
        let priests = beforePriests;
        let scientists = beforeScientists;
        let citizens = cityCitizens;

        if (allocationAfter.workers && typeof allocationAfter.workers === 'object') {
            if (allocationAfter.workers.wood !== undefined) woodWorkers = Number(allocationAfter.workers.wood);
            if (allocationAfter.workers.tradegood !== undefined) luxuryWorkers = Number(allocationAfter.workers.tradegood);
            if (allocationAfter.workers.priests !== undefined) priests = Number(allocationAfter.workers.priests);
        }
        if (allocationAfter.woodWorkers !== undefined) woodWorkers = Number(allocationAfter.woodWorkers);
        if (allocationAfter.luxuryWorkers !== undefined) luxuryWorkers = Number(allocationAfter.luxuryWorkers);
        if (allocationAfter.priests !== undefined) priests = Number(allocationAfter.priests);
        if (allocationAfter.scientists !== undefined) scientists = Number(allocationAfter.scientists);

        const workersTotal = woodWorkers + luxuryWorkers + priests;

        if (allocationAfter.citizens !== undefined) {
            citizens = Number(allocationAfter.citizens);
        } else {
            // Compatível com o modelo existente: manter conservação da população ocupada.
            const referencePopulation = Math.max(population, cityCitizens + beforeWorkersTotal + beforeScientists);
            citizens = Math.max(0, referencePopulation - workersTotal - scientists);
        }

        return {
            citizens: Math.max(0, Math.round(citizens)),
            workersTotal: Math.max(0, Math.round(workersTotal)),
            scientists: Math.max(0, Math.round(scientists)),
            woodWorkers: Math.max(0, Math.round(woodWorkers)),
            luxuryWorkers: Math.max(0, Math.round(luxuryWorkers)),
            priests: Math.max(0, Math.round(priests)),
        };
    }

    _buildTownHallImpactSummary({ action, deltaSciencePerHour, deltaGoldPerHour, impactPct }) {
        const fmtSigned = (n) => `${n >= 0 ? '+' : ''}${Math.round(n)}`;
        const fmtSignedPct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

        let actionLabel = action;
        if (!actionLabel) {
            if (deltaSciencePerHour > 0) actionLabel = `Alocando ${deltaSciencePerHour} cientistas`;
            else if (deltaSciencePerHour < 0) actionLabel = `Removendo ${Math.abs(deltaSciencePerHour)} cientistas`;
            else actionLabel = 'Rebalanceando alocação';
        }

        return `${actionLabel}: ${fmtSigned(deltaGoldPerHour)} gold/h, ` +
            `${fmtSigned(deltaSciencePerHour)} ciência/h. ` +
            `Impacto líquido: ${fmtSignedPct(impactPct)} no fluxo de caixa total.`;
    }
}
