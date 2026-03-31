# Módulo: Coleta e Estado

## Objetivo

Capturar respostas do jogo, extrair sinais relevantes e manter estado operacional único.

## Arquivos envolvidos

- [inject/inject.js](../../inject/inject.js)
- [modules/DataCollector.js](../../modules/DataCollector.js)
- [modules/StateManager.js](../../modules/StateManager.js)
- [modules/resourceContracts.js](../../modules/resourceContracts.js)
- [modules/Events.js](../../modules/Events.js)

## Ponto de entrada

- Boot em [inject/inject.js](../../inject/inject.js), função `boot()`.

## Inputs

- XHR/fetch interceptado no page context.
- Modelo global do jogo (`ikariam.model`) observado por [modules/DataCollector.js](../../modules/DataCollector.js).
- Eventos de execução (`QUEUE_TASK_STARTED`, `QUEUE_TASK_DONE`) para inferências de estado em [modules/StateManager.js](../../modules/StateManager.js).

## Outputs

- Eventos de coleta (`DC_*`) em [modules/Events.js](../../modules/Events.js).
- Estado normalizado de cidades, pesquisa e movimentos de frota em [modules/StateManager.js](../../modules/StateManager.js).

## Dependências diretas

- [modules/utils.js](../../modules/utils.js)
- [data/wine.js](../../data/wine.js)

## Efeitos colaterais

- Atualiza cidade ativa e confiança de dados.
- Persistência de mapa cidade↔ilha.

## Erros comuns

- Alterar parse de `headerData` sem validar impacto em `wineSpendings` e `maxResources`.
- Atualizar `activeCityId` durante probing e quebrar sincronismo de sessão.

## Riscos

- Alto: qualquer mudança aqui impacta Planner, Queue, UI.

## Caminhos típicos de alteração

- Novo campo de recurso: ajustar [modules/DataCollector.js](../../modules/DataCollector.js) + [modules/StateManager.js](../../modules/StateManager.js) + [docs/contracts/resource-payloads.md](../contracts/resource-payloads.md).
- Novo evento de coleta: ajustar [modules/Events.js](../../modules/Events.js) + [docs/contracts/event-contracts.md](../contracts/event-contracts.md).

## O que NÃO pertence a este módulo

- Regra de priorização de build/transporte/pesquisa.
- Render de UI.

