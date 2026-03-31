# Ikariam Builder — ERP Analítico

Chrome Extension (MV3) + scraper Playwright para coleta e análise de dados do Ikariam.

---

## Documentação

| Arquivo | O que contém |
|---|---|
| [AGENTS.md](AGENTS.md) | Índice único para agentes de IA (entrypoint de contexto rápido) |
| [BUSINESS.md](BUSINESS.md) | Módulos de negócio, métricas, glossário, o que o ERP calcula |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Módulos técnicos, fluxo de dados, regras de implementação |
| [SCRAPER.md](SCRAPER.md) | Views, seletores confirmados, parsing, status de cobertura |
| [ENDPOINTS.md](ENDPOINTS.md) | Endpoints HTTP do jogo, actions, POST/GET, parâmetros |
| [GAME_MODEL.md](GAME_MODEL.md) | Estrutura do objeto JS do jogo (`ikariam.*`, `bgViewData`) |
| [UI.md](UI.md) | Spec de painéis, componentes, contratos de dados UI |

---

## Contratos Canônicos e Aderência (Doc ↔ Código)

Referência de projeto e plano de melhoria:
- [plans/DOC_AUDIT_AND_FEATURE_PROJECT.md](plans/DOC_AUDIT_AND_FEATURE_PROJECT.md)

Matriz de aderência atual:

| Contrato crítico | Fonte canônica | Implementação principal | Status |
|---|---|---|---|
| Orquestração de decisão por fases (HR → COO → CFO → CTO → CSO/MnA) | [ARCHITECTURE.md](ARCHITECTURE.md) | [modules/Planner.js](modules/Planner.js) | ✅ Aderente |
| Lifecycle e prioridade de task (phase, preempção, guard policy) | [ARCHITECTURE.md](ARCHITECTURE.md) | [modules/TaskQueue.js](modules/TaskQueue.js) | ✅ Aderente |
| Contrato HTTP e parsing de resposta do jogo | [ENDPOINTS.md](ENDPOINTS.md) | [modules/GameClient.js](modules/GameClient.js) | ⚠ Revisar sempre em pares (endpoint + fluxo real) |
| Fonte única de estado e probing de cidades | [ARCHITECTURE.md](ARCHITECTURE.md) | [modules/StateManager.js](modules/StateManager.js) | ✅ Aderente |
| Contrato de UIState para painel | [UI.md](UI.md) | [modules/UIBridge.js](modules/UIBridge.js) | ✅ Aderente |

Regra operacional: em caso de divergência entre documento e implementação, priorizar o comportamento real dos módulos críticos e atualizar a documentação no mesmo ciclo de mudança.

---

## Padrão obrigatório de Patch Notes no README

A partir deste ponto, toda atualização grande deve registrar patch notes neste arquivo, no mínimo com:

1. Resumo executivo da versão (impacto funcional e técnico)
2. Novas features
3. Bugfixes
4. Melhorias técnicas internas (refactor/hardening/performance)
5. Documentação atualizada
6. Testes adicionados/ajustados
7. Riscos conhecidos / limitações
8. Arquivos críticos impactados

Formato recomendado por release:

### Versão X.Y.Z — AAAA-MM-DD
- **Resumo**
- **Novas features**
- **Bugfixes**
- **Melhorias técnicas**
- **Documentação**
- **Testes**
- **Riscos conhecidos**
- **Arquivos críticos impactados**

---

## Patch Notes

### Versão 5.1.0 — 2026-03-30

**Resumo**
- Release de evolução funcional focada em governança de decisão entre módulos de negócio (Planner/CFO/COO/CTO/CSO/MnA), endurecimento da orquestração em fila e consolidação de contratos documentais para reduzir divergência entre comportamento real e documentação técnica.

**Novas features**
- Expansão da lógica de governança e priorização no ciclo de decisão multi-módulo com reforço de critérios de ação por contexto operacional: [modules/Planner.js](modules/Planner.js), [modules/CFO.js](modules/CFO.js), [modules/COO.js](modules/COO.js), [modules/CTO.js](modules/CTO.js), [modules/CSO.js](modules/CSO.js), [modules/MnA.js](modules/MnA.js).
- Atualização da estratégia híbrida endpoint/dom com impactos explícitos de execução e roteamento de decisão: [plans/HYBRID_ENDPOINT_DOM_STRATEGY.md](plans/HYBRID_ENDPOINT_DOM_STRATEGY.md), [modules/TaskQueue.js](modules/TaskQueue.js).

