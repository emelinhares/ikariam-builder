// HR.js — Human Resources
// Monitora estoque de vinho e ajusta o nível da taberna.
// Trigger em DC_HEADER_DATA (a cada XHR) para detecção mais rápida possível.

import { getMinWineLevel, WINE_USE } from '../data/wine.js';

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
    }

    init() {
        const E = this._events.E;

        // Verificação a cada headerData — não agir durante fetchAllCities
        this._events.on(E.DC_HEADER_DATA, () => {
            if (this._state.isProbing()) return;
            const cityId = this._state.getActiveCityId();
            if (!cityId || this._state.getConfidence(cityId) === 'UNKNOWN') return;
            const city = this._state.getCity(cityId);
            if (city) this._checkWineRisk(city);
        });

        // Log periódico de status de vinho (max 1x por ciclo de fetchAllCities)
        this._lastWineLog = new Map(); // cityId → { hours, ts }

        // Verificação completa após refresh de todas as cidades
        this._events.on(E.STATE_ALL_FRESH, () => this.replan());
    }

    replan() {
        const cities = this._state.getAllCities();

        // Relatório de ciclo — snapshot consolidado de vinho em todas as cidades
        const lines = cities.map(c => {
            const wine = c.resources?.wine ?? 0;
            let spendings = c.production?.wineSpendings ?? 0;
            if (spendings <= 0 && c.tavern?.wineLevel > 0) {
                spendings = WINE_USE[c.tavern.wineLevel] ?? 0;
            }
            const hours = spendings > 0 ? (wine / spendings).toFixed(1) : '∞';
            const flag   = spendings > 0 && wine / spendings < this._config.get('wineEmergencyHours') ? ' ⚠' : '';
            return `${c.name}=${hours}h${flag}`;
        });
        this._audit.info('HR', `Ciclo vinho: ${lines.join(' | ')}`);

        for (const city of cities) {
            this._checkWineRisk(city, true); // ignorar cooldown no replan explícito
            this._checkWineLevel(city);
        }
    }

    // ── Risco de esgotamento ──────────────────────────────────────────────────

    _checkWineRisk(city, ignoreCooldown = false) {
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
            if (!this._queue.hasPendingType('WINE_ADJUST', city.id)) {
                const minLevel = getMinWineLevel(spendings);
                if (minLevel >= 0 && minLevel !== city.tavern.wineLevel) {
                    this._queue.add({
                        type:     'WINE_ADJUST',
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

    // ── Ajuste preventivo de nível ────────────────────────────────────────────

    _checkWineLevel(city) {
        const spendings = city.production.wineSpendings ?? 0;
        if (spendings <= 0) return;

        const minLevel  = getMinWineLevel(spendings);
        if (minLevel < 0) {
            this._audit.warn('HR',
                `Consumo de vinho (${spendings}/h) supera capacidade máxima da taberna`,
                { cityId: city.id }
            );
            return;
        }

        const current = city.tavern.wineLevel ?? 0;
        if (current === minLevel) return;

        // Verificar se já há ajuste pendente
        const alreadyQueued = this._queue.getPending(city.id)
            .some(t => t.type === 'WINE_ADJUST');
        if (alreadyQueued) return;

        // Segurança: o servidor debita 1 hora inteira de vinho ao alterar o nível da taberna.
        // Se o estoque < 2h, não ajustar — risco real de zerar o vinho imediatamente após o ajuste.
        const wine      = city.resources.wine ?? 0;
        const hoursLeft = spendings > 0 ? wine / spendings : Infinity;
        if (hoursLeft < 2) {
            this._audit.debug('HR',
                `WINE_ADJUST bloqueado em ${city.name}: estoque ${hoursLeft.toFixed(1)}h < 2h (servidor debita 1h no ajuste de taberna)`
            );
            return;
        }

        this._queue.add({
            type:     'WINE_ADJUST',
            priority: 20,
            cityId:   city.id,
            payload:  { wineLevel: minLevel },
            scheduledFor: Date.now(),
            reason:   `HR: Ajustar taberna ${current} → ${minLevel} (consumo ${spendings}/h)`,
            module:   'HR',
            confidence: this._state.getConfidence(city.id),
        });

        this._events.emit(this._events.E.HR_WINE_ADJUSTED, {
            cityId:   city.id,
            oldLevel: current,
            newLevel: minLevel,
        });
    }
}
