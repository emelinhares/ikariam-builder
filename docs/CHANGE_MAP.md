# Change Map — onde alterar e o que validar

## Uso

Para cada alteração:
1. Abrir linha do domínio abaixo.
2. Alterar primeiro arquivo dono.
3. Validar impactos colaterais listados.

## Mapa de alteração

### Interceptação e captura precoce
- Alterar primeiro: [inject/inject.js](../inject/inject.js)
- Dependências de validação:
  - [modules/DataCollector.js](../modules/DataCollector.js)
  - [content/content.js](../content/content.js)
- Risco: perder requests iniciais do jogo se ordem de boot mudar.

### Parse de response / emissão de eventos de coleta
- Alterar primeiro: [modules/DataCollector.js](../modules/DataCollector.js)
- Validar:
  - [modules/StateManager.js](../modules/StateManager.js)
  - [modules/Events.js](../modules/Events.js)
  - [docs/contracts/event-contracts.md](contracts/event-contracts.md)
- Teste foco: [tests/unit/events.test.js](../tests/unit/events.test.js)

### Estado global de cidade e confidência de dados
- Alterar primeiro: [modules/StateManager.js](../modules/StateManager.js)
- Validar:
  - [modules/Planner.js](../modules/Planner.js)
  - [modules/TaskQueue.js](../modules/TaskQueue.js)
  - [modules/UIBridge.js](../modules/UIBridge.js)
- Risco: cascata sistêmica (decisão, execução e UI ao mesmo tempo).

### Contrato de tipos de task / fases
- Alterar primeiro: [modules/taskTypes.js](../modules/taskTypes.js), [modules/TaskQueue.js](../modules/TaskQueue.js)
- Validar:
  - [modules/GameClient.js](../modules/GameClient.js)
  - [modules/UIBridge.js](../modules/UIBridge.js)
  - [tests/unit/taskqueue_orchestration.test.js](../tests/unit/taskqueue_orchestration.test.js)
- Risco: task sem handler, outcome inconsistente, bloqueio silencioso.

### Execução HTTP e confirmação de sucesso
- Alterar primeiro: [modules/GameClient.js](../modules/GameClient.js)
- Validar:
  - [modules/TaskQueue.js](../modules/TaskQueue.js)
  - [modules/StateManager.js](../modules/StateManager.js)
  - [ENDPOINTS.md](../ENDPOINTS.md)
- Testes foco:
  - [tests/unit/taskqueue_action_outcome.test.js](../tests/unit/taskqueue_action_outcome.test.js)
  - [tests/unit/taskqueue_transport_guards.test.js](../tests/unit/taskqueue_transport_guards.test.js)

### Orquestração de ciclo estratégico
- Alterar primeiro: [modules/Planner.js](../modules/Planner.js)
- Validar:
  - [modules/HR.js](../modules/HR.js)
  - [modules/COO.js](../modules/COO.js)
  - [modules/CFO.js](../modules/CFO.js)
  - [modules/CTO.js](../modules/CTO.js)
- Risco: prioridade quebrada (sustento vs build).

### Build e tesouraria
- Alterar primeiro: [modules/CFO.js](../modules/CFO.js)
- Validar:
  - [modules/COO.js](../modules/COO.js) (JIT para build)
  - [modules/TaskQueue.js](../modules/TaskQueue.js)
  - [tests/unit/cfo_scopeA.test.js](../tests/unit/cfo_scopeA.test.js)

### Logística (JIT, overflow, emergência de vinho)
- Alterar primeiro: [modules/COO.js](../modules/COO.js)
- Validar:
  - [modules/StateManager.js](../modules/StateManager.js)
  - [modules/TaskQueue.js](../modules/TaskQueue.js)
  - [tests/unit/coo_logistics_maturity.test.js](../tests/unit/coo_logistics_maturity.test.js)

### Sustento de vinho e workforce
- Alterar primeiro: [modules/HR.js](../modules/HR.js)
- Validar:
  - [modules/COO.js](../modules/COO.js) (wine emergency transport)
  - [modules/Planner.js](../modules/Planner.js)
  - [tests/unit/hr_scopeD_townhall_impact.test.js](../tests/unit/hr_scopeD_townhall_impact.test.js)

### Pesquisa
- Alterar primeiro: [modules/CTO.js](../modules/CTO.js)
- Validar:
  - [modules/GameClient.js](../modules/GameClient.js)
  - [modules/TaskQueue.js](../modules/TaskQueue.js)

### UIState e render do painel
- Alterar primeiro: [modules/UIBridge.js](../modules/UIBridge.js)
- Validar:
  - [ui/panel.js](../ui/panel.js)
  - [docs/contracts/uistate-contract.md](contracts/uistate-contract.md)
  - [tests/unit/uibridge_hybrid.test.js](../tests/unit/uibridge_hybrid.test.js)
- Risco: quebra silenciosa de campos consumidos em render.

### Health check operacional
- Alterar primeiro: [modules/HealthCheckRunner.js](../modules/HealthCheckRunner.js)
- Validar:
  - [modules/UIBridge.js](../modules/UIBridge.js)
  - [ui/panel.js](../ui/panel.js)
  - [tests/unit/healthcheckrunner.test.js](../tests/unit/healthcheckrunner.test.js)

## Áreas sensíveis (não alterar sem motivo direto)

- [inject/inject.js](../inject/inject.js): ordem síncrona de interceptor/boot.
- [modules/TaskQueue.js](../modules/TaskQueue.js): retries/guards/outcome/preempção.
- [modules/GameClient.js](../modules/GameClient.js): contrato de sucesso real com servidor.
- [modules/StateManager.js](../modules/StateManager.js): normalização de estado multi-cidade.
- [modules/UIBridge.js](../modules/UIBridge.js): contrato implícito de UIState.

