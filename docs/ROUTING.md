# Routing Operacional por Tipo de Task

Objetivo: abrir só o necessário.

## Regras rápidas

1. Comece por [docs/CHANGE_MAP.md](CHANGE_MAP.md).
2. Leia no máximo 1 arquivo núcleo + 1 teste foco.
3. Só expanda leitura se aparecer dependência explícita.

## Se a task envolve...

### 1) Boot, injeção, perda de interceptação inicial
- Ler: [inject/inject.js](../inject/inject.js), [content/content.js](../content/content.js)
- Validar impacto em: [modules/DataCollector.js](../modules/DataCollector.js), [modules/Events.js](../modules/Events.js)
- Evitar abrir inicialmente: módulos de negócio ([modules/CFO.js](../modules/CFO.js), [modules/COO.js](../modules/COO.js), etc.)

### 2) Parsing de responses / atualização de estado
- Ler: [modules/DataCollector.js](../modules/DataCollector.js), [modules/StateManager.js](../modules/StateManager.js)
- Contratos: [docs/contracts/event-contracts.md](contracts/event-contracts.md), [docs/contracts/resource-payloads.md](contracts/resource-payloads.md)
- Testes foco: [tests/unit/resourcecontracts.test.js](../tests/unit/resourcecontracts.test.js)

### 3) Execução de ação (build, transporte, pesquisa, vinho, cientistas)
- Ler: [modules/TaskQueue.js](../modules/TaskQueue.js), [modules/GameClient.js](../modules/GameClient.js), [modules/taskTypes.js](../modules/taskTypes.js)
- Contratos: [docs/contracts/task-contracts.md](contracts/task-contracts.md)
- Testes foco: [tests/unit/taskqueue_action_outcome.test.js](../tests/unit/taskqueue_action_outcome.test.js), [tests/unit/taskqueue_orchestration.test.js](../tests/unit/taskqueue_orchestration.test.js)

### 4) Ordem de decisão entre módulos (HR/COO/CFO/CTO/CSO/MnA)
- Ler: [modules/Planner.js](../modules/Planner.js)
- Depois abrir apenas o módulo afetado:
  - Sustento: [modules/HR.js](../modules/HR.js)
  - Logística: [modules/COO.js](../modules/COO.js)
  - Build/financeiro: [modules/CFO.js](../modules/CFO.js)
  - Pesquisa: [modules/CTO.js](../modules/CTO.js)
  - Segurança: [modules/CSO.js](../modules/CSO.js)
  - Expansão: [modules/MnA.js](../modules/MnA.js)

### 5) UI, painel, estado projetado para interface
- Ler: [modules/UIBridge.js](../modules/UIBridge.js), [ui/panel.js](../ui/panel.js)
- Contrato: [docs/contracts/uistate-contract.md](contracts/uistate-contract.md)
- Teste foco: [tests/unit/uibridge_hybrid.test.js](../tests/unit/uibridge_hybrid.test.js)

### 6) Configuração, persistência, modo de operação
- Ler: [modules/Config.js](../modules/Config.js), [modules/Storage.js](../modules/Storage.js)
- Ver pontos de consumo em: [modules/TaskQueue.js](../modules/TaskQueue.js), [modules/UIBridge.js](../modules/UIBridge.js)

### 7) Health check operacional
- Ler: [modules/HealthCheckRunner.js](../modules/HealthCheckRunner.js)
- Validar integração em: [modules/UIBridge.js](../modules/UIBridge.js), [ui/panel.js](../ui/panel.js)
- Teste foco: [tests/unit/healthcheckrunner.test.js](../tests/unit/healthcheckrunner.test.js)

## Áreas para NÃO abrir no início (salvo task explícita)

- Dados estáticos: [data/buildings.js](../data/buildings.js), [data/effects.js](../data/effects.js), [data/research.js](../data/research.js)
- Documentação extensa legada: [BUSINESS.md](../BUSINESS.md), [SCRAPER.md](../SCRAPER.md)
- Capturas analíticas: [docs/ikariam-capture](ikariam-capture)

## Sinais de escopo errado

- Alterar [modules/GameClient.js](../modules/GameClient.js) para corrigir apenas render de UI.
- Alterar [modules/CFO.js](../modules/CFO.js) para corrigir parse de `headerData`.
- Alterar [inject/inject.js](../inject/inject.js) para mudar regra de prioridade de task.

