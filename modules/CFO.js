// CFO.js — Chief Financial Officer
// Avalia qual edifício construir em cada cidade com base em score dinâmico e ROI.
// Emite tasks BUILD para o TaskQueue. Não faz requests.

import { getCost }                                                      from '../data/buildings.js';
import { getWarehouseSafe, getCorruption,
         WAREHOUSE_CAPACITY, TOWN_HALL_MAX_CITIZENS,
         ACADEMY_MAX_SCIENTISTS }                                        from '../data/effects.js';
import { PORT_LOADING_SPEED, BuildingsId }                              from '../data/const.js';
import { TASK_TYPE }                                                    from './taskTypes.js';

// Edifícios com impacto direto em produção (tratamento específico de ROI)
const PRODUCTION_BUILDINGS = new Set([
    'forester', 'stonemason', 'glassblowing', 'alchemist', 'winegrower',
]);

// Edifícios redutores de custo (payoff composto em builds futuros)
const REDUCER_BUILDINGS = new Set([
    'carpentering', 'architect', 'optician', 'vineyard', 'fireworker',
]);

export class CFO {
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
        // Reavaliar após BUILD concluído (pode ter desbloqueado próximo)
        this._events.on(E.QUEUE_TASK_DONE, ({ task }) => {
            if (task.type === TASK_TYPE.BUILD) {
                this._audit.info('CFO', `BUILD concluído em cidade ${task.cityId} — reavaliando slot`);
                this.evaluateCity(task.cityId);
            }
        });
    }

    /** Re-executa avaliação em todas as cidades. */
    replan(ctx = null) {
        const cities = this._state.getAllCities();
        this._audit.info('CFO', `=== REPLAN: avaliando ${cities.length} cidades ===`);
        for (const city of cities) {
            this.evaluateCity(city.id, ctx);
        }
    }

    evaluateCity(cityId, ctx = null) {
        const city     = this._state.getCity(cityId);
        const research = this._state.research;
        if (!city) return;

        // Verificar buildBlocked do Planner — emergência de sustento tem prioridade absoluta
        if (ctx) {
            const cityCtx = ctx.cities.get(cityId);
            if (cityCtx?.buildBlocked) {
                const reasonDetails = {
                    code: 'BLOCKED_BY_PLANNER_SUPPLY_EMERGENCY',
                    wineHours: cityCtx.wineHours,
                    satisfaction: cityCtx.satisfaction,
                };
                this._audit.info('CFO',
                    `${city.name}: SKIP — buildBlocked (code=${reasonDetails.code} wineHours=${cityCtx.wineHours?.toFixed(1)}h sat=${cityCtx.satisfaction})`
                );
                this._events.emit(this._events.E.CFO_BUILD_BLOCKED, {
                    cityId,
                    building: null,
                    reason:   'Planner: emergência de sustento ativa',
                    reasonCode: reasonDetails.code,
                    reasonDetails,
                });
                return;
            }
        }

        const conf = this._state.getConfidence(cityId);

        // Não avaliar com dados de baixa confiança
        if (conf === 'LOW') {
            this._audit.debug('CFO', `${city.name}: SKIP — confiança ${conf} (dados > 5min)`);
            return;
        }

        // Não adicionar se já há BUILD pendente para esta cidade
        if (this._queue.hasPendingBuild(cityId)) {
            this._audit.debug('CFO', `${city.name}: SKIP — BUILD já na fila`);
            return;
        }

        // Não avaliar se underConstruction — mas agendar re-avaliação para quando terminar
        const uc = this._state.getUnderConstruction(cityId);
        if (uc !== -1 && uc !== false && uc !== null) {
            const ucSlot     = city.buildings?.[uc];
            const ucBuilding = ucSlot?.building ?? '?';
            const completesAt = ucSlot?.completed
                ? ucSlot.completed * 1000           // seconds → ms
                : (ucSlot?.completesAt ?? null);

            if (completesAt && completesAt > Date.now()) {
                const delayMs = (completesAt - Date.now()) + 30_000;
                const mins    = Math.round(delayMs / 60_000);
                this._audit.debug('CFO',
                    `${city.name}: construindo ${ucBuilding} — reavaliando em ${mins}min (completesAt=${new Date(completesAt).toLocaleTimeString()})`
                );
                // Evitar timers duplicados: flag por cidade
                if (!this._pendingTimers) this._pendingTimers = new Set();
                if (!this._pendingTimers.has(cityId)) {
                    this._pendingTimers.add(cityId);
                    setTimeout(() => {
                        this._pendingTimers.delete(cityId);
                        this._audit.debug('CFO', `${city.name}: timer disparado — avaliando após conclusão de ${ucBuilding}`);
                        this.evaluateCity(cityId);
                    }, delayMs);
                }
            } else {
                this._audit.debug('CFO', `${city.name}: SKIP — construindo ${ucBuilding} (slot ${uc}, sem completesAt)`);
            }
            return;
        }

        // Verificar gold/h — se muito negativo, não construir
        if (!this.canAfford(cityId, null)) {
            this._audit.info('CFO', `${city.name}: SKIP — gold/h negativo (${city.economy.goldPerHour?.toFixed(0)}/h)`);
            return;
        }

        const candidates = this._getBuildCandidates(city, research);

        if (!candidates.length) {
            this._audit.info('CFO', `${city.name}: sem candidatos (${city.buildings?.length ?? 0} slots, todos sem tabela de custo ou bloqueados)`);
            return;
        }

        // Log de todos os candidatos para diagnóstico
        const topN = candidates.slice(0, 5);
        this._audit.debug('CFO',
            `${city.name}: top candidatos → ${topN.map(c => `${c.building}lv${c.toLevel}(sc=${c.score},roi=${c.roi.toFixed(1)})`).join(' | ')}`
        );

        const best = candidates[0];

        // Anti-duplicidade por assinatura (building+position+toLevel) além do hasPendingBuild.
        // Protege contra cenários de corrida onde a queue não está sincronizada entre ciclos.
        if (this._hasDuplicatePendingBuild(cityId, best)) {
            const reasonDetails = {
                code: 'DUPLICATE_BUILD_SIGNATURE',
                signature: this._buildSignature(best),
                building: best.building,
                position: best.position,
                toLevel: best.toLevel,
            };
            this._audit.info('CFO',
                `${city.name}: SKIP — assinatura duplicada de BUILD (code=${reasonDetails.code} sig=${reasonDetails.signature})`
            );
            this._events.emit(this._events.E.CFO_BUILD_BLOCKED, {
                cityId,
                building: best.building,
                reason: 'BUILD com mesma assinatura já está pendente',
                reasonCode: reasonDetails.code,
                reasonDetails,
            });
            return;
        }

        // Verificar ROI mínimo
        if (best.roi < this._config.get('roiThreshold')) {
            const reasonDetails = {
                code: 'ROI_BELOW_THRESHOLD',
                roi: Number(best.roi.toFixed(2)),
                roiThreshold: this._config.get('roiThreshold'),
                building: best.building,
                toLevel: best.toLevel,
                totalCost: best.totalCost,
            };
            this._audit.info('CFO',
                `${city.name}: SKIP — ROI insuficiente (code=${reasonDetails.code}) ` +
                `${best.building} lv${best.toLevel}: ${best.roi.toFixed(2)} < ${this._config.get('roiThreshold')} ` +
                `(custo total: ${best.totalCost.toLocaleString()})`
            );
            this._events.emit(this._events.E.CFO_BUILD_BLOCKED, {
                cityId,
                building: best.building,
                reason: `ROI insuficiente: ${best.roi.toFixed(2)} < ${this._config.get('roiThreshold')}`,
                reasonCode: reasonDetails.code,
                reasonDetails,
            });
            return;
        }

        // Verificação de Caixa Único (Scope D):
        //  A) se local cobre, fluxo normal
        //  B) se local falha, avaliar tesouraria global (descontando safety stock)
        //  C) se global cobre, enfileirar BUILD como WAITING_RESOURCES e deixar COO orquestrar JIT
        const localAfford = this.canAfford(cityId, best.cost);
        if (!localAfford) {
            const treasury = this._evaluateUnifiedTreasury(cityId, best.cost);

            if (!treasury.globalPass) {
                const reasonDetails = {
                    code: 'INSUFFICIENT_RESOURCES_GLOBAL_TREASURY',
                    building: best.building,
                    toLevel: best.toLevel,
                    localDeficit: treasury.localDeficit,
                    globalCover: treasury.globalCover,
                    safetyStockDeductions: treasury.safetyStockDeductions,
                    chosenAction: 'BLOCK_BUILD',
                };
                const evidence = [
                    `city=${city.name}`,
                    `building=${best.building}@${best.position}->${best.toLevel}`,
                    ...treasury.evidence,
                    'action=BLOCK_BUILD',
                ];
                this._audit.info('CFO',
                    `${city.name}: SKIP — caixa único insuficiente (code=${reasonDetails.code}) ` +
                    `para ${best.building} lv${best.toLevel}`
                );
                this._events.emit(this._events.E.CFO_BUILD_BLOCKED, {
                    cityId,
                    building: best.building,
                    reason: `Recursos insuficientes para ${best.building} lv${best.toLevel}`,
                    reasonCode: reasonDetails.code,
                    reasonDetails,
                    evidence,
                });
                return;
            }

            const reasonDetails = {
                code: 'BUILD_WAITING_RESOURCES_GLOBAL_TREASURY',
                building: best.building,
                position: best.position,
                toLevel: best.toLevel,
                localDeficit: treasury.localDeficit,
                globalCover: treasury.globalCover,
                safetyStockDeductions: treasury.safetyStockDeductions,
                chosenAction: 'WAITING_RESOURCES_AND_REQUEST_JIT',
            };
            const evidence = [
                `city=${city.name}`,
                `building=${best.building}@${best.position}->${best.toLevel}`,
                ...treasury.evidence,
                'action=WAITING_RESOURCES_AND_REQUEST_JIT',
            ];

            this._events.emit(this._events.E.CFO_BUILD_APPROVED, {
                cityId, building: best.building, position: best.position,
                toLevel: best.toLevel, cost: best.cost, reason: best.reason,
                reasonCode: reasonDetails.code,
                reasonDetails,
                evidence,
            });

            this._queue.add({
                type:     TASK_TYPE.BUILD,
                priority: Math.max(0, 100 - best.score),
                cityId,
                status:   'waiting_resources',
                payload: {
                    building:         best.building,
                    position:         best.position,
                    buildingView:     best.building,
                    templateView:     best.building,
                    cost:             best.cost,
                    toLevel:          best.toLevel,
                    currentLevel:     best.toLevel - 1,
                    waitingResources: true,
                    roi:              Number(best.roi.toFixed(2)),
                    score:            best.score,
                    treasury: {
                        localDeficit:          treasury.localDeficit,
                        globalCover:           treasury.globalCover,
                        safetyStockDeductions: treasury.safetyStockDeductions,
                    },
                },
                scheduledFor: Date.now(),
                reason:       `CFO: Caixa Único aprovado (aguardando recursos) — ${best.reason}`,
                reasonCode:   reasonDetails.code,
                evidence,
                module:       'CFO',
                confidence:   this._state.getConfidence(cityId),
            });

            this._audit.info('CFO',
                `↺ BUILD aguardando recursos (code=${reasonDetails.code}): ${best.building} lv${best.toLevel} em ${city.name}`
            );
            return;
        }

        const approvalDetails = {
            code: 'BUILD_APPROVED',
            score: best.score,
            roi: Number(best.roi.toFixed(2)),
            roiThreshold: this._config.get('roiThreshold'),
            signature: this._buildSignature(best),
            building: best.building,
            position: best.position,
            toLevel: best.toLevel,
            cost: best.cost,
        };
        this._audit.info('CFO',
            `✓ BUILD aprovado (code=${approvalDetails.code} sig=${approvalDetails.signature}): ` +
            `${best.building} lv${best.toLevel} em ${city.name} — ` +
            `score=${best.score} roi=${best.roi.toFixed(2)} custo={${_fmtCost(best.cost)}}`
        );

        this._events.emit(this._events.E.CFO_BUILD_APPROVED, {
            cityId, building: best.building, position: best.position,
            toLevel: best.toLevel, cost: best.cost, reason: best.reason,
            reasonCode: approvalDetails.code,
            reasonDetails: approvalDetails,
        });

        // Registrar no contexto do Planner que esta cidade recebeu build aprovado
        if (ctx) {
            const cityCtx = ctx.cities.get(cityId);
            if (cityCtx) cityCtx.buildApprovedBy = 'CFO';
        }

        this._queue.add({
            type:     TASK_TYPE.BUILD,
            priority: Math.max(0, 100 - best.score),
            cityId,
            payload: {
                building:     best.building,
                position:     best.position,
                buildingView: best.building,
                templateView: best.building,
                cost:         best.cost,
                toLevel:      best.toLevel,
                currentLevel: best.toLevel - 1,  // nível ATUAL — confirmado via REC: server valida isso
                roi:          Number(best.roi.toFixed(2)),
                score:        best.score,
            },
            scheduledFor: Date.now(),
            reason:       `CFO: ${best.reason}`,
            module:       'CFO',
            confidence:   this._state.getConfidence(cityId),
        });
    }

    _evaluateUnifiedTreasury(destCityId, cost) {
        const resources = Object.entries(cost ?? {})
            .filter(([res, needed]) => needed > 0 && res !== 'gold' && res !== 'wine');
        const cities = this._state.getAllCities();
        const destCity = this._state.getCity(destCityId);
        const inTransitDest = this._state.getInTransit(destCityId);
        const minStockFraction = this._config.get('minStockFraction') ?? 0.20;
        const commitments = this._buildCommitmentLedger();

        const localDeficit = {};
        const globalCover = {};
        const safetyStockDeductions = {};
        const evidence = [];
        let globalPass = true;

        for (const [res, needed] of resources) {
            const onHandDest = destCity?.resources?.[res] ?? 0;
            const arrivingDest = inTransitDest?.[res] ?? 0;
            const effectiveDest = onHandDest + arrivingDest;
            const deficit = Math.max(0, needed - effectiveDest);
            localDeficit[res] = deficit;

            if (deficit <= 0) {
                globalCover[res] = 0;
                safetyStockDeductions[res] = [];
                evidence.push(`${res}: local=${effectiveDest}/${needed} deficit=0`);
                continue;
            }

            const deductions = [];
            let transferableTotal = 0;

            for (const city of cities) {
                if (!city || city.id === destCityId) continue;
                const raw = Number(city.resources?.[res] ?? 0);
                const committedOut = Number(commitments.get(city.id)?.[res] ?? 0);
                const netRaw = Math.max(0, raw - committedOut);
                const maxResRaw = city.maxResources;
                const maxRes = typeof maxResRaw === 'number'
                    ? maxResRaw
                    : Number(maxResRaw?.[res] ?? 0);
                const safetyStock = Math.floor(Math.max(0, maxRes) * minStockFraction);
                const transferable = Math.max(0, netRaw - safetyStock);

                deductions.push({
                    cityId: city.id,
                    cityName: city.name,
                    resource: res,
                    onHand: raw,
                    committedOut,
                    netAvailable: netRaw,
                    safetyStock,
                    transferable,
                });
                transferableTotal += transferable;
            }

            globalCover[res] = transferableTotal;
            safetyStockDeductions[res] = deductions;
            if (transferableTotal < deficit) globalPass = false;

            evidence.push(
                `${res}: localDeficit=${deficit} globalCover=${transferableTotal} ` +
                `netCommitted=${deductions.map(d => `${d.cityName}:${d.committedOut}`).join('|')} ` +
                `safetyDeduction=${deductions.map(d => `${d.cityName}:${d.safetyStock}`).join('|')}`
            );
        }

        return {
            globalPass,
            localDeficit,
            globalCover,
            safetyStockDeductions,
            evidence,
        };
    }

    _buildCommitmentLedger() {
        const ledger = new Map();
        const init = (cityId) => {
            if (!ledger.has(cityId)) {
                ledger.set(cityId, {
                    wood: 0,
                    wine: 0,
                    marble: 0,
                    glass: 0,
                    sulfur: 0,
                });
            }
            return ledger.get(cityId);
        };

        for (const task of this._queue?.getPending?.() ?? []) {
            if (task.type !== TASK_TYPE.TRANSPORT) continue;
            const fromCityId = task.payload?.fromCityId;
            const cargo = task.payload?.cargo;
            if (!fromCityId || !cargo) continue;
            const entry = init(fromCityId);
            for (const [res, qty] of Object.entries(cargo)) {
                if (res in entry) entry[res] += Number(qty) || 0;
            }
        }

        for (const mv of this._state.fleetMovements ?? []) {
            if (!mv?.isOwn || mv?.isReturn) continue;
            const fromCityId = mv.originCityId ?? mv.sourceCityId;
            const cargo = mv.cargo;
            if (!fromCityId || !cargo) continue;
            const entry = init(fromCityId);
            for (const [res, qty] of Object.entries(cargo)) {
                if (res in entry) entry[res] += Number(qty) || 0;
            }
        }

        return ledger;
    }

    // ── Verificação de custeio ────────────────────────────────────────────────

    canAfford(cityId, cost) {
        const city = this._state.getCity(cityId);
        if (!city) return false;

        // 1. Gold/h — bloquear se muito negativo (exército caro ou corrupção alta)
        const goldPerHour = city.economy.goldPerHour ?? 0;
        const hours = this._config.get('goldProjectionHours');
        if (goldPerHour * hours < -(hours * 200)) return false; // tolerar até -200 gold/h

        // 2. Recursos físicos — verificar estoque atual + em trânsito vs custo do build
        // Se não foi passado custo, apenas o check de gold é suficiente
        if (!cost || typeof cost !== 'object') return true;

        const inTransit = this._state.getInTransit(cityId);
        for (const [res, needed] of Object.entries(cost)) {
            if (!needed || needed <= 0) continue;
            if (res === 'gold' || res === 'wine') continue; // gold: sem estoque real; wine: gerenciado pelo HR
            const onHand   = city.resources[res] ?? 0;
            const arriving = inTransit[res] ?? 0;
            if (onHand + arriving < needed) return false;
        }

        return true;
    }

    // ── Candidatos de build ───────────────────────────────────────────────────

    _getBuildCandidates(city, research) {
        const candidates  = [];
        const totalCities = this._state.getAllCities().length;

        if (!Array.isArray(city.buildings) || city.buildings.length === 0) {
            this._audit.debug('CFO', `${city.name}: sem slots de edifício no estado`);
            return candidates;
        }

        for (const slot of city.buildings) {
            // CAMPO CORRETO: slot.building (string), não slot.buildingId (inexistente)
            const building = slot?.building;
            if (!building) continue;                        // slot vazio ou sem nome
            if (city.lockedPositions?.has(slot.position)) continue; // bloqueado por pesquisa

            const toLevel = (slot.level ?? 0) + 1;
            const cost    = getCost(building, toLevel);
            if (!cost) {
                // Nível não tabelado — pode ser acima do cap ou edifício sem tabela
                this._audit.debug('CFO', `${city.name}: ${building} lv${toLevel} — sem tabela de custo`);
                continue;
            }

            const score = this._buildingScore(building, slot.level ?? 0, city, research, totalCities);
            if (score <= 0) continue;

            const roi       = this._calcROI(building, toLevel, slot.level ?? 0, city);
            const totalCost = Object.values(cost).reduce((s, v) => s + (v ?? 0), 0);

            candidates.push({
                building,
                position:  slot.position,
                toLevel,
                cost,
                totalCost,
                score,
                roi,
                reason: `score=${score} roi=${roi.toFixed(1)}: ${building} lv${slot.level ?? 0}→${toLevel}`,
            });
        }

        // Ordenar por score desc, ROI desc como desempate
        return candidates.sort((a, b) => b.score - a.score || b.roi - a.roi);
    }

    // ── Score baseado em necessidade (urgência × impacto × saturação) ──────────
    //
    // Cada edifício compete pelo problema real que resolve agora.
    // score = urgency(0–1) × impact(0–1) × (1 - saturation(0–1)) × 100
    // Edifícios sem cálculo específico usam BASE fixo com decaimento por nível.

    _buildingScore(building, currentLevel, city, research, totalCities) {
        // Corrupção: prioridade absoluta
        if (building === 'palaceColony') {
            const corruption = city.economy?.corruption ?? 0;
            return corruption > 0.01 ? 100 : 10;
        }
        if ((city.economy?.corruption ?? 0) > 0.01) {
            // Qualquer outra coisa numa cidade corrompida tem score zero — palaceColony primeiro
            return 0;
        }

        const nextLevel = currentLevel + 1;

        // ── Warehouse ────────────────────────────────────────────────────────
        if (building === 'warehouse') {
            const maxRes  = city.maxResources ?? 0;
            if (!maxRes) return 20;
            const fillPct = Math.max(...Object.values(city.resources ?? {}).map(v => v / maxRes));
            // urgency: 0 se vazio, 1 se cheio
            const urgency    = Math.min(1, Math.max(0, (fillPct - 0.50) / 0.50));
            // impact: ganho relativo de capacidade
            const capNow     = WAREHOUSE_CAPACITY[currentLevel] ?? maxRes;
            const capNext    = WAREHOUSE_CAPACITY[nextLevel]    ?? capNow;
            const impact     = Math.min(1, (capNext - capNow) / Math.max(capNow, 1));
            // saturation: capacidade já muito grande vs produção (nível alto = menos urgente)
            const saturation = Math.min(1, currentLevel / 30);
            return Math.round(urgency * impact * (1 - saturation) * 100) + 10;
        }

        // ── TownHall ─────────────────────────────────────────────────────────
        if (building === 'townHall') {
            const pop     = city.economy?.population    ?? 0;
            const maxPop  = city.economy?.maxInhabitants ?? 0;
            if (!maxPop) return 20;
            const popPct  = pop / maxPop;
            // urgency: cidade crescendo e chegando no limite
            const growing = (city.economy?.growthPerHour ?? 0) > 0;
            const urgency = Math.min(1, Math.max(0, (popPct - 0.60) / 0.40)) * (growing ? 1.3 : 0.7);
            // impact: quantos habitantes a mais
            const maxNow  = TOWN_HALL_MAX_CITIZENS[currentLevel] ?? maxPop;
            const maxNext = TOWN_HALL_MAX_CITIZENS[nextLevel]    ?? maxNow;
            const impact  = Math.min(1, (maxNext - maxNow) / Math.max(maxNow, 1));
            const saturation = Math.min(1, currentLevel / 40);
            return Math.round(Math.min(1, urgency) * impact * (1 - saturation) * 100) + 10;
        }

        // ── Port ─────────────────────────────────────────────────────────────
        if (building === 'port') {
            const speedNow  = PORT_LOADING_SPEED[currentLevel] ?? 10;
            const speedNext = PORT_LOADING_SPEED[nextLevel]    ?? speedNow;
            // impact: ganho percentual de velocidade (salto nv10→11 é enorme)
            const impact    = Math.min(1, (speedNext - speedNow) / Math.max(speedNow, 1));
            // urgency: transportes pendentes indicam gargalo logístico
            const pending   = this._queue?.getPending(city.id)
                ?.filter(t => t.type === TASK_TYPE.TRANSPORT).length ?? 0;
            const urgency   = Math.min(1, 0.3 + pending * 0.15);
            const saturation = speedNow > 5000 ? 0.6 : 0; // porto rápido = menos urgente
            return Math.round(urgency * impact * (1 - saturation) * 100) + 10;
        }

        // ── Academia ─────────────────────────────────────────────────────────
        if (building === 'academy') {
            const scientists    = city.workers?.scientists ?? 0;
            const capNow        = ACADEMY_MAX_SCIENTISTS[currentLevel] ?? 0;
            const capNext       = ACADEMY_MAX_SCIENTISTS[nextLevel]    ?? capNow;
            // urgency: cap atual já está sendo usado (cientistas no limite)
            const urgency       = capNow > 0 ? Math.min(1, scientists / capNow) : 0;
            // impact: quantos cientistas a mais o próximo nível permite
            const impact        = Math.min(1, (capNext - capNow) / Math.max(capNow, 1));
            // saturation: cientistas vs população (academia grande demais pra pop atual)
            const pop           = city.economy?.population ?? 0;
            const sciRatio      = pop > 0 ? scientists / pop : 0;
            const saturation    = Math.min(1, sciRatio / 0.30); // >30% da pop em ciência = saturado
            return Math.round(urgency * impact * (1 - saturation) * 100) + 5;
        }

        // ── Tavern ───────────────────────────────────────────────────────────
        if (building === 'tavern') {
            const sat = city.economy?.satisfaction ?? null;
            // Sem dado de satisfaction: score base baixo (não agir às cegas)
            if (sat === null) return 15;
            // urgency: quanto abaixo do target (1)
            const urgency    = sat < 1 ? Math.min(1, (1 - sat) / 3) : 0;
            const saturation = sat > 3 ? Math.min(1, (sat - 3) / 5) : 0;
            return Math.round(urgency * (1 - saturation) * 100) + 10;
        }

        // ── Redutores de custo (BASE fixo com decaimento) ─────────────────────
        // Payoff composto: cada nível poupa % em todos builds futuros
        const REDUCER_BASE = {
            carpentering: 72, architect: 68, optician: 64, vineyard: 60, fireworker: 56,
        };
        if (building in REDUCER_BASE) {
            let score = REDUCER_BASE[building];
            // Decaimento por nível (retornos decrescentes — cap de 50% já atingido)
            if (currentLevel >= 20) score = Math.round(score * 0.80);
            if (currentLevel >= 30) score = Math.round(score * 0.70);
            if (currentLevel >= 50) return 0; // cap de desconto atingido
            return score;
        }

        // ── Produção de recursos (BASE fixo) ──────────────────────────────────
        const PROD_BASE = {
            forester: 35, stonemason: 32, glassblowing: 32, alchemist: 32, winegrower: 32,
        };
        if (building in PROD_BASE) {
            let score = PROD_BASE[building];
            if (currentLevel >= 20) score = Math.round(score * 0.85);
            if (currentLevel >= 30) score = Math.round(score * 0.70);
            return score;
        }

        // ── Demais edifícios (BASE fixo baixo) ────────────────────────────────
        const MISC_BASE = {
            embassy: 25, branchOffice: 22, museum: 18,
            palace: 15, workshop: 12, safehouse: 10,
            barracks: 8, shipyard: 8, wall: 5,
        };
        let score = MISC_BASE[building] ?? 10;
        if (currentLevel >= 20) score = Math.round(score * 0.80);
        return score;
    }

    // ── ROI por tipo de edifício ──────────────────────────────────────────────
    // Retorna um índice de retorno sobre investimento.
    // Threshold padrão = 2.0 (Config: roiThreshold).
    // Lógica: quanto maior o ROI, mais urgente é o upgrade.

    _calcROI(building, toLevel, currentLevel, city) {
        const cost = getCost(building, toLevel);
        if (!cost) return 0;

        const totalCost = Object.values(cost).reduce((s, v) => s + (v ?? 0), 0);
        if (totalCost === 0) return 10;

        // ── Redutores de custo ───────────────────────────────────────────────
        // Cada nível = -1% em todos os builds futuros desta cidade.
        // ROI alto e garantido — cada build futuro paga um pouco do investimento.
        if (REDUCER_BUILDINGS.has(building)) {
            // Estimativa: ~30 builds futuros de 50K recursos médios
            // Economia por build = 50K * 0.01 = 500 recursos. 30 builds = 15K.
            // ROI = economia_total / custo_do_upgrade
            const avgFutureBuildCost = 50_000;
            const futureBuilds       = 30;
            const savingsPerLevel    = avgFutureBuildCost * 0.01 * futureBuilds;
            const estimatedSavingsPerHour = savingsPerLevel / (7 * 24); // distribui benefício em 1 semana
            const paybackHours = totalCost / Math.max(estimatedSavingsPerHour, 0.1);
            return this._paybackToRoi(paybackHours, { fastBonus: 0.5 });
        }

        // ── Produção de recursos ─────────────────────────────────────────────
        // Cada nível = +N unidades/hora de recurso. Payback em horas de produção.
        if (PRODUCTION_BUILDINGS.has(building)) {
            // Estimativa conservadora: +1.5 unidades/hora por nível
            // Valor em gold equivalente: ~3 gold/unidade de produção
            const extraUnitsPerHour = 1.5;
            const goldEquivPerUnit  = 3;
            const extraGoldPerHour  = extraUnitsPerHour * goldEquivPerUnit;
            const paybackHours      = totalCost / Math.max(extraGoldPerHour, 0.1);
            return this._paybackToRoi(paybackHours);
        }

        // ── Town Hall ────────────────────────────────────────────────────────
        // Mais cidadãos = mais gold/h. Estimativa: +50 cidadãos por nível × 3 gold/h.
        if (building === 'townHall') {
            const extraGoldPerHour = 50 * 3; // ~150 gold/h por nível
            const paybackHours     = totalCost / Math.max(extraGoldPerHour, 1);
            return this._paybackToRoi(paybackHours, { fastBonus: 1.0 });
        }

        // ── Warehouse ────────────────────────────────────────────────────────
        // Previne perda de recursos por overflow. Valor = recursos salvos × preço.
        // Heurística: sempre vale em níveis baixos (evita overflow), menos em níveis altos.
        if (building === 'warehouse') {
            const avgFill = _averageResourceFillRatio(city.resources, city.maxResources);
            const overflowRiskPerHour = Math.max(0, (avgFill - 0.85) * 5_000); // proxy de perda evitada
            if (overflowRiskPerHour <= 0) return toLevel <= 10 ? 4 : 2.5;
            const paybackHours = totalCost / overflowRiskPerHour;
            return this._paybackToRoi(paybackHours);
        }

        // ── Academia ─────────────────────────────────────────────────────────
        // Mais cientistas = pesquisa mais rápida. Pesquisa rápida = steam giants mais cedo.
        if (building === 'academy') {
            const capNow   = ACADEMY_MAX_SCIENTISTS[currentLevel] ?? 0;
            const capNext  = ACADEMY_MAX_SCIENTISTS[toLevel] ?? capNow;
            const deltaSci = Math.max(0, capNext - capNow);
            const pointsPerScientistHour = 20;
            const pointsGainPerHour = deltaSci * pointsPerScientistHour;
            if (pointsGainPerHour <= 0) return 1.5;
            const paybackHours = totalCost / pointsGainPerHour;
            return this._paybackToRoi(paybackHours, { slowFloor: 1.5 });
        }

        // ── Porto ────────────────────────────────────────────────────────────
        // Carga mais rápida = menos tempo parado. Crítico para JIT logistics.
        if (building === 'port') {
            const speedBefore = PORT_LOADING_SPEED[currentLevel] ?? 10;
            const speedAfter  = PORT_LOADING_SPEED[toLevel]      ?? 10;
            const gain        = speedAfter - speedBefore;
            if (gain <= 0) return 0;
            // ROI proporcional ao tempo de carga poupado por hora de operação.
            const timeSavedPerHour = gain / Math.max(speedAfter, 1); // proxy normalizado
            const payoffPerHour = Math.max(0.1, timeSavedPerHour * 2_000);
            const paybackHours = totalCost / payoffPerHour;
            return this._paybackToRoi(paybackHours, { fastBonus: 0.5 });
        }

        // ── Palace / Governor's Residence ────────────────────────────────────
        // Reduz corrupção = mais produção. Prioridade via score, não ROI.
        if (building === 'palaceColony' || building === 'palace') {
            return 5; // ROI fixo — score já gerenicia prioridade
        }

        // ── Tavern ───────────────────────────────────────────────────────────
        // Happiness → mais cidadãos → mais gold. Indiretamente importante.
        if (building === 'tavern') {
            if (toLevel <= 10) return 4;
            if (toLevel <= 20) return 3;
            return 2;
        }

        // ── Heurística genérica (demais edifícios) ────────────────────────────
        // Inversamente proporcional ao custo com piso de 1.0.
        const normalized = Math.min(1, totalCost / 300_000);
        return Math.max(1.0, (1 - normalized) * 5 + 1);
    }

    _paybackToRoi(paybackHours, options = {}) {
        const fastBonus = options.fastBonus ?? 0;
        const slowFloor = options.slowFloor ?? 1.0;

        if (!Number.isFinite(paybackHours) || paybackHours <= 0) return 10;
        if (paybackHours <= 24)   return 9 + fastBonus;
        if (paybackHours <= 72)   return 8 + fastBonus;
        if (paybackHours <= 168)  return 6 + fastBonus;
        if (paybackHours <= 336)  return 5;
        if (paybackHours <= 720)  return 4;
        if (paybackHours <= 2160) return 2.5;
        return slowFloor;
    }

    _buildSignature(candidate) {
        if (!candidate) return 'unknown';
        return `${candidate.building}@${candidate.position}->${candidate.toLevel}`;
    }

    _hasDuplicatePendingBuild(cityId, candidate) {
        const pending = this._queue.getPending?.(cityId) ?? [];
        const signature = this._buildSignature(candidate);
        return pending.some((task) => {
            if (task.type !== TASK_TYPE.BUILD) return false;
            const payload = task.payload ?? {};
            const taskSig = `${payload.building ?? payload.buildingView}@${payload.position}->${payload.toLevel}`;
            return taskSig === signature;
        });
    }
}

// ── Helper local ──────────────────────────────────────────────────────────────

function _fmtCost(cost) {
    if (!cost) return '?';
    return Object.entries(cost)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}:${Number(v).toLocaleString('pt-BR')}`)
        .join(' ');
}

function _averageResourceFillRatio(resources = {}, maxResources = {}) {
    const keys = ['wood', 'wine', 'marble', 'glass', 'sulfur'];
    const ratios = keys
        .map((k) => {
            const max = Number(maxResources[k] ?? 0);
            if (max <= 0) return null;
            const cur = Number(resources[k] ?? 0);
            return Math.max(0, Math.min(1, cur / max));
        })
        .filter(v => v !== null);
    if (!ratios.length) return 0;
    return ratios.reduce((s, v) => s + v, 0) / ratios.length;
}
