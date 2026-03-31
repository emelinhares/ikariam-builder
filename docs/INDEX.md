# Índice Operacional para Agentes

Objetivo: reduzir leitura global e direcionar alteração para o módulo correto.

## 1) Porta de entrada mínima

1. [AGENTS.md](../AGENTS.md)
2. [docs/ROUTING.md](ROUTING.md)
3. [docs/CHANGE_MAP.md](CHANGE_MAP.md)

## 2) Mapa mestre por camada

### Entrada de sinais
- [content/content.js](../content/content.js)
- [inject/inject.js](../inject/inject.js)
- [modules/Events.js](../modules/Events.js)

### Parsing e coleta
- [modules/DataCollector.js](../modules/DataCollector.js)
- [docs/contracts/event-contracts.md](contracts/event-contracts.md)

### Estado e normalização
- [modules/StateManager.js](../modules/StateManager.js)
- [modules/resourceContracts.js](../modules/resourceContracts.js)
- [docs/contracts/resource-payloads.md](contracts/resource-payloads.md)

### Execução e validação de ação
- [modules/TaskQueue.js](../modules/TaskQueue.js)
- [modules/GameClient.js](../modules/GameClient.js)
- [modules/taskTypes.js](../modules/taskTypes.js)
- [docs/contracts/task-contracts.md](contracts/task-contracts.md)

### Orquestração de decisão
- [modules/Planner.js](../modules/Planner.js)
- [modules/CFO.js](../modules/CFO.js)
- [modules/COO.js](../modules/COO.js)
- [modules/HR.js](../modules/HR.js)
- [modules/CTO.js](../modules/CTO.js)
- [modules/CSO.js](../modules/CSO.js)
- [modules/MnA.js](../modules/MnA.js)

### UI e observabilidade
- [modules/UIBridge.js](../modules/UIBridge.js)
- [ui/panel.js](../ui/panel.js)
- [modules/Audit.js](../modules/Audit.js)
- [modules/HealthCheckRunner.js](../modules/HealthCheckRunner.js)
- [docs/contracts/uistate-contract.md](contracts/uistate-contract.md)

## 3) Arquivos críticos (alto risco de regressão)

- [inject/inject.js](../inject/inject.js): ordem de boot e interceptor síncrono.
- [modules/TaskQueue.js](../modules/TaskQueue.js): retries, guards, outcome, persistência, fases.
- [modules/GameClient.js](../modules/GameClient.js): contrato HTTP real, confirmação de sucesso.
- [modules/StateManager.js](../modules/StateManager.js): fonte única de estado e fetchAllCities.
- [modules/Planner.js](../modules/Planner.js): ordem de fases e wake-ups reativos.
- [modules/UIBridge.js](../modules/UIBridge.js): shape de UIState consumido pela UI.

## 4) Documentos desta camada de fitting

- Arquitetura operacional: [docs/ARCHITECTURE.md](ARCHITECTURE.md)
- Roteamento por task: [docs/ROUTING.md](ROUTING.md)
- Mapa de alteração/impacto: [docs/CHANGE_MAP.md](CHANGE_MAP.md)
- Regras validadas e lacunas: [docs/VALIDATED_RULES.md](VALIDATED_RULES.md)
- Manifestos por domínio: [docs/modules](modules)
- Contratos de dados: [docs/contracts](contracts)
- ADRs curtas: [docs/adr](adr)

## 5) Documentos legados úteis (não substituir por este índice)

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [BUSINESS.md](../BUSINESS.md)
- [ENDPOINTS.md](../ENDPOINTS.md)
- [GAME_MODEL.md](../GAME_MODEL.md)
- [UI.md](../UI.md)
- Capturas/derivações: [docs/ikariam-capture/derived](ikariam-capture/derived)

