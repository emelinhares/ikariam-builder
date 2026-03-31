# Contrato de UIState

## Fonte

- Produtor: [modules/UIBridge.js](../../modules/UIBridge.js)
- Consumidor: [ui/panel.js](../../ui/panel.js)

## Objetivo

Documentar o shape mínimo realmente consumido pela UI.

## Shape (SINAL FORTE)

```js
{
  bot: {
    status,
    mode,
    confidence,
    lastSync,
    alertCount,
    activeCity
  },
  alerts: Alert[],
  nextAction: object | null,
  queue: {
    pending: Task[],
    inFlight: Task[],
    completed: Task[]
  },
  strategicSummary: object,
  operations: object,
  growthFinance: object,
  research: object,
  cities: CityRow[],
  cityDetail: object | null,
  fleetMovements: object[],
  logs: object[],
  errorTelemetry: {
    recent,
    stats1h,
    hybrid
  },
  healthCheck: object | null,
  recMode: boolean
}
```

## Campos explicitamente usados no painel (CONFIRMADO)

Em [ui/panel.js](../../ui/panel.js):
- `bot.status`, `bot.mode`, `bot.confidence`, `bot.lastSync`, `bot.alertCount`, `bot.activeCity`
- `alerts[]`
- `nextAction.summary`, `nextAction.reason`
- `queue.pending`, `queue.inFlight`, `queue.completed`
- `strategicSummary.currentStage`, `strategicSummary.globalGoal`, `strategicSummary.goalReason`
- `growthFinance.empireReadiness`, `growthFinance.nextMilestone`, `growthFinance.nextRecommendedPhase`
- `research.currentResearch`, `research.nextResearch`, `research.strategicReason`
- `cities[]` (saúde, confiança, construção, readiness, flags)
- `fleetMovements[]`
- `operations.activeBlockers`, `operations.queueCurrent`, `operations.outcomesRecent`
- `logs[]`, `errorTelemetry.*`, `healthCheck`, `recMode`

## LACUNAS

- Não existe validação automática de compatibilidade entre produtor/consumidor.
- Não existe versionamento explícito de `UIState`.

