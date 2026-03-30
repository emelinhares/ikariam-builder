// taskTypes.js — contrato único para tipos de task do ERP.
// Evita strings soltas entre módulos e reduz risco de divergência.

export const TASK_TYPE = Object.freeze({
    BUILD: 'BUILD',
    TRANSPORT: 'TRANSPORT',
    RESEARCH: 'RESEARCH',
    NAVIGATE: 'NAVIGATE',
    NOISE: 'NOISE',
    WORKER_REALLOC: 'WORKER_REALLOC',
    WINE_ADJUST: 'WINE_ADJUST',
});

export function isTaskType(value) {
    return Object.values(TASK_TYPE).includes(value);
}

