# Contrato de Tasks (extraído do código)

## Fonte

- Tipos: [modules/taskTypes.js](../../modules/taskTypes.js)
- Fases e lifecycle: [modules/TaskQueue.js](../../modules/TaskQueue.js)

## Task base (SINAL FORTE)

Campos recorrentes observados em [modules/TaskQueue.js](../../modules/TaskQueue.js):

- `id: string`
- `type: 'BUILD' | 'TRANSPORT' | 'RESEARCH' | 'NAVIGATE' | 'NOISE' | 'WORKER_REALLOC' | 'WINE_ADJUST'`
- `cityId: number`
- `status: 'pending' | 'in-flight' | 'waiting_resources' | 'blocked' | 'done' | 'failed'`
- `attempts: number`
- `maxAttempts: number`
- `priority: number`
- `phase: number`
- `scheduledFor: number` (epoch ms)
- `reason?: string`
- `reasonCode?: string`
- `module?: string`
- `confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'`
- `payload?: object`
- `lastOutcome?: TaskOutcome`

## Tipos suportados (CONFIRMADO)

Em [modules/taskTypes.js](../../modules/taskTypes.js):
- `BUILD`
- `TRANSPORT`
- `RESEARCH`
- `NAVIGATE`
- `NOISE`
- `WORKER_REALLOC`
- `WINE_ADJUST`

## Fases padrão (CONFIRMADO)

Definidas em [modules/TaskQueue.js](../../modules/TaskQueue.js):
- `SUSTENTO: 1`
- `LOGISTICA: 2`
- `CONSTRUCAO: 3`
- `PESQUISA: 4`
- `RUIDO: 5`

## Outcome de task (SINAL FORTE)

Campos observados em `lastOutcome` em [modules/TaskQueue.js](../../modules/TaskQueue.js):

- `taskId: string`
- `taskType: string`
- `cityId: number`
- `timestamp: number`
- `latencyMs: number`
- `outcomeClass: 'success' | 'inconclusive' | 'failed' | 'guard_reschedule' | 'guard_cancel'`
- `reasonCode: string | null`
- `evidence: string[]`
- `nextStep: string`

## Payloads típicos por tipo (CONFIRMADO)

### BUILD
- `building`
- `position`
- `buildingView`
- `templateView`
- `cost`
- `toLevel`
- `currentLevel`

### TRANSPORT
- `fromCityId`
- `toCityId`
- `toIslandId`
- `cargo`
- `boats`
- `totalCargo`
- `wineEmergency?`
- `jitBuild?`

### RESEARCH
- `researchId`

### WORKER_REALLOC
- `position`
- `scientists`

### WINE_ADJUST
- `wineLevel`

## LACUNAS

- Não há arquivo de tipagem formal (TS/JSDoc completo) para Task e TaskOutcome.
- Não há validação de schema no momento de `add()`.

