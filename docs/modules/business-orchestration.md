# Módulo: Orquestração de Negócio

## Objetivo

Definir ordem de decisão e enfileirar ações por domínio (sustento, logística, build, pesquisa, segurança, expansão).

## Arquivos envolvidos

- [modules/Planner.js](../../modules/Planner.js)
- [modules/HR.js](../../modules/HR.js)
- [modules/COO.js](../../modules/COO.js)
- [modules/CFO.js](../../modules/CFO.js)
- [modules/CTO.js](../../modules/CTO.js)
- [modules/CSO.js](../../modules/CSO.js)
- [modules/MnA.js](../../modules/MnA.js)

## Ponto de entrada

- Evento `STATE_ALL_FRESH` em [modules/Planner.js](../../modules/Planner.js).

## Inputs

- Estado consolidado do [modules/StateManager.js](../../modules/StateManager.js).
- Configuração do [modules/Config.js](../../modules/Config.js).
- Fila ativa de [modules/TaskQueue.js](../../modules/TaskQueue.js).

## Outputs

- Tasks (`BUILD`, `TRANSPORT`, `RESEARCH`, `WINE_ADJUST`, `WORKER_REALLOC`, `NAVIGATE`).
- Eventos de negócio (`HR_WINE_EMERGENCY`, `CFO_BUILD_APPROVED`, etc.).

## Dependências diretas

- [modules/EmpireStage.js](../../modules/EmpireStage.js)
- [modules/GoalEngine.js](../../modules/GoalEngine.js)
- [modules/GrowthPolicy.js](../../modules/GrowthPolicy.js)
- [modules/FleetPolicy.js](../../modules/FleetPolicy.js)
- [modules/WorkforcePolicy.js](../../modules/WorkforcePolicy.js)

## Efeitos colaterais

- Bloqueio de build por emergência de sustento (`buildBlocked`).
- Transporte JIT para build e emergências.

## Erros comuns

- Alterar prioridade no CFO sem revisar bloqueios do Planner.
- Alterar COO sem revisar ledger de commitments e impactos em build waiting_resources.

## Riscos

- Alto: conflito de prioridades entre módulos gera loops ou starvation de task crítica.

## Caminhos típicos de alteração

- Ajustar ordem de fase: [modules/Planner.js](../../modules/Planner.js) + [tests/unit/stage_goal_operational_behavior.test.js](../../tests/unit/stage_goal_operational_behavior.test.js).
- Ajustar logística JIT: [modules/COO.js](../../modules/COO.js) + [modules/CFO.js](../../modules/CFO.js) + [tests/unit/coo_logistics_maturity.test.js](../../tests/unit/coo_logistics_maturity.test.js).

## O que NÃO pertence a este módulo

- Parse de response bruta.
- Execução HTTP de ação.
- Renderização de painel.

