# Contrato de Eventos (Events.E)

## Fonte

- Catálogo oficial: [modules/Events.js](../../modules/Events.js)

## Objetivo

Evitar strings soltas e divergência de payload esperado entre produtores/consumidores.

## Eventos centrais

### Coleta (`DC_*`) — CONFIRMADO
- `DC_HEADER_DATA` -> `{ headerData, token, url }`
- `DC_SCREEN_DATA` -> `{ screenData, url }`
- `DC_MODEL_REFRESH` -> `{ model }`
- `DC_FLEET_MOVEMENTS` -> `{ movements[] }`
- `DC_TOWNHALL_DATA` -> `{ cityId, params }`
- `DC_REC_CAPTURE` -> `{ seq }`

### Estado (`STATE_*`) — CONFIRMADO
- `STATE_CITY_UPDATED` -> `{ cityId }`
- `STATE_ALL_FRESH` -> `{ ts }`
- `STATE_RESEARCH` -> `{ research }`
- `STATE_READY` -> `{}`

### Fila (`QUEUE_*`) — CONFIRMADO
- `QUEUE_TASK_ADDED` -> `{ task }`
- `QUEUE_TASK_STARTED` -> `{ task }`
- `QUEUE_TASK_DONE` -> `{ task, result }`
- `QUEUE_TASK_FAILED` -> `{ task, error, fatal }`
- `QUEUE_TASK_OUTCOME` -> `{ task, outcome }`
- `QUEUE_TASK_CANCELLED` -> `{ taskId }`
- `QUEUE_BLOCKED` -> `{ reason }`
- `QUEUE_MODE_CHANGED` -> `{ mode }`

### Negócio (subset) — CONFIRMADO
- `CFO_BUILD_APPROVED`
- `CFO_BUILD_BLOCKED`
- `COO_TRANSPORT_SCHED`
- `COO_MULTI_SOURCE`
- `COO_MIN_STOCK_SCHED`
- `HR_WINE_EMERGENCY`
- `HR_WINE_ADJUSTED`
- `HR_WORKER_REALLOC`
- `CTO_RESEARCH_START`
- `CSO_CAPITAL_RISK`
- `CSO_ESCROW_CREATED`

### Planner — CONFIRMADO
- `PLANNER_CYCLE_START` -> `{ ts }`
- `PLANNER_CYCLE_DONE` -> `{ ts, summary, ctx }`

### UI — CONFIRMADO
- `UI_STATE_UPDATED` -> `UIState`
- `UI_ALERT_ADDED` -> `Alert`
- `UI_ALERT_RESOLVED` -> `{ alertId }`
- `UI_COMMAND` -> `{ type, ...args }`
- `HEALTHCHECK_UPDATED` -> estado completo do HealthCheckRunner

### Híbrido endpoint/dom — CONFIRMADO
- `HYBRID_PATH_DECIDED` -> `{ taskId, actionType, decision }`
- `HYBRID_ATTEMPT_OUTCOME` -> `{ taskId, actionType, outcome }`
- `HYBRID_FALLBACK_INVOKED` -> `{ taskId, actionType, reason }`
- `HYBRID_SELECTOR_MISS` -> `{ taskId, actionType, selector }`

## SINAL FORTE

- A maior parte dos contratos de payload está estabilizada por uso cruzado entre core, UI e testes.

## LACUNA

- Não há validação de payload por schema em runtime.

