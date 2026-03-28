// Port.js — fila centralizada de transporte de recursos
//
// Payload CONFIRMADO funcionar (spec TECHNICAL_SPEC.md):
//   action: 'transportOperations'
//   function: 'loadTransportersWithFreight'
//   capacity: 5, max_capacity: 5  ← SEMPRE 5, não 500
//   islandId = ilha DESTINO, não origem
//   currentCityId DEVE ser a cidade atual da sessão → navegar antes de enviar
//
// Prioridades da fila:
//   1 = goal (meta de construção)
//   2 = wine_critical (vinho < 6h)
//   3 = wine
//   4 = rebalance

import Game from './Game.js';
import ResourceCache from './ResourceCache.js';
import Storage from './Storage.js';
import Events from './Events.js';
import { GamePlay } from '../data/const.js';
import { humanDelay as _humanDelayBase } from './utils.js';

// ─── Mapeamento recurso → campo do payload ────────────────────────────────────
const CARGO_FIELD = {
    wood:    'cargo_resource',
    wine:    'cargo_tradegood1',
    marble:  'cargo_tradegood2',
    glass:   'cargo_tradegood3',
    sulfur:  'cargo_tradegood4',
};

// ─── Chaves de persistência ───────────────────────────────────────────────────
const SK_QUEUE   = 'port_queue';
const SK_RUNNING = 'port_running';

// ─── Estado interno ───────────────────────────────────────────────────────────
let _queue   = [];
let _running = false;

// ─── Helpers: delay humanizado ────────────────────────────────────────────────

const _humanDelay = _humanDelayBase;

// ─── Helpers: cálculo de carga ────────────────────────────────────────────────

/**
 * Calcula quantos barcos e quanto enviar numa viagem.
 * Cada barco carrega 500 unidades.
 */
function _calcBoats(fromCityId, amount) {
    const free    = ResourceCache.getFreeTransporters(fromCityId);
    const boats   = Math.min(Math.ceil(amount / GamePlay.RESOURCES_PER_TRANSPORT), free);
    const sending = Math.min(amount, boats * GamePlay.RESOURCES_PER_TRANSPORT);
    return { boats, sending };
}

// ─── AJAX ─────────────────────────────────────────────────────────────────────

async function _sendOnce(task) {
    const { fromCityId, toCityId, toIslandId, resource, amount } = task;
    const field = CARGO_FIELD[resource];
    if (!field) throw new Error(`[Port] Recurso desconhecido: ${resource}`);

    const { boats, sending } = _calcBoats(fromCityId, amount);
    if (boats <= 0) throw new Error('[Port] Sem barcos livres');
    if (sending < GamePlay.RESOURCES_PER_TRANSPORT && sending < amount) {
        throw new Error('[Port] Quantidade insuficiente para envio mínimo');
    }

    const freeBoats = ResourceCache.getFreeTransporters(fromCityId);

    const body = new URLSearchParams({
        action:                'transportOperations',
        function:              'loadTransportersWithFreight',
        destinationCityId:     toCityId,
        islandId:              toIslandId,   // DESTINO, não origem
        oldView:               '',
        position:              '',
        avatar2Name:           '',
        city2Name:             '',
        type:                  '',
        activeTab:             '',
        transportDisplayPrice: 0,
        premiumTransporter:    0,
        normalTransportersMax: freeBoats,
        cargo_resource:        field === 'cargo_resource'   ? sending : 0,
        cargo_tradegood1:      field === 'cargo_tradegood1' ? sending : 0,
        cargo_tradegood2:      field === 'cargo_tradegood2' ? sending : 0,
        cargo_tradegood3:      field === 'cargo_tradegood3' ? sending : 0,
        cargo_tradegood4:      field === 'cargo_tradegood4' ? sending : 0,
        capacity:              boats * 5, // transporters × max_capacity — CONFIRMADO 2026-03-28
        max_capacity:          5,
        jetPropulsion:         0,
        transporters:          boats,
        backgroundView:        'city',
        currentCityId:         fromCityId,   // DEVE ser cidade atual da sessão
        templateView:          'transport',
        currentTab:            'tabSendTransporter',
        actionRequest:         Game.getToken(),
        ajax:                  1,
    });

    const data = await Game.request('/index.php', body.toString());
    ResourceCache.updateFromResponse(data.find(d => d[0] === 'updateGlobalData')?.[1]);
    return sending;
}

