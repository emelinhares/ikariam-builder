# Módulo: UI e Observabilidade

## Objetivo

Projetar estado operacional para painel e registrar trilha de auditoria/health check.

## Arquivos envolvidos

- [modules/UIBridge.js](../../modules/UIBridge.js)
- [ui/panel.js](../../ui/panel.js)
- [ui/panel.html](../../ui/panel.html)
- [modules/Audit.js](../../modules/Audit.js)
- [modules/HealthCheckRunner.js](../../modules/HealthCheckRunner.js)

## Ponto de entrada

- `bridge.init()` no boot em [inject/inject.js](../../inject/inject.js).

## Inputs

- Eventos `STATE_*`, `QUEUE_*`, `AUDIT_*`, `HYBRID_*`, `HEALTHCHECK_UPDATED`.

## Outputs

- Evento `UI_STATE_UPDATED` com payload completo para o painel.
- Alertas internos de UI e comandos `UI_COMMAND` para o core.
- Relatórios de health check exportáveis JSON/MD.

## Dependências diretas

- [modules/Config.js](../../modules/Config.js)
- [modules/StateManager.js](../../modules/StateManager.js)
- [modules/TaskQueue.js](../../modules/TaskQueue.js)

## Efeitos colaterais

- Modo REC força operação MANUAL temporariamente.
- Acúmulo de alertas e telemetria pode influenciar status do bot exibido.

## Erros comuns

- Adicionar campo novo em UIBridge sem adaptar render em [ui/panel.js](../../ui/panel.js).
- Renomear chave de `UIState` e quebrar abas específicas do painel.

## Riscos

- Médio/alto: painel não renderiza corretamente ou dispara comandos errados.

## Caminhos típicos de alteração

- Novo bloco de UI: [modules/UIBridge.js](../../modules/UIBridge.js) + [ui/panel.js](../../ui/panel.js) + [docs/contracts/uistate-contract.md](../contracts/uistate-contract.md).

## O que NÃO pertence a este módulo

- Regras de decisão de negócio e cálculo de prioridade.
- Parse de payload bruto de response.

