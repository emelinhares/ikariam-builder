// HealthCheckRunner.js — suíte de validação operacional em produção
// Executa cenários em tempo real, coleta evidências, gera relatório e exporta JSON/MD.

import { nanoid } from './utils.js';
import { getCost } from '../data/buildings.js';
import { TASK_TYPE } from './taskTypes.js';
import { createSafeStorage } from './SafeStorage.js';

const DEFAULT_COOLDOWN_MS = 5 * 60_000;
const DEFAULT_SCENARIO_TIMEOUT_MS = 120_000;

export class HealthCheckRunner {
    constructor({ events, state, queue, audit, config, storage, client, scenarioFactories = null }) {
        this._events  = events;
        this._state   = state;
        this._queue   = queue;
        this._audit   = audit;
        this._config  = config;
        this._storage = storage;
        this._safeStorage = createSafeStorage(storage, { module: 'HealthCheckRunner', audit });
        this._client  = client;

        this._scenarioFactories = scenarioFactories;

        this._status = {
            runId: null,
            suite: null,
            status: 'idle', // idle | running | done | failed | aborted | blocked
            startedAt: null,
            endedAt: null,
            cooldownUntil: 0,
            currentScenario: null,
            progress: { total: 0, completed: 0, percent: 0 },
            metrics: {
                passed: 0,
                failed: 0,
                blocked: 0,
                inconclusive: 0,
                timeout: 0,
                skipped: 0,
                durationMs: 0,
                passRate: 0,
            },
            scenarios: [],
            report: null,
            reportsHistory: [],
            lastError: null,
        };

        this._abortRequested = false;
        this._runningPromise = null;
    }

    async init() {
        const history = await this._storage?.get?.('healthCheckReports').catch(() => null);
        const last    = await this._storage?.get?.('healthCheckLast').catch(() => null);
        if (Array.isArray(history)) this._status.reportsHistory = history.slice(0, 10);
        if (last) this._status.report = last;
        this._emitUpdate();
    }

    getState() {
        return JSON.parse(JSON.stringify(this._status));
    }

    start({ suite = 'full' } = {}) {
        if (this._status.status === 'running') {
            return { ok: false, code: 'ALREADY_RUNNING', message: 'Health Check já em execução' };
        }

        const now = Date.now();
        if (this._status.cooldownUntil && now < this._status.cooldownUntil) {
            return {
                ok: false,
                code: 'COOLDOWN',
                message: `Aguarde ${Math.ceil((this._status.cooldownUntil - now) / 1000)}s para nova execução`,
            };
        }

        const scenarios = this._buildScenarioPlan(suite);
        if (!scenarios.length) {
            return { ok: false, code: 'NO_SCENARIOS', message: `Suíte ${suite} sem cenários` };
        }

        const runId = `hc_${nanoid(8)}`;
        this._abortRequested = false;
        this._status = {
            ...this._status,
            runId,
            suite,
            status: 'running',
            startedAt: now,
            endedAt: null,
            currentScenario: null,
            progress: { total: scenarios.length, completed: 0, percent: 0 },
            metrics: {
                passed: 0,
                failed: 0,
                blocked: 0,
                inconclusive: 0,
                timeout: 0,
                skipped: 0,
                durationMs: 0,
                passRate: 0,
            },
            scenarios: scenarios.map(s => ({
                id: s.id,
                title: s.title,
                group: s.group,
                status: 'pending',
                startedAt: null,
                endedAt: null,
                elapsedMs: null,
                error: null,
                evidence: [],
            })),
            lastError: null,
        };
        this._emitUpdate();

        this._runningPromise = this._executeRun(scenarios).catch((err) => {
            this._status.status = 'failed';
            this._status.lastError = err?.message ?? String(err);
            this._status.endedAt = Date.now();
            this._emitUpdate();
        });

        return { ok: true, runId };
    }

    abort() {
        if (this._status.status !== 'running') return { ok: false, code: 'NOT_RUNNING' };
        this._abortRequested = true;
        this._audit.warn('HealthCheck', `Abort solicitado para run ${this._status.runId}`);
        return { ok: true };
    }