// ─── Persistência ─────────────────────────────────────────────────────────────

async function _loadQueue() {
    _queue   = (await Storage.get(SK_QUEUE))   ?? [];
    _running = (await Storage.get(SK_RUNNING)) ?? false;
}

function _saveQueue() {
    Storage.set(SK_QUEUE,   _queue);
    Storage.set(SK_RUNNING, _running);
}

// ─── Ordenação por prioridade ─────────────────────────────────────────────────
const PRIORITY = { goal: 1, wine_critical: 2, wine: 3, rebalance: 4 };

function _sortQueue() {
    _queue.sort((a, b) => (PRIORITY[a.type] ?? 9) - (PRIORITY[b.type] ?? 9));
}

// ─── API pública ──────────────────────────────────────────────────────────────

const Port = {

    async init() {
        await _loadQueue();
    },

    /**
     * Adiciona transferências à fila.
     * Cada item: { type, fromCityId, toCityId, toIslandId, resource, amount }
     * type: 'goal' | 'wine_critical' | 'wine' | 'rebalance'
     */
    enqueue(transfers) {
        for (const t of transfers) {
            // Proteção contra duplicatas de rebalance (spec: verificar antes)
            if (t.type === 'rebalance') {
                const dup = _queue.find(q =>
                    q.type === 'rebalance' &&
                    q.fromCityId === t.fromCityId &&
                    q.toCityId === t.toCityId &&
                    q.resource === t.resource
                );
                if (dup) continue;
            }
            _queue.push(t);
        }
        _sortQueue();
        _saveQueue();
    },

    getQueue()   { return [..._queue]; },
    isRunning()  { return _running; },
    hasWork()    { return _queue.length > 0; },

    clearQueue() {
        _queue = [];
        Storage.remove(SK_QUEUE);
    },
};

// ─── Execução principal ───────────────────────────────────────────────────────

/**
 * Processa a fila de transferências.
 * CRÍTICO: currentCityId no payload DEVE ser a cidade atual da sessão.
 * → O Port navega até a cidade origem antes de enviar.
 * → Após reload, Builder detecta port_running=true e chama runPort() novamente.
 */
export async function runPort() {
    if (_running) return;
    if (!_queue.length) return;

    _running = true;
    _saveQueue();

    console.log(`[Port] Iniciando fila: ${_queue.length} tarefa(s).`);

    while (_queue.length > 0) {
        const task = _queue[0];

        // Navega até a cidade origem se necessário
        if (Game.getCityId() !== task.fromCityId) {
            console.log(`[Port] Navegando para cidade ${task.fromCityId}...`);
            Storage.set(SK_RUNNING, true);
            Storage.set(SK_QUEUE, _queue);
            window.location.href =
                `${location.origin}/index.php?view=city&cityId=${task.fromCityId}`;
            return; // página vai recarregar; Builder retoma runPort()
        }

        // Refresca recursos antes de enviar
        ResourceCache.refresh(task.fromCityId);

        const available = ResourceCache.getCurrent(task.fromCityId, task.resource);
        if (available < GamePlay.RESOURCES_PER_TRANSPORT) {
            console.warn(`[Port] Estoque insuficiente em ${task.fromCityId} ` +
                `(${task.resource}: ${available}). Pulando.`);
            _queue.shift();
            _saveQueue();
            continue;
        }

        // Ajusta para o disponível
        if (available < task.amount) task.amount = available;

        try {
            const sent = await _sendOnce(task);

            Events.emit('port:transfer_done', {
                fromCityId: task.fromCityId,
                toCityId:   task.toCityId,
                resource:   task.resource,
                amount:     sent,
            });

            ResourceCache.invalidate(task.fromCityId);
            ResourceCache.invalidate(task.toCityId);

            task.amount -= sent;
            if (task.amount <= 0) {
                _queue.shift();
            }
            _saveQueue();

            if (_queue.length > 0) await _humanDelay(4000, 7000);

        } catch (err) {
            console.error('[Port] Erro na transferência:', err);
            // Move para o fim e interrompe; Builder reagendará
            _queue.push(_queue.shift());
            _saveQueue();
            _running = false;
            _saveQueue();
            await _humanDelay(15000, 25000);
            return;
        }
    }

    _running = false;
    _saveQueue();

    Events.emit('port:done', {});
    console.log('[Port] Fila concluída.');
}

export default Port;
