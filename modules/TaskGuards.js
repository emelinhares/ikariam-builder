import { GameError } from './GameClient.js';
import { TASK_TYPE } from './taskTypes.js';

export class TaskGuards {
    constructor({ state, client, audit, config, getCFO, reschedule, cancelTask, getPendingTasks }) {
        this._state = state;
        this._client = client;
        this._audit = audit;
        this._config = config;
        this._getCFO = getCFO;
        this._reschedule = reschedule;
        this._cancelTask = cancelTask;
        this._getPendingTasks = getPendingTasks;
    }

    async runGuards(task) {
        switch (task.type) {
            case TASK_TYPE.BUILD:
                await this.guardBuild(task);
                break;
            case TASK_TYPE.TRANSPORT:
                await this.guardTransport(task);
                break;
            case TASK_TYPE.WINE_ADJUST:
                await this.guardWineAdjust(task);
                await this.guardNavigate(task.cityId);
                break;
            case TASK_TYPE.RESEARCH:
            case TASK_TYPE.NOISE:
                await this.guardNavigate(task.cityId);
                break;
        }
    }

    async guardNavigate(cityId) {
        if (cityId && this._state.getActiveCityId() !== cityId) {
            await this._client.navigate(cityId);
        }
    }

    async guardBuild(task) {
        const city = this._state.getCity(task.cityId);
        if (!city) {
            throw new GameError('GUARD', `Cidade ${task.cityId} não encontrada no estado`);
        }

        const uc = city.underConstruction ?? -1;
        if (uc !== -1 && uc !== false && uc !== null && Number(uc) !== -1) {
            if (Number(uc) === Number(task.payload.position)) {
                this._audit.info('TaskQueue',
                    `GUARD BUILD: slot ${task.payload.position} em ${city.name} já está em construção — idempotência habilitada`
                );
                return;
            }
            const currentBuild = city.buildings?.[uc];
            const buildName = currentBuild?.building ?? '?';
            const completedAt = currentBuild?.completed;
            const etaMin = completedAt ? Math.round((completedAt - Date.now() / 1000) / 60) : '?';
            task.status = 'cancelled';
            this._cancelTask?.(task);
            throw new GameError('GUARD_CANCEL',
                `GUARD BUILD: ${city.name} já construindo ${buildName} (slot ${uc}, ETA ${etaMin}min) — task cancelada`
            );
        }

        if (city.lockedPositions.has(task.payload.position)) {
            this._reschedule(task, 3_600_000, 'GUARD_BUILD_SLOT_LOCKED');
            throw new GameError('GUARD', `GUARD BUILD: slot ${task.payload.position} bloqueado por pesquisa em ${city.name} — reagendando em 1h`);
        }

        const activeBefore = this._state.getActiveCityId();
        if (activeBefore !== task.cityId) {
            this._audit.debug('TaskQueue', `GUARD BUILD: navigate ${activeBefore} → ${task.cityId} (${city.name})`);
            await this._client.navigate(task.cityId);
        }

        const cfo = this._getCFO?.() ?? null;
        if (cfo && task.payload.cost) {
            if (!cfo.canAfford(task.cityId, task.payload.cost)) {
                this._reschedule(task, 3_600_000, 'GUARD_BUILD_INSUFFICIENT_RESOURCES');
                throw new GameError('GUARD', `GUARD BUILD: recursos insuficientes para ${task.payload.building} em ${city.name} — aguardando transporte (1h)`);
            }
        }

        this._audit.debug('TaskQueue', `GUARD BUILD: ok — ${city.name} pos=${task.payload.position} building=${task.payload.buildingView}`);
    }