    exportReport({ format = 'both' } = {}) {
        const report = this._status.report;
        if (!report) return { ok: false, code: 'NO_REPORT', message: 'Sem relatório disponível' };

        const ts = _fmtFileTs(report.meta?.endedAt ?? Date.now());
        const base = `erp-healthcheck-${report.meta?.suite ?? 'suite'}-${ts}`;
        const files = [];

        if (format === 'json' || format === 'both') {
            const jsonName = `${base}.json`;
            _downloadText(jsonName, JSON.stringify(report, null, 2), 'application/json;charset=utf-8');
            files.push(jsonName);
        }
        if (format === 'md' || format === 'both') {
            const mdName = `${base}.md`;
            _downloadText(mdName, this._toMarkdown(report), 'text/markdown;charset=utf-8');
            files.push(mdName);
        }

        this._audit.info('HealthCheck', `Relatório exportado: ${files.join(', ')}`);
        return { ok: true, files };
    }

    _buildScenarioPlan(suite) {
        const all = (this._scenarioFactories ?? this._defaultScenarioFactories()).map(f => f());
        if (suite === 'critical') {
            return all.filter(s => s.critical);
        }
        return all;
    }

    _defaultScenarioFactories() {
        return [
            () => ({
                id: 'state_snapshot',
                title: 'Leitura e consistência de estado multi-cidade',
                group: 'state',
                critical: true,
                timeoutMs: 20_000,
                run: async (ctx) => {
                    const cities = ctx.state.getAllCities() ?? [];
                    if (!cities.length) {
                        return { status: 'blocked', error: 'Nenhuma cidade carregada no estado', evidence: ['state.getAllCities() retornou vazio'] };
                    }
                    const invalid = cities.find(c => !c?.resources || c.id == null || c.name == null);
                    if (invalid) {
                        return { status: 'failed', error: `Cidade inválida no snapshot: id=${invalid?.id}`, evidence: ['Snapshot com schema incompleto'] };
                    }
                    const active = ctx.state.getActiveCityId();
                    return {
                        status: 'passed',
                        evidence: [
                            `cities=${cities.length}`,
                            `activeCity=${active ?? 'N/A'}`,
                            `firstCity=${cities[0]?.name ?? '?'}`,
                        ],
                    };
                },
            }),
            () => ({
                id: 'transport_dispatch',
                title: 'Envio real de recursos via TaskQueue',
                group: 'transport',
                critical: true,
                timeoutMs: DEFAULT_SCENARIO_TIMEOUT_MS,
                run: async (ctx) => {
                    const all = ctx.state.getAllCities() ?? [];
                    const destinations = all.filter(c => c?.islandId != null);
                    if (destinations.length < 2) {
                        return { status: 'blocked', error: 'São necessárias ao menos 2 cidades com islandId', evidence: [] };
                    }

                    const pick = _pickTransportPair(all);
                    if (!pick) {
                        return { status: 'blocked', error: 'Nenhum par origem/destino com recurso mínimo para transporte', evidence: [] };
                    }

                    const qty = 500;
                    const boats = Math.ceil(qty / 500);
                    const taskResult = await ctx.addTaskAndWait({
                        type: TASK_TYPE.TRANSPORT,
                        priority: 0,
                        cityId: pick.from.id,
                        payload: {
                            fromCityId: pick.from.id,
                            toCityId: pick.to.id,
                            toIslandId: pick.to.islandId,
                            cargo: { [pick.resource]: qty },
                            boats,
                            totalCargo: qty,
                        },
                        scheduledFor: Date.now(),
                        reason: `HEALTHCHECK: ${qty} ${pick.resource} ${pick.from.name}→${pick.to.name}`,
                        module: 'HEALTHCHECK',
                        maxAttempts: 1,
                    }, { timeoutMs: DEFAULT_SCENARIO_TIMEOUT_MS });

                    return {
                        status: taskResult.status,
                        error: taskResult.error,
                        evidence: [
                            `taskId=${taskResult.taskId}`,
                            `from=${pick.from.name} to=${pick.to.name}`,
                            `resource=${pick.resource} qty=${qty}`,
                            ...taskResult.evidence,
                        ],
                    };
                },
            }),
            () => ({
                id: 'build_upgrade',
                title: 'Upgrade real de construção via TaskQueue',
                group: 'build',
                critical: true,
                timeoutMs: DEFAULT_SCENARIO_TIMEOUT_MS,
                run: async (ctx) => {
                    const selected = _pickBuildCandidate(ctx.state);
                    if (!selected) {
                        return {
                            status: 'blocked',
                            error: 'Nenhum edifício elegível para upgrade com custo conhecido',
                            evidence: [],
                        };
                    }

                    const taskResult = await ctx.addTaskAndWait({
                        type: TASK_TYPE.BUILD,
                        priority: 0,
                        cityId: selected.city.id,
                        payload: {
                            building: selected.slot.building,
                            position: selected.slot.position,
                            buildingView: selected.slot.building,
                            templateView: selected.slot.building,
                            cost: selected.cost,
                            toLevel: selected.slot.level + 1,
                            currentLevel: selected.slot.level,
                        },
                        scheduledFor: Date.now(),
                        reason: `HEALTHCHECK: ${selected.slot.building} lv${selected.slot.level}→${selected.slot.level + 1}`,
                        module: 'HEALTHCHECK',
                        maxAttempts: 1,
                    }, { timeoutMs: DEFAULT_SCENARIO_TIMEOUT_MS });

                    return {
                        status: taskResult.status,
                        error: taskResult.error,
                        evidence: [
                            `taskId=${taskResult.taskId}`,
                            `city=${selected.city.name}`,
                            `building=${selected.slot.building} pos=${selected.slot.position}`,
                            ...taskResult.evidence,
                        ],
                    };
                },
            }),
            () => ({
                id: 'donation_flow',
                title: 'Doação de recurso da ilha',
                group: 'donation',
                critical: true,
                timeoutMs: 60_000,
                run: async (ctx) => {
                    const city = (ctx.state.getAllCities() ?? []).find(c => c?.islandId && (c.resources?.wood ?? 0) >= 1500);
                    if (!city) {
                        return {
                            status: 'blocked',
                            error: 'Nenhuma cidade com islandId e madeira suficiente para doação',
                            evidence: [],
                        };
                    }

                    const amount = 500;
                    await ctx.client.donateIslandResource(city.islandId, amount, 'resource');
                    return {
                        status: 'passed',
                        evidence: [
                            `city=${city.name}`,
                            `islandId=${city.islandId}`,
                            `amount=${amount}`,
                            'donateIslandResource executado sem erro',
                        ],
                    };
                },
            }),
            () => ({
                id: 'wine_adjust',
                title: 'Ajuste operacional de vinho',
                group: 'sustento',
                critical: false,
                timeoutMs: DEFAULT_SCENARIO_TIMEOUT_MS,
                run: async (ctx) => {
                    const city = (ctx.state.getAllCities() ?? []).find(c => Array.isArray(c?.buildings) && c.buildings.some(b => b?.building === 'tavern'));
                    if (!city) {
                        return { status: 'blocked', error: 'Nenhuma cidade com taberna disponível', evidence: [] };
                    }
                    const targetLevel = city.tavern?.wineLevel ?? 0;
                    const taskResult = await ctx.addTaskAndWait({
                        type: TASK_TYPE.WINE_ADJUST,
                        priority: 0,
                        cityId: city.id,
                        payload: { wineLevel: targetLevel, healthCheck: true },
                        scheduledFor: Date.now(),
                        reason: `HEALTHCHECK: ajuste de vinho em ${city.name}`,
                        module: 'HEALTHCHECK',
                        maxAttempts: 1,
                    }, { timeoutMs: DEFAULT_SCENARIO_TIMEOUT_MS });
                    return {
                        status: taskResult.status,
                        error: taskResult.error,
                        evidence: [`city=${city.name}`, `wineLevel=${targetLevel}`, ...taskResult.evidence],
                    };
                },
            }),
            () => ({
                id: 'workers_science',
                title: 'Ajuste operacional de workers (ciência)',
                group: 'operations',
                critical: false,
                timeoutMs: DEFAULT_SCENARIO_TIMEOUT_MS,
                run: async (ctx) => {
                    const city = (ctx.state.getAllCities() ?? []).find(c => Array.isArray(c?.buildings) && c.buildings.some(b => b?.building === 'academy'));
                    if (!city) {
                        return { status: 'blocked', error: 'Nenhuma cidade com academia encontrada', evidence: [] };
                    }
                    const academy = city.buildings.find(b => b.building === 'academy');
                    const scientists = city.workers?.scientists ?? 0;

                    const taskResult = await ctx.addTaskAndWait({
                        type: TASK_TYPE.WORKER_REALLOC,
                        priority: 0,
                        cityId: city.id,
                        payload: {
                            position: academy.position,
                            scientists,
                            healthCheck: true,
                        },
                        scheduledFor: Date.now(),
                        reason: `HEALTHCHECK: workerPlan em ${city.name}`,
                        module: 'HEALTHCHECK',
                        maxAttempts: 1,
                    }, { timeoutMs: DEFAULT_SCENARIO_TIMEOUT_MS });

                    return {
                        status: taskResult.status,
                        error: taskResult.error,
                        evidence: [
                            `city=${city.name}`,
                            `academyPos=${academy.position}`,
                            `scientists=${scientists}`,
                            ...taskResult.evidence,
                        ],
                    };
                },
            }),
            () => ({
                id: 'queue_guardrails',
                title: 'Saúde da fila e guard rails',
                group: 'queue',
                critical: false,
                timeoutMs: 15_000,
                run: async (ctx) => {
                    const pending = ctx.queue.getPending() ?? [];
                    const history = ctx.queue.getHistory() ?? [];
                    const failedRecent = history.filter(t => t?.status === 'failed').slice(-5);
                    return {
                        status: 'passed',
                        evidence: [
                            `pending=${pending.length}`,
                            `history=${history.length}`,
                            `recentFailed=${failedRecent.length}`,
                        ],
                    };
                },
            }),
        ];
    }

