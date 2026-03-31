# Módulo: Execução Core

## Objetivo

Executar tasks de forma serializada, com guardas, retries e confirmação de resultado.

## Arquivos envolvidos

- [modules/TaskQueue.js](../../modules/TaskQueue.js)
- [modules/GameClient.js](../../modules/GameClient.js)
- [modules/taskTypes.js](../../modules/taskTypes.js)
- [modules/Events.js](../../modules/Events.js)

## Ponto de entrada

- Instanciação no boot em [inject/inject.js](../../inject/inject.js).

## Inputs

- Tasks enfileiradas por módulos de negócio.
- Configuração de modo de operação em [modules/Config.js](../../modules/Config.js).
- Snapshot de estado em [modules/StateManager.js](../../modules/StateManager.js).

## Outputs

- Execução real de request via [modules/GameClient.js](../../modules/GameClient.js).
- Eventos `QUEUE_*` e `HYBRID_*`.
- Histórico e outcomes de execução em memória/persistência.

## Dependências diretas

- [modules/utils.js](../../modules/utils.js)
- [modules/Storage.js](../../modules/Storage.js)

## Efeitos colaterais

- Persistência de fila (`taskQueue`) e histórico (`taskQueueDone`).
- Reagendamento e cancelamento automático por guard/precondição.

## Erros comuns

- Adicionar novo tipo de task sem ajustar dispatch/validação pós-ação.
- Alterar deduplicação sem revisar fase (`TASK_PHASE`) e `reasonCode`.

## Riscos

- Muito alto: regressão aqui interrompe build, transporte, pesquisa e ajustes de vinho.

## Caminhos típicos de alteração

- Novo tipo de task: [modules/taskTypes.js](../../modules/taskTypes.js) -> [modules/TaskQueue.js](../../modules/TaskQueue.js) -> [modules/GameClient.js](../../modules/GameClient.js) -> [docs/contracts/task-contracts.md](../contracts/task-contracts.md).

## O que NÃO pertence a este módulo

- Critérios de decisão estratégica (isso é do Planner e módulos de negócio).