    async guardTransport(task) {
        const origin = this._state.getCity(task.payload.fromCityId);
        if (!origin) {
            throw new GameError('GUARD', `GUARD TRANSPORT: cidade origem ${task.payload.fromCityId} não encontrada no estado`);
        }

        if (!task.payload?.toCityId || !task.payload?.toIslandId) {
            throw new GameError('GUARD', 'GUARD TRANSPORT: destino inválido (toCityId/toIslandId ausente)');
        }

        if (Number(task.payload.fromCityId) === Number(task.payload.toCityId)) {
            throw new GameError('GUARD',
                `GUARD TRANSPORT: origem e destino iguais (${task.payload.fromCityId}) — transporte inválido`
            );
        }

        const cargoEntries = Object.entries(task.payload.cargo ?? {});
        const cargoPositive = cargoEntries.filter(([, v]) => (Number(v) || 0) > 0);
        if (cargoPositive.length === 0) {
            throw new GameError('GUARD',
                `GUARD TRANSPORT: carga vazia para ${origin.name} → ${task.payload.toCityId}`
            );
        }

        const boatsRequired = Math.max(...cargoPositive.map(([, v]) => Math.ceil((Number(v) || 0) / 500)));
        if (!Number.isFinite(boatsRequired) || boatsRequired <= 0) {
            throw new GameError('GUARD',
                `GUARD TRANSPORT: cálculo de barcos inválido (boatsRequired=${boatsRequired})`
            );
        }

        if ((Number(task.payload.boats) || 0) < boatsRequired) {
            throw new GameError('GUARD',
                `GUARD TRANSPORT: navios insuficientes (${task.payload.boats}) para a maior coluna de carga (precisa ${boatsRequired})`
            );
        }

        const activeBefore = this._state.getActiveCityId();
        if (activeBefore !== task.payload.fromCityId) {
            this._audit.debug('TaskQueue',
                `GUARD TRANSPORT: navigate ${activeBefore} → ${task.payload.fromCityId} (${origin.name})`
            );
            await this._client.navigate(task.payload.fromCityId);
        }

        const freeT = this._state.getCity(task.payload.fromCityId)?.freeTransporters ?? 0;
        const maxT = this._state.getCity(task.payload.fromCityId)?.maxTransporters ?? 0;
        const essential = this._isEssentialTransport(task);
        this._audit.debug('TaskQueue',
            `GUARD TRANSPORT: ${origin.name} transportadores ${freeT}/${maxT} livres, precisa ${task.payload.boats}, carga=${JSON.stringify(task.payload.cargo)}, wineEmergency=${!!task.payload.wineEmergency}, essential=${essential}`
        );

        if (!task.payload.wineEmergency && freeT < task.payload.boats) {
            const waitMs = (task.payload.estimatedReturnS ?? 3600) * 1000;
            this._reschedule(task, waitMs, 'GUARD_TRANSPORT_NO_FREE_BOATS');
            throw new GameError('GUARD',
                `GUARD TRANSPORT: sem barcos livres em ${origin.name}: ${freeT} livre(s) < ${task.payload.boats} necessário(s) — aguardando ${Math.round(waitMs / 60000)}min`
            );
        }

        if (!task.payload.wineEmergency) {
            const boatsActual = task.payload.boats;
            const perResCapacity = boatsActual * 500;
            const largestCargo = Math.max(
                ...Object.values(task.payload.cargo).map(v => Number(v) || 0)
            );
            const loadFactor = perResCapacity > 0 ? largestCargo / perResCapacity : 0;
            const minFactor = this._config.get('transportMinLoadFactor');
            const isEssential = this._isEssentialTransport(task);

            if (loadFactor < minFactor && !isEssential) {
                const waitMs = (task.payload.estimatedReturnS ?? 3600) * 1000;
                this._reschedule(task, waitMs, 'GUARD_TRANSPORT_LOAD_FACTOR_LOW');
                throw new GameError('GUARD',
                    `GUARD TRANSPORT: carga ${(loadFactor * 100).toFixed(0)}% < mínimo ${(minFactor * 100).toFixed(0)}% em ${origin.name} (maior recurso=${largestCargo}, navios=${boatsActual}, cap/recurso=${perResCapacity}) — aguardando`
                );
            }

            if (loadFactor < minFactor && isEssential) {
                this._audit.info('TaskQueue',
                    `GUARD TRANSPORT: exceção controlada de loadFactor para transporte essencial (${task.reasonCode ?? 'N/A'}) — ` +
                    `carga ${(loadFactor * 100).toFixed(0)}% < mínimo ${(minFactor * 100).toFixed(0)}%`
                );
            }
        }

        this._audit.debug('TaskQueue',
            `GUARD TRANSPORT: ok — ${origin.name} → cidade ${task.payload.toCityId}, ${task.payload.boats} navios, carga=${JSON.stringify(task.payload.cargo)}`
        );
    }

    async guardWineAdjust(task) {
        const city = this._state.getCity(task.cityId);
        if (!city) {
            throw new GameError('GUARD', `GUARD WINE_ADJUST: cidade ${task.cityId} não encontrada no estado`);
        }

        const wineStock = Number(city.resources?.wine ?? 0);
        const targetWineLevel = Number(task.payload?.wineLevel ?? city.tavern?.wineLevel ?? 0);
        const requiresWine = targetWineLevel > 0;

        if (wineStock > 0 || !requiresWine) return;

        const pendingTasks = typeof this._getPendingTasks === 'function'
            ? this._getPendingTasks()
            : [];
        const hasPendingEmergencyWineTransport = pendingTasks.some((t) =>
            t.type === TASK_TYPE.TRANSPORT
            && t.status === 'pending'
            && Number(t.payload?.toCityId) === Number(task.cityId)
            && t.payload?.wineEmergency === true
            && Number(t.payload?.cargo?.wine ?? 0) > 0
        );

        const delayMs = hasPendingEmergencyWineTransport ? 90_000 : 60_000;
        const reasonCode = hasPendingEmergencyWineTransport
            ? 'GUARD_WINE_AWAITING_EMERGENCY_TRANSPORT'
            : 'GUARD_WINE_STOCK_EMPTY';

        this._reschedule(task, delayMs, reasonCode);
        throw new GameError('GUARD',
            hasPendingEmergencyWineTransport
                ? `GUARD WINE_ADJUST: ${city.name} sem vinho disponível (0u) — aguardando transporte de emergência`
                : `GUARD WINE_ADJUST: ${city.name} sem vinho disponível (0u) — aguardando reposição`,
            { code: reasonCode }
        );
    }

    _isEssentialTransport(task) {
        const p = task?.payload ?? {};
        if (p.wineEmergency) return true;
        const moduleIsCoo = (task?.module ?? '') === 'COO';
        if (!moduleIsCoo) return false;
        return !!(p.jitBuild || p.minStock || p.overflowRelief);
    }
}