    async _executeRun(scenarios) {
        const runStartedAt = Date.now();
        for (let i = 0; i < scenarios.length; i++) {
            if (this._abortRequested) break;

            const scenario = scenarios[i];
            const slot = this._status.scenarios[i];
            slot.status = 'running';
            slot.startedAt = Date.now();
            this._status.currentScenario = { id: scenario.id, title: scenario.title };
            this._emitUpdate();

            try {
                const result = await this._withTimeout(
                    scenario.run(this._scenarioContext(scenario)),
                    scenario.timeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS,
                    `${scenario.id} timeout`
                );
                slot.status = result?.status ?? 'failed';
                slot.error = result?.error ?? null;
                slot.evidence = Array.isArray(result?.evidence) ? result.evidence : [];
            } catch (err) {
                slot.status = 'failed';
                slot.error = err?.message ?? String(err);
                slot.evidence = [
                    ...(slot.evidence ?? []),
                    `exception=${slot.error}`,
                ];
            } finally {
                slot.endedAt = Date.now();
                slot.elapsedMs = slot.endedAt - slot.startedAt;
                this._status.progress.completed = i + 1;
                this._status.progress.percent = Math.round(((i + 1) / scenarios.length) * 100);
                this._recalcMetrics(runStartedAt);
                this._emitUpdate();
            }
        }

        if (this._abortRequested) {
            for (const s of this._status.scenarios) {
                if (s.status === 'pending' || s.status === 'running') {
                    s.status = 'skipped';
                    s.error = 'Execução abortada pelo operador';
                    s.endedAt = Date.now();
                    s.elapsedMs = s.startedAt ? (s.endedAt - s.startedAt) : 0;
                }
            }
        }

        this._status.endedAt = Date.now();
        this._status.status = this._abortRequested ? 'aborted' : this._finalRunStatus();
        this._status.currentScenario = null;
        this._recalcMetrics(runStartedAt);
        this._status.cooldownUntil = Date.now() + (this._config.get?.('healthCheckCooldownMs') ?? DEFAULT_COOLDOWN_MS);

        const report = this._buildReport();
        this._status.report = report;
        await this._persistReport(report);

        // Exportação automática para Downloads conforme solicitado.
        this.exportReport({ format: 'both' });
        this._emitUpdate();
    }

