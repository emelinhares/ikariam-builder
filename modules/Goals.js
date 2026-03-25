// Goals.js — metas de construção multi-nível por cidade
//
// Estrutura de um goal:
// {
//   id, cityId, cityName, position,      // position = slot do edifício
//   buildingName, targetLevel, currentLevel,
//   active,    // incluído no ciclo automático
//   status,    // 'pending'|'queued'|'building'|'waiting_resources'|'waiting'|'done'|'error'
//   islandId,  // salvo do ResourceCache no momento de criação
//   createdAt  // Game.getServerTime()
// }
//
// Sourcing threshold: se hoursUntilResources > 4h → busca doador externo

import Game from './Game.js';
import ResourceCache from './ResourceCache.js';
import Port from './Port.js';
import Storage from './Storage.js';
import Events from './Events.js';

// ─── Constantes ───────────────────────────────────────────────────────────────
const SOURCING_THRESHOLD_H = 4;    // horas — aguarda local abaixo disso
const DONOR_RESERVE_PCT    = 0.30; // guarda 30% do armazém no doador

// ─── Chave de persistência ────────────────────────────────────────────────────
const SK = 'goals';

// ─── Estado interno ───────────────────────────────────────────────────────────
let _goals = []; // array flat de todos os goals (todas as cidades)
let _nextId = 1;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _newId() {
    return _nextId++;
}

function _goalsFor(cityId) {
    return _goals.filter(g => g.cityId === cityId && g.active);
}

function _setStatus(id, status) {
    const g = _goals.find(g => g.id === id);
    if (g) { g.status = status; _save(); }
}

async function _load() {
    const saved = (await Storage.get(SK)) ?? { goals: [], nextId: 1 };
    _goals  = saved.goals  ?? [];
    _nextId = saved.nextId ?? 1;
}

function _save() {
    Storage.set(SK, { goals: _goals, nextId: _nextId });
}

/**
 * Tenta encontrar uma cidade doadora com excedente de `resource`.
 * Exclui a cidade destino. Guarda 30% do armazém máximo.
 */
function _findDonor(resource, toCityId, needed) {
    const cities = Game.getCities().filter(c => c.id !== toCityId);
    for (const city of cities) {
        const proj = ResourceCache.projectResources(city.id);
        const cap  = ResourceCache.getCapacity(city.id);
        const keep = Math.ceil(cap * DONOR_RESERVE_PCT);
        const avail = (proj[resource] ?? 0) - keep;
        if (avail >= needed) return city;
    }
    // Aceita doador parcial se nenhum tem o suficiente
    let best = null, bestAvail = 0;
    for (const city of cities) {
        const proj  = ResourceCache.projectResources(city.id);
        const cap   = ResourceCache.getCapacity(city.id);
        const keep  = Math.ceil(cap * DONOR_RESERVE_PCT);
        const avail = (proj[resource] ?? 0) - keep;
        if (avail > bestAvail) { bestAvail = avail; best = city; }
    }
    return best;
}

// ─── Ação de construção ───────────────────────────────────────────────────────

async function _triggerBuild(cityId, position) {
    const pos = Game.getPosition(cityId, position);
    if (!pos) throw new Error(`[Goals] Slot ${position} não encontrado na cidade ${cityId}`);

    const view = (pos.name ?? '').split(' ')[0];
    const body = new URLSearchParams({
        action:          'UpgradeExistingBuilding',
        function:        'upgradeBuilding',
        view:            view,
        cityId:          String(cityId),
        position:        String(position),
        backgroundView:  'city',
        currentCityId:   String(cityId),
        templateView:    view,
        actionRequest:   Game.getToken(),
        ajax:            1,
    });

    const data = await Game.request('/index.php', body.toString());
    ResourceCache.updateFromResponse(data.find(d => d[0] === 'updateGlobalData')?.[1]);
}

// ─── API pública ──────────────────────────────────────────────────────────────