**Bugfixes**
- Correções de fluxo e orquestração na fila para reduzir inconsistências de execução em cenários compostos de decisão e despacho de tasks: [modules/TaskQueue.js](modules/TaskQueue.js), [tests/unit/taskqueue_orchestration.test.js](tests/unit/taskqueue_orchestration.test.js).
- Ajustes de comportamento em decisões econômicas e de planejamento para cenários de borda e conflitos de prioridade: [modules/CFO.js](modules/CFO.js), [tests/unit/cfo_scopeA.test.js](tests/unit/cfo_scopeA.test.js), [tests/unit/planner.test.js](tests/unit/planner.test.js).

**Melhorias técnicas**
- Hardening dos módulos de negócio com contratos mais explícitos para governança e menor acoplamento implícito entre decisões de curto e médio prazo: [modules/CFO.js](modules/CFO.js), [modules/CTO.js](modules/CTO.js), [modules/MnA.js](modules/MnA.js), [modules/COO.js](modules/COO.js), [modules/CSO.js](modules/CSO.js).

**Documentação**
- Atualização dos contratos de endpoints e modelo de jogo para manter aderência ao comportamento efetivo da automação: [ENDPOINTS.md](ENDPOINTS.md), [GAME_MODEL.md](GAME_MODEL.md), [plans/HYBRID_ENDPOINT_DOM_STRATEGY.md](plans/HYBRID_ENDPOINT_DOM_STRATEGY.md).

**Testes**
- Ampliação da cobertura unitária em governança, orquestração e critérios de decisão de negócio: [tests/unit/taskqueue_orchestration.test.js](tests/unit/taskqueue_orchestration.test.js), [tests/unit/cfo_scopeA.test.js](tests/unit/cfo_scopeA.test.js), [tests/unit/planner.test.js](tests/unit/planner.test.js), [tests/unit/governance_gaps.test.js](tests/unit/governance_gaps.test.js).

**Riscos conhecidos**
- A estratégia híbrida endpoint/dom segue dependente da estabilidade de contratos do jogo e pode exigir ajustes rápidos em mudanças de payload/markup em produção: [ENDPOINTS.md](ENDPOINTS.md), [GAME_MODEL.md](GAME_MODEL.md), [plans/HYBRID_ENDPOINT_DOM_STRATEGY.md](plans/HYBRID_ENDPOINT_DOM_STRATEGY.md).

**Arquivos críticos impactados**
- Orquestração e decisão: [modules/TaskQueue.js](modules/TaskQueue.js), [modules/Planner.js](modules/Planner.js), [modules/CFO.js](modules/CFO.js), [modules/COO.js](modules/COO.js), [modules/CTO.js](modules/CTO.js), [modules/CSO.js](modules/CSO.js), [modules/MnA.js](modules/MnA.js).
- Contratos/documentação: [ENDPOINTS.md](ENDPOINTS.md), [GAME_MODEL.md](GAME_MODEL.md), [plans/HYBRID_ENDPOINT_DOM_STRATEGY.md](plans/HYBRID_ENDPOINT_DOM_STRATEGY.md), [README.md](README.md).
- Testes: [tests/unit/taskqueue_orchestration.test.js](tests/unit/taskqueue_orchestration.test.js), [tests/unit/cfo_scopeA.test.js](tests/unit/cfo_scopeA.test.js), [tests/unit/planner.test.js](tests/unit/planner.test.js), [tests/unit/governance_gaps.test.js](tests/unit/governance_gaps.test.js).

---

### Versão 5.0.0 — 2026-03-30

**Resumo**
- Atualização grande com foco em robustez operacional, orquestração por fases, observabilidade em tempo real e consolidação de contratos entre execução, UI e documentação.

**Novas features**
- Runner de health check operacional com suíte de cenários, cooldown, exportação de relatório e histórico em estado: [modules/HealthCheckRunner.js](modules/HealthCheckRunner.js), [tests/unit/healthcheckrunner.test.js](tests/unit/healthcheckrunner.test.js).
- Estrutura híbrida para decisão de caminho de execução (endpoint/dom) refletida no estado de UI e integração de painel: [modules/GameClient.js](modules/GameClient.js), [modules/TaskQueue.js](modules/TaskQueue.js), [modules/DataCollector.js](modules/DataCollector.js), [modules/Events.js](modules/Events.js), [modules/UIBridge.js](modules/UIBridge.js), [ui/panel.js](ui/panel.js), [ui/panel.html](ui/panel.html), [ui/panel.css](ui/panel.css), [plans/HYBRID_ENDPOINT_DOM_STRATEGY.md](plans/HYBRID_ENDPOINT_DOM_STRATEGY.md).
- Reforço de orquestração econômica por escopo e cenários multi-cidade no núcleo de decisão: [modules/CFO.js](modules/CFO.js), [modules/COO.js](modules/COO.js), [modules/HR.js](modules/HR.js), [tests/unit/cfo_scopeA.test.js](tests/unit/cfo_scopeA.test.js), [tests/unit/coo_scopeD.test.js](tests/unit/coo_scopeD.test.js), [tests/unit/hr_scopeD_townhall_impact.test.js](tests/unit/hr_scopeD_townhall_impact.test.js), [tests/unit/identity_mapper_scoped.test.js](tests/unit/identity_mapper_scoped.test.js), [tests/unit/planner.test.js](tests/unit/planner.test.js).