    _scenarioContext() {
        return {
            events: this._events,
            state: this._state,
            queue: this._queue,
            audit: this._audit,
            config: this._config,
            storage: this._storage,
            client: this._client,
            waitForEvent: (eventName, filter, timeoutMs = 30_000) => this._waitForEvent(eventName, filter, timeoutMs),
            addTaskAndWait: (taskData, opts) => this._addTaskAndWait(taskData, opts),
        };
    }

    async _persistReport(report) {
        const history = [
            {
                runId: report.meta.runId,
                suite: report.meta.suite,
                status: report.summary.status,
                startedAt: report.meta.startedAt,
                endedAt: report.meta.endedAt,
                metrics: report.summary.metrics,
            },
            ...(this._status.reportsHistory ?? []),
        ].slice(0, 10);

        this._status.reportsHistory = history;

        await this._safeStorage.set('healthCheckReports', history);
        await this._safeStorage.set('healthCheckLast', report);
    }

    _finalRunStatus() {
        if (this._status.metrics.failed > 0 || this._status.metrics.inconclusive > 0 || this._status.metrics.timeout > 0) return 'failed';
        if (this._status.metrics.blocked > 0) return 'blocked';
        return 'done';
    }

    _recalcMetrics(runStartedAt) {
        const scenarios = this._status.scenarios ?? [];
        const passed = scenarios.filter(s => s.status === 'passed').length;
        const failed = scenarios.filter(s => s.status === 'failed').length;
        const blocked = scenarios.filter(s => s.status === 'blocked').length;
        const inconclusive = scenarios.filter(s => s.status === 'inconclusive').length;
        const timeout = scenarios.filter(s => s.status === 'timeout').length;
        const skipped = scenarios.filter(s => s.status === 'skipped').length;
        const done = passed + failed + blocked + inconclusive + timeout;
        const passRate = done > 0 ? Number(((passed / done) * 100).toFixed(1)) : 0;

        this._status.metrics = {
            passed,
            failed,
            blocked,
            inconclusive,
            timeout,
            skipped,
            durationMs: Date.now() - runStartedAt,
            passRate,
        };
    }

