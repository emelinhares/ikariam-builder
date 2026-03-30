// Events.js — barramento pub/sub singleton
// Exportado como named export { Events } para uso como ES module.
// Zero dependências.

const _listeners = new Map(); // event → Set<handler>

export const Events = {

    // ── API pública ──────────────────────────────────────────────────────────

    /** Inscreve handler. Retorna função de unsubscribe. */
    on(event, handler) {
        if (!_listeners.has(event)) _listeners.set(event, new Set());
        _listeners.get(event).add(handler);
        return () => this.off(event, handler);
    },

    /** Inscreve handler para uma única execução. Retorna função de unsubscribe. */
    once(event, handler) {
        const wrapper = (payload) => {
            this.off(event, wrapper);
            handler(payload);
        };
        return this.on(event, wrapper);
    },

    /** Remove handler específico de um evento. */
    off(event, handler) {
        _listeners.get(event)?.delete(handler);
    },

    /** Dispara evento para todos os handlers inscritos. */
    emit(event, payload) {
        const handlers = _listeners.get(event);
        if (!handlers) return;
        for (const h of handlers) {
            try { h(payload); }
            catch (e) { (window.__erpLog ?? (() => {}))(`[Events] handler error on "${event}": ${e?.message}`); }
        }
    },

    /** Remove todos os listeners de um evento (ou todos os eventos se omitido). */
    clear(event) {
        if (event) _listeners.delete(event);
        else       _listeners.clear();
    },

    // ── Catálogo de nomes de evento ──────────────────────────────────────────
    // Usar sempre Events.E.FOO em vez de strings soltas no código.

    E: Object.freeze({
        // DataCollector
        DC_HEADER_DATA:       'dc:headerData',        // { headerData, token, url }
        DC_SCREEN_DATA:       'dc:screenData',        // { screenData, url }
        DC_MODEL_REFRESH:     'dc:modelRefresh',      // { model }
        DC_FLEET_MOVEMENTS:   'dc:fleetMovements',    // { movements[] }
        DC_TOWNHALL_DATA:     'dc:townhallData',      // { cityId, params } — viewScriptParams do townHall
        DC_REC_CAPTURE:       'dc:recCapture',        // { seq } — nova captura REC armazenada

        // StateManager
        STATE_CITY_UPDATED:   'state:cityUpdated',    // { cityId }
        STATE_ALL_FRESH:      'state:allCitiesFresh', // { ts }
        STATE_RESEARCH:       'state:researchUpdated',// { research }
        STATE_READY:          'state:ready',          // {} — emitido após 1º model refresh

        // TaskQueue
        QUEUE_TASK_ADDED:     'queue:taskAdded',      // { task }
        QUEUE_TASK_STARTED:   'queue:taskStarted',    // { task }
        QUEUE_TASK_DONE:      'queue:taskCompleted',  // { task, result }
        QUEUE_TASK_FAILED:    'queue:taskFailed',     // { task, error, fatal }
        QUEUE_TASK_CANCELLED: 'queue:taskCancelled',  // { taskId }
        QUEUE_BLOCKED:        'queue:blocked',        // { reason }
        QUEUE_MODE_CHANGED:   'queue:modeChanged',    // { mode }

        // Módulos de negócio
        CFO_BUILD_APPROVED:   'cfo:buildApproved',      // { cityId, building, position, reason }
        CFO_BUILD_BLOCKED:    'cfo:buildBlocked',       // { cityId, building, reason }
        COO_TRANSPORT_SCHED:  'coo:transportScheduled', // { task }
        COO_MULTI_SOURCE:     'coo:multiSource',        // { res, deficit, sources[], dest }
        COO_MIN_STOCK_SCHED:  'coo:minStockScheduled',  // { cityId, res, amount, source }
        HR_WINE_EMERGENCY:    'hr:wineEmergency',    // { cityId, hoursRemaining }
        HR_WINE_ADJUSTED:     'hr:wineAdjusted',     // { cityId, oldLevel, newLevel }
        HR_WORKER_REALLOC:    'hr:workerReallocated',// { cityId }
        CTO_RESEARCH_START:   'cto:researchStarted', // { researchId }
        CSO_CAPITAL_RISK:     'cso:capitalAtRisk',   // { cityId, atRisk }
        CSO_ESCROW_CREATED:   'cso:escrowCreated',   // { cityId, offerId, goldHidden }

        // Planner
        PLANNER_CYCLE_START:  'planner:cycleStart',  // { ts }
        PLANNER_CYCLE_DONE:   'planner:cycleDone',   // { ts, summary, ctx }

        // UI
        UI_STATE_UPDATED:     'ui:state:updated',    // UIState completo
        UI_ALERT_ADDED:       'ui:alert:added',      // Alert
        UI_ALERT_RESOLVED:    'ui:alert:resolved',   // { alertId }
        UI_COMMAND:           'ui:command',          // { type, ...args }

        // Audit / observabilidade
        AUDIT_ENTRY_ADDED:    'audit:entry:added',   // { entry }
        AUDIT_ERROR_ADDED:    'audit:error:added',   // { entry }
    }),
};

// Compatibilidade com testes/consumidores legados que importam default.
export default Events;
