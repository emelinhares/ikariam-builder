// HR.js — Human Resources
// Monitora estoque de vinho e ajusta o nível da taberna.
// Trigger em DC_HEADER_DATA (a cada XHR) para detecção mais rápida possível.

import { getMinWineLevel, getMaxServableWineLevel, WINE_USE } from '../data/wine.js';
import { TASK_TYPE } from './taskTypes.js';

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
    }

    init() {
        const E = this._events.E;

        // Verificação a cada headerData — não agir durante fetchAllCities
        this._events.on(E.DC_HEADER_DATA, () => {
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
        });

        // Log periódico de status de vinho (max 1x por ciclo de fetchAllCities)
        this._lastWineLog = new Map(); // cityId → { hours, ts }

        // STATE_ALL_FRESH removido — orquestrado pelo Planner

        // Scope D — simulação imediata de impacto econômico para realocação em TownHall.
        // Permite que chamadores emitam HR_WORKER_REALLOC com "allocationAfter" para
        // obter/logar o impacto antes da confirmação final.
        this._events.on(E.HR_WORKER_REALLOC, (payload = {}) => {
            const cityId = Number(payload.cityId ?? 0);
            if (!cityId || !payload.allocationAfter) return;
            this.simulateTownHallImmediateImpact({
                cityId,
                allocationAfter: payload.allocationAfter,
                action: payload.action,
                emitDecisionRecord: payload.emitDecisionRecord !== false,
            });
        });
    }

    replan(ctx = null) {
        const cities = this._state.getAllCities();

        // Relatório de ciclo — snapshot consolidado de vinho em todas as cidades
        const lines = cities.map(c => {
            const wine = c.resources?.wine ?? 0;
            let spendings = c.production?.wineSpendings ?? 0;
            if (spendings <= 0 && c.tavern?.wineLevel > 0) {
                spendings = WINE_USE[c.tavern.wineLevel] ?? 0;
            }
            const hours = spendings > 0 ? (wine / spendings).toFixed(1) : '∞';
            const sat   = c.economy?.satisfaction ?? null;
            const flag  = (spendings > 0 && wine / spendings < this._config.get('wineEmergencyHours'))
                ? ' ⚠' : (sat !== null && sat <= 0 ? ' ⚠sat' : '');
            return `${c.name}=${hours}h sat=${sat ?? '?'} nv${c.tavern?.wineLevel ?? 0}${flag}`;
        });
        this._audit.info('HR', `Ciclo vinho: ${lines.join(' | ')}`);

        for (const city of cities) {
            this._checkWineRisk(city, true, ctx); // ignorar cooldown no replan explícito
            this._checkWineLevel(city);
        }
    }

    // ── Risco de esgotamento ──────────────────────────────────────────────────

    _checkWineRisk(city, ignoreCooldown = false, ctx = null) {
        const wine = city.resources.wine ?? 0;
        // Quando o estoque zera, o servidor para de reportar wineSpendings (retorna 0).
        // Usar WINE_USE[tavernWineLevel] como fallback — taberna continua configurada.
        let spendings = city.production.wineSpendings ?? 0;
        if (spendings <= 0 && city.tavern.wineLevel > 0) {
            spendings = WINE_USE[city.tavern.wineLevel] ?? 0;
        }
        if (spendings <= 0) return; // cidade não usa vinho

        const hoursLeft = wine / spendings;
        const threshold = this._config.get('wineEmergencyHours');

        // Log apenas quando estado muda significativamente (evitar flood por DC_HEADER_DATA)
        this._logWineIfChanged(city, wine, spendings, hoursLeft, threshold);

        if (hoursLeft < threshold) {
            // Cooldown: não re-emitir WINE_EMERGENCY antes de 10 minutos (exceto replan)
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

            this._events.emit(this._events.E.HR_WINE_EMERGENCY, {
                cityId: city.id,
                hoursLeft,
            });
            this._audit.warn('HR',
                `EMERGÊNCIA DE VINHO em ${city.name}: ${hoursLeft.toFixed(1)}h restantes`,
                { cityId: city.id }
            );

            // Ajustar taberna para nível mínimo (evitar consumo desnecessário)
            if (!this._queue.hasPendingType(TASK_TYPE.WINE_ADJUST, city.id)) {
                const minLevel = getMinWineLevel(spendings);
                if (minLevel >= 0 && minLevel !== city.tavern.wineLevel) {
                    this._queue.add({
                        type:     TASK_TYPE.WINE_ADJUST,
                        priority: 0,
                        cityId:   city.id,
                        payload: {
                            wineLevel:     minLevel,
                            wineEmergency: true,
                        },
                        scheduledFor: Date.now(),
                        reason:       `HR Emergência: ajustar taberna → nível ${minLevel} (${hoursLeft.toFixed(1)}h restantes)`,
                        module:       'HR',
                        confidence:   'HIGH',
                        maxAttempts:  5,
                    });
                }
            }

            // Notificar contexto do Planner que emergência foi tratada
            if (ctx) {
                const cityCtx = ctx.cities.get(city.id);
                if (cityCtx) cityCtx.wineEmergencyHandled = true;
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

    _checkWineLevel(city) {
        const current      = city.tavern?.wineLevel ?? 0;
        const satisfaction = city.economy?.satisfaction ?? null;

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
        const spendings = city.production?.wineSpendings ?? WINE_USE[current] ?? 0;
        const hoursLeft = spendings > 0 ? wine / spendings : Infinity;
        if (hoursLeft < 2) {
            this._audit.debug('HR',
                `WINE_ADJUST bloqueado em ${city.name}: estoque ${hoursLeft.toFixed(1)}h < 2h`
            );
            return;
        }

        const floor = this._wineLevelFloor.get(city.id) ?? 0;

        let targetLevel = current;

        if (satisfaction > 1 && current > 0 && current > floor) {
            // Acima do necessário e acima do floor confirmado → tentar baixar 1 nível
            targetLevel = current - 1;
        } else if (satisfaction < 1 && current < maxServable) {
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
        const population = Number(city.economy?.population ?? 0);

        const beforeWoodWorkers = Number(city.workers?.wood ?? 0);
        const beforeLuxuryWorkers = Number(city.workers?.tradegood ?? 0);
        const beforePriests = Number(city.workers?.priests ?? 0);
        const beforeScientists = Number(city.workers?.scientists ?? 0);
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