    _buildReport() {
        const cities = this._state.getAllCities?.() ?? [];
        return {
            meta: {
                runId: this._status.runId,
                suite: this._status.suite,
                startedAt: this._status.startedAt,
                endedAt: this._status.endedAt,
                generatedAt: Date.now(),
                cityCount: cities.length,
                activeCityId: this._state.getActiveCityId?.() ?? null,
            },
            summary: {
                status: this._status.status,
                progress: this._status.progress,
                metrics: this._status.metrics,
            },
            scenarios: this._status.scenarios.map(s => ({ ...s })),
        };
    }

    _toMarkdown(report) {
        const lines = [];
        lines.push('# ERP Health Check Report');
        lines.push('');
        lines.push(`- Run ID: ${report.meta.runId}`);
        lines.push(`- Suite: ${report.meta.suite}`);
        lines.push(`- Status: ${report.summary.status}`);
        lines.push(`- Started: ${new Date(report.meta.startedAt).toISOString()}`);
        lines.push(`- Ended: ${new Date(report.meta.endedAt).toISOString()}`);
        lines.push(`- Cities: ${report.meta.cityCount}`);
        lines.push('');
        lines.push('## Metrics');
        lines.push('');
        lines.push(`- Passed: ${report.summary.metrics.passed}`);
        lines.push(`- Failed: ${report.summary.metrics.failed}`);
        lines.push(`- Blocked: ${report.summary.metrics.blocked}`);
        lines.push(`- Inconclusive: ${report.summary.metrics.inconclusive ?? 0}`);
        lines.push(`- Timeout: ${report.summary.metrics.timeout ?? 0}`);
        lines.push(`- Skipped: ${report.summary.metrics.skipped}`);
        lines.push(`- Pass rate: ${report.summary.metrics.passRate}%`);
        lines.push(`- Duration: ${Math.round(report.summary.metrics.durationMs / 1000)}s`);
        lines.push('');
        lines.push('## Scenario Matrix');
        lines.push('');
        lines.push('| ID | Title | Status | Duration(ms) | Error |');
        lines.push('|---|---|---|---:|---|');
        for (const s of report.scenarios) {
            lines.push(`| ${s.id} | ${s.title} | ${s.status} | ${s.elapsedMs ?? 0} | ${String(s.error ?? '').replace(/\|/g, '\\|')} |`);
        }
        lines.push('');
        lines.push('## Evidences');
        lines.push('');
        for (const s of report.scenarios) {
            lines.push(`### ${s.id} — ${s.title}`);
            if (s.evidence?.length) {
                for (const ev of s.evidence) lines.push(`- ${ev}`);
            } else {
                lines.push('- (no evidence)');
            }
            lines.push('');
        }
        return lines.join('\n');
    }

    _waitForEvent(eventName, filter, timeoutMs = 30_000) {
        return new Promise((resolve, reject) => {
            const off = this._events.on(eventName, (payload) => {
                try {
                    if (typeof filter === 'function' && !filter(payload)) return;
                    clearTimeout(timer);
                    off();
                    resolve(payload);
                } catch (err) {
                    clearTimeout(timer);
                    off();
                    reject(err);
                }
            });
            const timer = setTimeout(() => {
                off();
                reject(new Error(`timeout waiting event ${eventName}`));
            }, timeoutMs);
        });
    }