**Bugfixes**
- Correções na política de guard/retry e proteção contra duplicidade/loop de execução na fila: [modules/TaskQueue.js](modules/TaskQueue.js), [tests/unit/taskqueue_guard_attempt_policy.test.js](tests/unit/taskqueue_guard_attempt_policy.test.js), [tests/unit/taskqueue_orchestration.test.js](tests/unit/taskqueue_orchestration.test.js), [tests/unit/taskqueue_transport_guards.test.js](tests/unit/taskqueue_transport_guards.test.js).
- Ajustes de consistência de estado e sincronização de contexto da cidade ativa para reduzir dessíncrono de sessão: [modules/StateManager.js](modules/StateManager.js), [inject/inject.js](inject/inject.js), [modules/DataCollector.js](modules/DataCollector.js).
- Correções de projeção de estado para interface e tratamento de contratos híbridos no painel: [modules/UIBridge.js](modules/UIBridge.js), [tests/unit/uibridge_hybrid.test.js](tests/unit/uibridge_hybrid.test.js), [ui/panel.js](ui/panel.js), [ui/panel.html](ui/panel.html), [ui/panel.css](ui/panel.css).

**Melhorias técnicas**
- Telemetria e trilha de auditoria ampliadas para diagnóstico de runtime e acompanhamento de eventos críticos: [modules/Audit.js](modules/Audit.js), [tests/unit/audit.test.js](tests/unit/audit.test.js).
- Endurecimento de cliente de jogo e contratos de execução para reduzir ambiguidade entre regras documentadas e fluxo real: [modules/GameClient.js](modules/GameClient.js), [modules/TaskQueue.js](modules/TaskQueue.js).

**Documentação**
- Contratos canônicos e regra operacional de aderência doc ↔ código adicionados/reforçados em: [README.md](README.md), [ARCHITECTURE.md](ARCHITECTURE.md), [ENDPOINTS.md](ENDPOINTS.md).
- Plano formal de auditoria documental e roadmap técnico: [plans/DOC_AUDIT_AND_FEATURE_PROJECT.md](plans/DOC_AUDIT_AND_FEATURE_PROJECT.md).
- Estratégia de execução híbrida e impacto por módulo: [plans/HYBRID_ENDPOINT_DOM_STRATEGY.md](plans/HYBRID_ENDPOINT_DOM_STRATEGY.md).

**Testes**
- Ampliação relevante da cobertura para fila, observabilidade, integração híbrida, escopos de negócio e health check: [tests/unit](tests/unit), [tests/ERP_TEST_STRATEGY.md](tests/ERP_TEST_STRATEGY.md).

**Riscos conhecidos**
- Em execução real recente do health check, houve timeout em cenários de transporte/build, exigindo monitoramento contínuo em ambiente de jogo: [erp-healthcheck-full-20260330-163414.md](erp-healthcheck-full-20260330-163414.md), [erp-healthcheck-full-20260330-163414.json](erp-healthcheck-full-20260330-163414.json).

**Arquivos críticos impactados**
- Execução e estado: [modules/GameClient.js](modules/GameClient.js), [modules/TaskQueue.js](modules/TaskQueue.js), [modules/StateManager.js](modules/StateManager.js), [modules/DataCollector.js](modules/DataCollector.js), [inject/inject.js](inject/inject.js).
- Negócio: [modules/CFO.js](modules/CFO.js), [modules/COO.js](modules/COO.js), [modules/HR.js](modules/HR.js).
- Observabilidade/UI: [modules/Audit.js](modules/Audit.js), [modules/UIBridge.js](modules/UIBridge.js), [ui/panel.js](ui/panel.js), [ui/panel.html](ui/panel.html), [ui/panel.css](ui/panel.css).
- Documentação de referência: [ARCHITECTURE.md](ARCHITECTURE.md), [ENDPOINTS.md](ENDPOINTS.md), [README.md](README.md), [plans/DOC_AUDIT_AND_FEATURE_PROJECT.md](plans/DOC_AUDIT_AND_FEATURE_PROJECT.md), [plans/HYBRID_ENDPOINT_DOM_STRATEGY.md](plans/HYBRID_ENDPOINT_DOM_STRATEGY.md).

---

## Como rodar o scraper

```bash
node scraper_explore.mjs
```

Requer sessão ativa no browser profile (`./browser_profile`).
Se expirada, o browser abre o lobby para login manual.

Saída:
- `scraper_report.json` — dados coletados de todas as cidades
- `scraper_dumps/*.html` — HTML bruto de cada view para auditoria
