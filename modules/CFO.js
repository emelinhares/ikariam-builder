// CFO.js — Chief Financial Officer
// Avalia qual edifício construir em cada cidade com base em score dinâmico e ROI.
// Emite tasks BUILD para o TaskQueue. Não faz requests.
//
// BUG HISTORY:
//   v1: usava slot.buildingId (inexistente) → nunca avaliava nenhum slot.
//       Corrigido para slot.building (campo real do StateManager).

import { getCost }                           from '../data/buildings.js';
import { getWarehouseSafe, getCorruption }   from '../data/effects.js';
import { PORT_LOADING_SPEED, BuildingsId }   from '../data/const.js';

// Edifícios que aumentam produção de recursos (tratamento especial de ROI)
const PRODUCTION_BUILDINGS = new Set([
    'forester', 'stonemason', 'glassblowing', 'alchemist', 'winegrower',
]);

// Edifícios redutores de custo (ROI alto garantido — pay off em todo build futuro)
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
        // Avaliação completa após refresh de todas as cidades
        this._events.on(E.STATE_ALL_FRESH, () => this.replan());
        // Reavaliar após BUILD concluído (pode ter desbloqueado próximo)
        this._events.on(E.QUEUE_TASK_DONE, ({ task }) => {
            if (task.type === 'BUILD') {
                this._audit.info('CFO', `BUILD concluído em cidade ${task.cityId} — reavaliando slot`);
                this.evaluateCity(task.cityId);
            }
        });
    }

    /** Re-executa avaliação em todas as cidades. */
    replan() {
        const cities = this._state.getAllCities();
        this._audit.info('CFO', `=== REPLAN: avaliando ${cities.length} cidades ===`);
        for (const city of cities) {
            this.evaluateCity(city.id);
        }
    }

    evaluateCity(cityId) {
        const city     = this._state.getCity(cityId);
        const research = this._state.research;
        if (!city) return;

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

        // Verificar ROI mínimo
        if (best.roi < this._config.get('roiThreshold')) {
            this._audit.info('CFO',
                `${city.name}: SKIP — ROI insuficiente ${best.building} lv${best.toLevel}: ${best.roi.toFixed(2)} < ${this._config.get('roiThreshold')} (custo total: ${best.totalCost.toLocaleString()})`
            );
            return;
        }

        // Verificar recursos disponíveis para o melhor candidato
        if (!this.canAfford(cityId, best.cost)) {
            const inTransit  = this._state.getInTransit(cityId);
            const missing = Object.entries(best.cost)
                .filter(([res, needed]) => {
                    if (!needed || needed <= 0) return false;
                    if (res === 'gold' || res === 'wine') return false;
                    const onHand   = city.resources[res] ?? 0;
                    const arriving = inTransit[res] ?? 0;
                    return onHand + arriving < needed;
                })
                .map(([res, needed]) => {
                    const onHand   = city.resources[res] ?? 0;
                    const arriving = inTransit[res] ?? 0;
                    return `${res}: ${onHand + arriving}/${needed}${arriving > 0 ? ` (+${arriving} a caminho)` : ''}`;
                });
            this._audit.info('CFO',
                `${city.name}: SKIP — recursos insuficientes para ${best.building} lv${best.toLevel} | falta: ${missing.join(', ')}`
            );
            return;
        }

        this._audit.info('CFO',
            `✓ BUILD aprovado: ${best.building} lv${best.toLevel} em ${city.name} — score=${best.score} roi=${best.roi.toFixed(2)} custo={${_fmtCost(best.cost)}}`
        );

        this._events.emit(this._events.E.CFO_BUILD_APPROVED, {
            cityId, building: best.building, position: best.position,
            toLevel: best.toLevel, cost: best.cost, reason: best.reason,
        });

        this._queue.add({
            type:     'BUILD',
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
            },
            scheduledFor: Date.now(),
            reason:       `CFO: ${best.reason}`,
            module:       'CFO',
            confidence:   this._state.getConfidence(cityId),
        });
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

    // ── Score dinâmico ────────────────────────────────────────────────────────

    _buildingScore(building, currentLevel, city, research, totalCities) {
        const BASE = {
            // Redutores de custo — alto impacto composto em todos os builds futuros
            carpentering:  90,
            architect:     85,
            optician:      80,
            vineyard:      75,
            fireworker:    70,
            // Infraestrutura crítica
            academy:       65,
            port:          55,
            warehouse:     50,
            tavern:        45,
            townHall:      40,
            // Produção de recursos
            forester:      35,
            stonemason:    32,
            glassblowing:  32,
            alchemist:     32,
            winegrower:    32,
            // Administrativo/Diplomático
            embassy:       25,
            branchOffice:  22,
            museum:        18,
            palaceColony:  15,
            palace:        15,
            workshop:      12,
            safehouse:     10,
            // Militar — baixa prioridade (ERP não é foco militar)
            barracks:       8,
            shipyard:       8,
            wall:           5,
        };

        let score = BASE[building] ?? 20;

        // Corrupção: palaceColony tem prioridade absoluta
        const corruption = city.economy?.corruption ?? 0;
        if (corruption > 0.01) {
            if (building === 'palaceColony') {
                score = 100;
                return score; // retorno imediato — máxima prioridade
            }
            score = Math.max(0, score - 25);
        }

        // Redutor: diminui valor em níveis altos (lei de retornos decrescentes)
        // Acima do nível 20, utilidade por nível decresce
        if (currentLevel >= 20) score = Math.round(score * 0.85);
        if (currentLevel >= 30) score = Math.round(score * 0.75);
        if (currentLevel >= 40) score = Math.round(score * 0.65);

        // Porto lento — aumenta urgência de upgrade
        if (building === 'port') {
            const portSlot = city.buildings?.find(b => b.building === 'port');
            if (portSlot) {
                const speed = PORT_LOADING_SPEED[portSlot.level] ?? 10;
                if (speed < 500)  score = Math.min(88, score + 35); // muito lento
                else if (speed < 2000) score = Math.min(75, score + 20);
            }
        }

        // Academia com redutores de pesquisa pendentes — priorizar
        if (building === 'academy') {
            const investigated = research?.investigated ?? new Set();
            // IDs: Pulley=2020, Conservation=2060, Geometry=1120, Architecture=2010, Paper=3010, Ink=3020, Mechanical Pen=3030
            const reducerIds = [2020, 2060, 1120, 2010, 3010, 3020, 3030];
            const pendingReducers = reducerIds.filter(id => !investigated.has(id)).length;
            if (pendingReducers > 0) {
                score = Math.min(95, score + pendingReducers * 5);
            }
        }

        // Warehouse: essencial se próximo de overflow
        if (building === 'warehouse') {
            const maxRes = city.maxResources ?? 0;
            if (maxRes > 0) {
                const maxPct = Math.max(...Object.values(city.resources ?? {}).map(v => v / maxRes));
                if (maxPct > 0.90) score = Math.min(85, score + 30); // overflow iminente
                else if (maxPct > 0.75) score = Math.min(70, score + 15);
            }
        }

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
            const roi = savingsPerLevel / Math.max(totalCost, 1) * 10;
            return Math.min(roi, 10); // cap em 10
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
            // ROI alto = payback rápido
            if (paybackHours < 48)   return 8;
            if (paybackHours < 168)  return 5;  // < 1 semana
            if (paybackHours < 720)  return 3;  // < 1 mês
            if (paybackHours < 2160) return 2;  // < 3 meses
            return 1;
        }

        // ── Town Hall ────────────────────────────────────────────────────────
        // Mais cidadãos = mais gold/h. Estimativa: +50 cidadãos por nível × 3 gold/h.
        if (building === 'townHall') {
            const extraGoldPerHour = 50 * 3; // ~150 gold/h por nível
            const paybackHours     = totalCost / Math.max(extraGoldPerHour, 1);
            if (paybackHours < 24)   return 9;
            if (paybackHours < 168)  return 6;
            if (paybackHours < 720)  return 4;
            if (paybackHours < 2160) return 2.5;
            return 1.5;
        }

        // ── Warehouse ────────────────────────────────────────────────────────
        // Previne perda de recursos por overflow. Valor = recursos salvos × preço.
        // Heurística: sempre vale em níveis baixos (evita overflow), menos em níveis altos.
        if (building === 'warehouse') {
            if (toLevel <= 10) return 6;
            if (toLevel <= 20) return 4;
            if (toLevel <= 30) return 3;
            return 2;
        }

        // ── Academia ─────────────────────────────────────────────────────────
        // Mais cientistas = pesquisa mais rápida. Pesquisa rápida = steam giants mais cedo.
        if (building === 'academy') {
            if (toLevel <= 10) return 7;
            if (toLevel <= 20) return 5;
            if (toLevel <= 30) return 3;
            return 2;
        }

        // ── Porto ────────────────────────────────────────────────────────────
        // Carga mais rápida = menos tempo parado. Crítico para JIT logistics.
        if (building === 'port') {
            const speedBefore = PORT_LOADING_SPEED[currentLevel] ?? 10;
            const speedAfter  = PORT_LOADING_SPEED[toLevel]      ?? 10;
            const gain        = speedAfter - speedBefore;
            if (gain <= 0) return 0;
            // ROI proporcional ao ganho de velocidade
            const roi = (gain / Math.max(totalCost, 1)) * 500_000;
            return Math.min(roi, 8);
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
}

// ── Helper local ──────────────────────────────────────────────────────────────

function _fmtCost(cost) {
    if (!cost) return '?';
    return Object.entries(cost)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}:${Number(v).toLocaleString('pt-BR')}`)
        .join(' ');
}