    _addTaskAndWait(taskData, {
        timeoutMs = DEFAULT_SCENARIO_TIMEOUT_MS,
        pollIntervalMs = 500,
        guardRescheduleGraceMs = 2_000,
    } = {}) {
        const task = this._queue.add(taskData);
        const taskId = task.id;
        const evidence = [`taskAdded=${taskId}`];

        return new Promise((resolve) => {
            let done = false;
            let startedAt = null;
            let lastObservedStatus = null;
            const offStarted = this._events.on(this._events.E.QUEUE_TASK_STARTED, ({ task: t }) => {
                if (t?.id !== taskId) return;
                startedAt = Date.now();
                evidence.push(`taskStarted=${taskId}`);
            });
            const offDone = this._events.on(this._events.E.QUEUE_TASK_DONE, ({ task: t }) => {
                if (t?.id !== taskId || done) return;
                done = true;
                cleanup();
                evidence.push(`taskDone=${taskId}`);
                if (t?.lastOutcome) {
                    evidence.push(`outcomeClass=${t.lastOutcome.outcomeClass}`);
                    evidence.push(`reasonCode=${t.lastOutcome.reasonCode ?? 'N/A'}`);
                    evidence.push(...(Array.isArray(t.lastOutcome.evidence) ? t.lastOutcome.evidence.map(ev => `outcomeEvidence=${ev}`) : []));
                }
                resolve({ status: 'passed', taskId, evidence, error: null, outcome: t?.lastOutcome ?? null });
            });
            const offFailed = this._events.on(this._events.E.QUEUE_TASK_FAILED, ({ task: t, error }) => {
                if (t?.id !== taskId || done) return;
                done = true;
                cleanup();
                evidence.push(`taskFailed=${taskId}`);
                if (t?.lastOutcome) {
                    evidence.push(`outcomeClass=${t.lastOutcome.outcomeClass}`);
                    evidence.push(`reasonCode=${t.lastOutcome.reasonCode ?? 'N/A'}`);
                }
                resolve({ status: 'failed', taskId, evidence, error: String(error ?? 'Task falhou'), outcome: t?.lastOutcome ?? null });
            });
            const offOutcome = this._events.on(this._events.E.QUEUE_TASK_OUTCOME, ({ task: t, outcome }) => {
                if (t?.id !== taskId || done || !outcome) return;
                evidence.push(`outcomeClass=${outcome.outcomeClass}`);
                evidence.push(`reasonCode=${outcome.reasonCode ?? 'N/A'}`);
                evidence.push(`nextStep=${outcome.nextStep ?? 'none'}`);
                if (Array.isArray(outcome.evidence)) {
                    for (const ev of outcome.evidence.slice(0, 10)) evidence.push(`outcomeEvidence=${ev}`);
                }

                if (outcome.outcomeClass === 'guard_reschedule' || outcome.outcomeClass === 'guard_cancel') {
                    done = true;
                    cleanup();
                    resolve({
                        status: 'blocked',
                        taskId,
                        evidence,
                        error: `Task ${taskId} bloqueada por guard (${outcome.reasonCode ?? 'GUARD'})`,
                        outcome,
                    });
                    return;
                }

                if (outcome.outcomeClass === 'inconclusive') {
                    done = true;
                    cleanup();
                    resolve({
                        status: 'inconclusive',
                        taskId,
                        evidence,
                        error: `Task ${taskId} inconclusiva (${outcome.reasonCode ?? 'INCONCLUSIVE'})`,
                        outcome,
                    });
                    return;
                }

                if (outcome.outcomeClass === 'failed') {
                    done = true;
                    cleanup();
                    resolve({
                        status: 'failed',
                        taskId,
                        evidence,
                        error: `Task ${taskId} falhou (${outcome.reasonCode ?? 'FAILED'})`,
                        outcome,
                    });
                }
            });

            const pollTimer = setInterval(() => {
                if (done) return;

                const snapshot = this._queue?.getTaskById?.(taskId);
                if (!snapshot) return;

                const status = String(snapshot.status ?? 'unknown');
                if (status !== lastObservedStatus) {
                    evidence.push(`taskStatus=${status}`);
                    lastObservedStatus = status;
                }

                // Política aprovada: se houve início e o guard devolveu para pending com
                // reagendamento futuro, tratar como indisponibilidade operacional imediata.
                if (
                    startedAt &&
                    status === 'pending' &&
                    Number(snapshot.scheduledFor) > Date.now() + guardRescheduleGraceMs
                ) {
                    done = true;
                    cleanup();
                    const nextAt = Number(snapshot.scheduledFor);
                    const waitMs = Math.max(0, nextAt - Date.now());
                    evidence.push(`taskRescheduled=${taskId}`);
                    evidence.push(`nextScheduledFor=${Number.isFinite(nextAt) ? new Date(nextAt).toISOString() : 'N/A'}`);
                    evidence.push(`rescheduleDelayMs=${waitMs}`);
                    evidence.push(`attempts=${snapshot.attempts ?? 0}/${snapshot.maxAttempts ?? '?'}`);
                    resolve({
                        status: 'blocked',
                        taskId,
                        evidence,
                        error: `Guard reagendou task ${taskId} (pending em ${Math.round(waitMs / 1000)}s)`,
                        outcome: snapshot.lastOutcome ?? null,
                    });
                }
            }, Math.max(50, pollIntervalMs));

            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                const snapshot = this._queue?.getTaskById?.(taskId);
                if (snapshot) {
                    evidence.push(`taskStatusAtTimeout=${snapshot.status ?? 'unknown'}`);
                    if (snapshot.scheduledFor) {
                        evidence.push(`scheduledForAtTimeout=${new Date(snapshot.scheduledFor).toISOString()}`);
                    }
                    evidence.push(`attempts=${snapshot.attempts ?? 0}/${snapshot.maxAttempts ?? '?'}`);
                    if (snapshot.lastOutcome) {
                        evidence.push(`lastOutcomeClass=${snapshot.lastOutcome.outcomeClass}`);
                        evidence.push(`lastReasonCode=${snapshot.lastOutcome.reasonCode ?? 'N/A'}`);
                    }
                }
                cleanup();
                resolve({ status: 'timeout', taskId, evidence, error: `Timeout aguardando conclusão da task ${taskId}` });
            }, timeoutMs);

            const cleanup = () => {
                clearTimeout(timer);
                clearInterval(pollTimer);
                offStarted();
                offDone();
                offFailed();
                offOutcome();
            };
        });
    }

    _withTimeout(promise, timeoutMs, timeoutLabel = 'timeout') {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(timeoutLabel)), timeoutMs);
            Promise.resolve(promise)
                .then((v) => {
                    clearTimeout(timer);
                    resolve(v);
                })
                .catch((e) => {
                    clearTimeout(timer);
                    reject(e);
                });
        });
    }

    _emitUpdate() {
        this._events.emit(this._events.E.HEALTHCHECK_UPDATED, this.getState());
    }
}