const Goals = {

    async init() {
        await _load();
    },

    // ── Gestão de goals ────────────────────────────────────────────────────

    getGoals(cityId) {
        return cityId ? _goalsFor(cityId) : [..._goals];
    },

    addGoal(cityId, buildingName, targetLevel) {
        const position = Game.findPosition(cityId, buildingName);
        const cached   = ResourceCache.get(cityId);
        const goal = {
            id:           _newId(),
            cityId,
            cityName:     Game.getCityName(cityId) ?? '',
            position,
            buildingName,
            targetLevel,
            currentLevel: Game.getBuildingLevel(cityId, buildingName),
            active:       true,
            status:       'pending',
            islandId:     cached?.islandId ?? Game.getCityIslandId(cityId) ?? null,
            createdAt:    Game.getServerTime(),
        };
        _goals.push(goal);
        _save();
        return goal;
    },

    removeGoal(id) {
        _goals = _goals.filter(g => g.id !== id);
        _save();
    },

    setActive(id, active) {
        const g = _goals.find(g => g.id === id);
        if (g) { g.active = active; _save(); }
    },

    moveUp(cityId, index) {
        const list = _goalsFor(cityId);
        if (index <= 0) return;
        const a = list[index - 1], b = list[index];
        const ia = _goals.indexOf(a), ib = _goals.indexOf(b);
        [_goals[ia], _goals[ib]] = [_goals[ib], _goals[ia]];
        _save();
    },

    moveDown(cityId, index) {
        const list = _goalsFor(cityId);
        if (index >= list.length - 1) return;
        const a = list[index], b = list[index + 1];
        const ia = _goals.indexOf(a), ib = _goals.indexOf(b);
        [_goals[ia], _goals[ib]] = [_goals[ib], _goals[ia]];
        _save();
    },

    /**
     * Retorna o próximo goal pendente de uma cidade.
     */
    getNextGoal(cityId) {
        const list = _goalsFor(cityId);
        for (const goal of list) {
            const current = Game.getBuildingLevel(cityId, goal.buildingName);
            if (current < goal.targetLevel) return goal;
            // Marca como done se já atingiu
            if (goal.status !== 'done') { goal.status = 'done'; _save(); }
        }
        return null;
    },

    allDone() {
        return Game.getCities().every(c => !this.getNextGoal(c.id));
    },

    // ── Execução ───────────────────────────────────────────────────────────

    /**
     * Tenta avançar o próximo goal de uma cidade.
     * Retorna: 'built' | 'building' | 'waiting_resources' | 'waiting' | 'waiting_queue' | 'done'
     */
    async runGoals(cityId) {
        const goal = this.getNextGoal(cityId);
        if (!goal) return 'done';

        // Já tem construção em andamento?
        if (Game.isBuilding(cityId)) {
            const finish = Game.getQueueFinishTime(cityId);
            _setStatus(goal.id, 'building');
            Events.emit('goals:tick', { cityId, status: 'waiting_queue', finish });
            return 'waiting_queue';
        }

        if (goal.position === null) {
            console.warn(`[Goals] Slot não encontrado para ${goal.buildingName} na cidade ${cityId}`);
            _setStatus(goal.id, 'error');
            return 'waiting_resources';
        }

        // Verifica se o slot está bloqueado por pesquisa
        if (Game.isPositionLocked(cityId, goal.position)) {
            console.warn(`[Goals] Slot ${goal.position} bloqueado por pesquisa em cidade ${cityId}`);
            _setStatus(goal.id, 'error');
            return 'waiting_resources';
        }

        // Obtém custos via Game.fetchCosts (parse HTML do servidor)
        const costs = await Game.fetchCosts(cityId, goal.position);
        if (!costs) {
            console.warn(`[Goals] fetchCosts falhou para ${goal.buildingName}.`);
            _setStatus(goal.id, 'waiting_resources');
            return 'waiting_resources';
        }

        // Verifica recursos locais
        ResourceCache.refresh(cityId);
        const hoursLocal = ResourceCache.hoursUntilResources(cityId, costs);

        if (hoursLocal === 0) {
            // Tem recursos — constrói agora
            try {
                await _triggerBuild(cityId, goal.position);
                _setStatus(goal.id, 'queued');
                ResourceCache.invalidate(cityId);
                Events.emit('build:queued', {
                    cityId, building: goal.buildingName,
                    level: Game.getBuildingLevel(cityId, goal.buildingName) + 1,
                });
                return 'built';
            } catch (err) {
                console.error('[Goals] Erro ao construir:', err);
                _setStatus(goal.id, 'error');
                return 'waiting_resources';
            }
        }

        // Recursos insuficientes — decidir entre aguardar local ou buscar doador
        if (hoursLocal <= SOURCING_THRESHOLD_H) {
            // Aguarda produção local
            _setStatus(goal.id, 'waiting');
            Events.emit('goals:tick', { cityId, status: 'waiting', hoursLocal, costs });
            return 'waiting';
        }

        // Busca doador em outra cidade para cada recurso em falta
        let sourced = false;
        for (const [resource, needed] of Object.entries(costs)) {
            const current = ResourceCache.getCurrent(cityId, resource);
            if (current >= needed) continue;

            const deficit = needed - current;
            const donor   = _findDonor(resource, cityId, deficit);
            if (!donor) continue;

            Port.enqueue([{
                type:        'goal',
                fromCityId:  donor.id,
                toCityId:    cityId,
                toIslandId:  goal.islandId,
                resource,
                amount:      Math.ceil(deficit),
            }]);
            sourced = true;
        }

        _setStatus(goal.id, sourced ? 'waiting_resources' : 'waiting');
        Events.emit('goals:tick', {
            cityId, status: 'waiting_resources', hoursLocal, costs, sourced,
        });
        return 'waiting_resources';
    },
};

// ─── Heartbeat ────────────────────────────────────────────────────────────────

/**
 * Verifica todas as cidades e tenta avançar goals.
 * Chamado pelo Builder a cada 15min via setTimeout recursivo.
 */
export async function checkGoalsHeartbeat() {
    const results = {};
    for (const city of Game.getCities()) {
        results[city.id] = await Goals.runGoals(city.id);
    }
    return results;
}

export async function runGoals(cityId) {
    return Goals.runGoals(cityId);
}

export default Goals;
