# Regras Validadas no Código

Classificação usada:
- CONFIRMADO
- SINAL FORTE
- LACUNA

## Execução e fila

### CONFIRMADO
- Apenas [modules/GameClient.js](../modules/GameClient.js) faz requests ao jogo.
- [modules/TaskQueue.js](../modules/TaskQueue.js) define fases (`SUSTENTO`, `LOGISTICA`, `CONSTRUCAO`, `PESQUISA`, `RUIDO`) e ordena por `phase -> priority -> scheduledFor`.
- Tasks `BUILD` e `RESEARCH` são descartadas na restauração da fila por serem tratadas como efêmeras.
- Task crítica registra outcome (`lastOutcome`, `outcomeHistory`) e emite `QUEUE_TASK_OUTCOME`.

### SINAL FORTE
- Estratégia de execução é endpoint-first com pós-validação por estado/resposta.

### LACUNA
- Não há documento único com SLA por tipo de task fora do código.

## Estado e coleta

### CONFIRMADO
- [modules/DataCollector.js](../modules/DataCollector.js) não faz request; só intercepta e emite eventos.
- [modules/StateManager.js](../modules/StateManager.js) é fonte única de verdade e mantém `cities`, `research`, `fleetMovements`.
- [modules/StateManager.js](../modules/StateManager.js) pausa probing durante `fetchAllCities` com flag `_probing`.

### SINAL FORTE
- `fetchAllCities` + `acquireSession()` evita interposição de task durante navegação de probe.

### LACUNA
- Não existe schema formal versionado de `CityState`.

## Orquestração de negócio

### CONFIRMADO
- [modules/Planner.js](../modules/Planner.js) é único listener de `STATE_ALL_FRESH`.
- Ordem de ciclo observada: HR -> COO -> CFO -> CTO -> CSO/MnA.
- `buildBlocked` no contexto impede build quando há emergência de sustento.

### SINAL FORTE
- `PlannerContext` é o contrato implícito entre módulos no ciclo.

### LACUNA
- Não existe tipagem central do `PlannerContext`.

## UI e observabilidade

### CONFIRMADO
- [modules/UIBridge.js](../modules/UIBridge.js) é responsável por montar `UIState`.
- [ui/panel.js](../ui/panel.js) só consome evento `UI_STATE_UPDATED`.
- [modules/HealthCheckRunner.js](../modules/HealthCheckRunner.js) executa cenários e exporta relatório JSON/MD.

### SINAL FORTE
- Mudança de shape no `UIState` quebra painel rapidamente.

### LACUNA
- Não há validação de schema de `UIState` em runtime.

## Configuração e persistência

### CONFIRMADO
- [modules/Config.js](../modules/Config.js) guarda defaults e persiste em storage.
- [modules/Storage.js](../modules/Storage.js) é backend de persistência usado por Config/TaskQueue/HealthCheck.

### SINAL FORTE
- Persistência de fila e REC mode é parte do comportamento de continuidade entre sessões.

### LACUNA
- Política de versionamento/migração de chaves de storage não está centralizada em doc único.