function _pickTransportPair(cities) {
    if (!Array.isArray(cities) || cities.length < 2) return null;
    const resourceKeys = ['wood', 'marble', 'glass', 'sulfur', 'wine'];

    let best = null;
    for (const from of cities) {
        for (const to of cities) {
            if (!from || !to || from.id === to.id || !to.islandId) continue;
            for (const rk of resourceKeys) {
                const qty = Number(from.resources?.[rk] ?? 0);
                if (qty < 600) continue;
                if (!best || qty > best.qty) best = { from, to, resource: rk, qty };
            }
        }
    }
    return best;
}

function _pickBuildCandidate(state) {
    const cities = state.getAllCities() ?? [];
    const SKIP = new Set([
        'buildingGround land', 'buildingGround sea', 'buildingGround dockyard',
        'buildingGround', 'pirateFortress', 'chronosForge', 'shrineOflympus', 'shrineOfOlympus',
        'dump', 'wall', 'palaceColony', 'palace',
    ]);

    for (const city of cities) {
        const candidates = (city.buildings || []).filter(b => {
            if (!b?.building || b.building.includes('buildingGround') || b.building.includes('constructionSite')) return false;
            if (SKIP.has(b.building)) return false;
            try {
                const c = getCost(b.building, (b.level ?? 0) + 1);
                return c && Object.keys(c).length > 0;
            } catch {
                return false;
            }
        });
        if (!candidates.length) continue;
        const slot = candidates[Math.floor(Math.random() * candidates.length)];
        return {
            city,
            slot,
            cost: getCost(slot.building, slot.level + 1),
        };
    }

    return null;
}

function _downloadText(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function _fmtFileTs(ts) {
    const d = new Date(ts);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

