# Estratégia de Testes do ERP de Ikariam (checklist técnico)

## Legenda
- **Tipo**: `OFF` (offline/fixture/mock), `INT` (integração), `GAME` (execução in-game)
- **Prioridade**: **Crítico**, **Alto**, **Médio**
- Formato por item: **O que testar** → **Por que importa** → **Resultado esperado**

---

## 1) Leitura de estado

- **Identificação da cidade ativa** (INT, GAME, **Crítico**)  
  Verificar detecção correta da cidade foco após navegação/UI async → evita ações na cidade errada → cidade ativa no estado interno coincide com UI e contexto de requisição.

- **Leitura multi-cidade** (OFF, INT, GAME, **Crítico**)  
  Validar varredura de todas as cidades sem hardcode → base para planejamento global → snapshot global contém todas as cidades com IDs consistentes.

- **Leitura de recursos atuais** (OFF, INT, GAME, **Crítico**)  
  Garantir parsing de madeira/mármore/cristal/enxofre/vinho (ou equivalentes) → erro aqui quebra CFO/COO → valores numéricos corretos e não negativos.

- **Leitura de produção por hora** (OFF, INT, GAME, **Alto**)  
  Confirmar taxas horárias por recurso/cidade → essencial para previsão e ROI → produção/h bate com fonte do jogo e atualiza após ajustes.

- **Leitura de trabalhadores** (OFF, INT, GAME, **Alto**)  
  Validar trabalhadores por função/edifício → impacto direto em produção/ouro → distribuição lida sem drift e por cidade correta.

- **Leitura de vinho/taberna** (OFF, INT, GAME, **Crítico**)  
  Confirmar nível de serviço de vinho/taberna → previne queda de população/felicidade → estado reflete consumo efetivo e configuração atual.

- **Leitura de felicidade/população** (OFF, INT, GAME, **Crítico**)  
  Medir tendência (subindo/caindo/estável) → governa decisões HR → valores e tendência consistentes entre ciclos.

- **Leitura de ouro e manutenção** (OFF, INT, GAME, **Crítico**)  
  Validar saldo, receita e custo militar/operacional → evita colapso econômico → projeção de ouro pós-ação permanece válida.

- **Leitura de edifícios e níveis** (OFF, INT, GAME, **Crítico**)  
  Confirmar mapa de edifícios existentes + níveis → requisito para dependência de build/upgrade → inventário estrutural correto por cidade.

- **Leitura de filas em andamento** (OFF, INT, GAME, **Crítico**)  
  Detectar build/upgrade já em fila → evita duplicação e ações inválidas → fila interna espelha fila do jogo.

- **Leitura de navios disponíveis** (OFF, INT, GAME, **Crítico**)  
  Capturar quantidade livre/reservada → base de COO e locks → capacidade de transporte real disponível corretamente.

- **Leitura de tropas** (OFF, INT, GAME, **Alto**)  
  Validar tropas locais/em movimento → influencia manutenção e risco → estado militar consistente.

- **Leitura de movimentos em trânsito** (OFF, INT, GAME, **Crítico**)  
  Incluir remessas já enviadas na visão de saldo futuro → evita dupla alocação → “prometido em trânsito” refletido no planejamento.

- **Leitura de capacidade de armazenamento** (OFF, INT, GAME, **Crítico**)  
  Detectar teto e risco de overflow → evita perdas de recurso → capacidade total/ocupação corretas.

- **Leitura de corrupção (quando aplicável)** (OFF, INT, GAME, **Médio**)  
  Corrupção altera eficiência econômica → evita projeções irreais → fator de penalidade aplicado onde existir.

- **Consistência do estado após trocar de cidade** (INT, GAME, **Crítico**)  
  Garantir invalidation/refresh de cache após navegação → impede estado stale cruzado → snapshot pós-troca sem campos herdados indevidamente.

---

## 2) Classificação dinâmica das cidades

- **Inferência do papel econômico pelo recurso da ilha** (OFF, INT, **Crítico**)  
  Papel dinâmico é premissa do ERP genérico → sem isso há decisões erradas por conta → cidade classificada por dados reais, não nome.

- **Produtora vs apenas estoque** (OFF, INT, **Alto**)  
  Diferenciar fluxo de produção de estoque ocasional → melhora escolha de fonte → papel muda conforme produção real e não só saldo.

- **Detecção de overflow** (OFF, INT, GAME, **Crítico**)  
  Identificar cidade perto do limite → previne perda de recurso → flag de overflow acionada no limiar definido.

- **Detecção de déficit** (OFF, INT, GAME, **Crítico**)  
  Identificar necessidade real de suprimento → garante logística eficiente → déficit calculado por demanda planejada + buffers.

- **Cidade com alta demanda de obra** (OFF, INT, **Alto**)  
  Prioriza investimento/redistribuição de workers → melhora throughput produtivo → score de demanda de obra coerente.

- **Cidade com risco de storage** (OFF, INT, GAME, **Crítico**)  
  Dispara ações corretivas antecipadas → evita cap/overflow → cidade classificada como “risco” antes da perda.

- **Recálculo de papéis a cada ciclo** (OFF, INT, GAME, **Crítico**)  
  Estado do jogo muda continuamente → classificação não pode congelar → papéis atualizados por ciclo sem memória indevida.

- **Comportamento genérico sem nomes hardcoded** (OFF, INT, GAME, **Crítico**)  
  Produto deve funcionar em qualquer conta → garante escalabilidade e portabilidade → nenhum branch baseado em nome de cidade.

---

## 3) Planejamento econômico

- **Priorização de builds** (OFF, INT, **Crítico**)  
  Ordenar ações com maior valor econômico → evita desperdício de fila → top ação condiz com política de prioridade.

- **Cálculo de score e ROI** (OFF, INT, **Crítico**)  
  Núcleo de decisão do Planner/CFO → sem isso decisão vira heurística frágil → score reproduzível e sensível a estado real.

- **Skip por recurso insuficiente** (OFF, INT, GAME, **Crítico**)  
  Evita tentativa inválida e spam de erro → robustez operacional → ação bloqueada com motivo rastreável.

- **Skip por fila já ocupada** (OFF, INT, GAME, **Crítico**)  
  Previne conflito com build em andamento → mantém consistência da fila → planner seleciona alternativa válida.

- **Escolha coerente entre múltiplos candidatos** (OFF, INT, **Alto**)  
  Cenários com empate devem ser estáveis → evita oscilação de decisões → tie-break deterministicamente definido.

- **Respeito a dependências de construção** (OFF, INT, GAME, **Crítico**)  
  Regras de pré-requisito são obrigatórias → evita ações impossíveis → build só aprovado com dependências atendidas.

- **Uso de custo real via AJAX/fonte dinâmica** (OFF, INT, GAME, **Alto**)  
  Custos variam por contexto/nível → evita planejamento incorreto → custo usado é o retornado pela fonte ativa.

- **Não aprovar build impossível** (OFF, INT, GAME, **Crítico**)  
  Segurança lógica do planner → evita loops de retry inúteis → impossíveis ficam “reprovados” com causa explícita.

- **Priorização sob cenários de gargalo** (OFF, INT, **Alto**)  
  Recursos críticos limitados exigem foco correto → melhora ROI de curto prazo → plano muda conforme gargalo detectado.

---

## 4) Logística e transporte

- **Escolha da cidade-fonte correta** (OFF, INT, GAME, **Crítico**)
- **Priorizar cidade produtora do recurso** (OFF, INT, GAME, **Alto**)
- **Fonte secundária só quando necessário** (OFF, INT, GAME, **Alto**)
- **Respeito a buffers mínimos da fonte** (OFF, INT, GAME, **Crítico**)
- **Redistribuição de overflow** (OFF, INT, GAME, **Crítico**)
- **Prevenção de envio para cidade sem capacidade** (OFF, INT, GAME, **Crítico**)
- **Envio para cidades com déficit real** (OFF, INT, GAME, **Crítico**)
- **Confirmação de transporte em trânsito** (INT, GAME, **Crítico**)
- **Deduplicação de tasks de transporte** (OFF, INT, **Crítico**)
- **Retry de transporte** (OFF, INT, GAME, **Alto**)
- **Cancelamento de transporte** (INT, GAME, **Médio**)
- **Tratamento de falta de navios** (OFF, INT, GAME, **Crítico**)
- **Recursos prometidos em trânsito** (OFF, INT, GAME, **Crítico**)
- **Conflito entre tarefas usando mesmos navios** (OFF, INT, GAME, **Crítico**)

---

## 5) Produção e sustentação

- **Lógica de consumo de vinho** (OFF, INT, GAME, **Crítico**)
- **Prevenção de queda de felicidade** (OFF, INT, GAME, **Crítico**)
- **Ajuste da taberna** (OFF, INT, GAME, **Alto**)
- **Ajuste de trabalhadores** (OFF, INT, GAME, **Crítico**)
- **Aumentar coleta quando houver espaço** (OFF, INT, GAME, **Alto**)
- **Reduzir trabalhadores quando necessário** (OFF, INT, GAME, **Alto**)
- **Equilíbrio produção vs consumo vs ouro** (OFF, INT, GAME, **Crítico**)
- **Reação a crescimento/queda populacional** (OFF, INT, GAME, **Alto**)

---

## 6) Overflow e segurança

- **Detecção de capital em risco** (OFF, INT, GAME, **Crítico**)
- **Ação corretiva ao detectar overflow** (OFF, INT, GAME, **Crítico**)
- **Redistribuição automática de excedente** (OFF, INT, GAME, **Crítico**)
- **Aumento de storage quando necessário** (OFF, INT, GAME, **Alto**)
- **Preservação de buffer contra saque** (OFF, INT, GAME, **Alto**)
- **Priorização de saída de recursos em risco** (OFF, INT, GAME, **Crítico**)

---

## 7) Doação da ilha

- **Detecção de oportunidade de doação** (OFF, INT, GAME, **Médio**)
- **Doação para serraria** (OFF, INT, GAME, **Médio**)
- **Doação para mina premium** (OFF, INT, GAME, **Médio**)
- **Respeito a buffers antes de doar** (OFF, INT, GAME, **Alto**)
- **Não doar com gargalo urgente** (OFF, INT, GAME, **Alto**)
- **Priorizar produtora investindo na própria ilha** (OFF, INT, GAME, **Médio**)
- **Validação da doação refletida no jogo** (INT, GAME, **Alto**)

---

## 8) Navegação e execução

- **Troca de cidade** (INT, GAME, **Crítico**)
- **Abertura da tela correta antes da ação** (INT, GAME, **Crítico**)
- **Execução de build** (INT, GAME, **Crítico**)
- **Confirmação de build na fila** (INT, GAME, **Crítico**)
- **Cancelamento de build** (INT, GAME, **Médio**)
- **Execução de upgrade** (INT, GAME, **Crítico**)
- **Alteração de trabalhadores** (INT, GAME, **Alto**)
- **Alteração de vinho** (INT, GAME, **Alto**)
- **Tratamento de token actionRequest** (INT, GAME, **Crítico**)
- **Tratamento do contexto de tela exigido** (INT, GAME, **Crítico**)
- **Consistência entre resposta do servidor e UI** (INT, GAME, **Crítico**)

---

## 9) Robustez e recuperação

- **Retry após falha transitória** (OFF, INT, GAME, **Crítico**)
- **Tratamento de timeout** (OFF, INT, GAME, **Crítico**)
- **Tratamento de lag do servidor** (INT, GAME, **Alto**)
- **Cidade errada após navegação** (INT, GAME, **Crítico**)
- **Sucesso na resposta sem efeito na UI** (INT, GAME, **Crítico**)
- **Tratamento de estado stale** (OFF, INT, GAME, **Crítico**)
- **Limpeza de task após falha** (OFF, INT, GAME, **Alto**)
- **Prevenção de loop infinito** (OFF, INT, GAME, **Crítico**)
- **Prevenção de spam de ações duplicadas** (OFF, INT, GAME, **Crítico**)
- **Mudança de seletor de UI** (OFF, INT, GAME, **Alto**)
- **Endpoint parcialmente respondido** (OFF, INT, GAME, **Alto**)

---

## 10) Fila e orquestração

- **Adição de tasks** (OFF, INT, **Crítico**)
- **Ordenação por prioridade** (OFF, INT, **Crítico**)
- **Deduplicação** (OFF, INT, **Crítico**)
- **Retries** (OFF, INT, **Alto**)
- **Backoff** (OFF, INT, **Alto**)
- **Desbloqueio após erro** (OFF, INT, **Crítico**)
- **Consumo correto da fila** (OFF, INT, **Crítico**)
- **Bloqueio de ações concorrentes incompatíveis** (OFF, INT, GAME, **Crítico**)
- **Replanejamento após mudança de estado** (OFF, INT, GAME, **Crítico**)
- **Wake-up adaptativo** (OFF, INT, **Médio**)

---

## 11) Checker pós-ação

- **Build entrou na fila** (INT, GAME, **Crítico**)
- **Transporte entrou em trânsito** (INT, GAME, **Crítico**)
- **Worker mudou** (INT, GAME, **Alto**)
- **Taberna mudou** (INT, GAME, **Alto**)
- **Doação aplicada** (INT, GAME, **Médio**)
- **Estado atualizado após ação** (INT, GAME, **Crítico**)
- **Classificação de resultado: sucesso/falha/inconclusivo** (OFF, INT, GAME, **Crítico**)

---

## 12) Testes offline com fixtures

- **Snapshots de império saudável** (OFF, **Crítico**)
- **Snapshots com overflow** (OFF, **Crítico**)
- **Snapshots com falta de vinho** (OFF, **Crítico**)
- **Snapshots com cidades deficitárias** (OFF, **Crítico**)
- **Snapshots com navios indisponíveis** (OFF, **Crítico**)
- **Snapshots com build em fila** (OFF, **Crítico**)
- **Snapshots com múltiplos candidatos de origem** (OFF, **Alto**)
- **Snapshots com erro de classificação de cidade** (OFF, **Alto**)
- **Mocks de respostas AJAX** (OFF, **Crítico**)
- **Mocks de respostas de erro** (OFF, **Crítico**)
- **Testes determinísticos de planner e COO** (OFF, **Crítico**)

---

## 13) Testes integrados em sessão real

- **Smoke de leitura** (GAME, **Crítico**)
- **Smoke de build** (GAME, **Crítico**)
- **Smoke de transporte** (GAME, **Crítico**)
- **Smoke de taberna** (GAME, **Alto**)
- **Smoke de workers** (GAME, **Alto**)
- **Smoke de doação** (GAME, **Médio**)
- **Validação de logs** (INT, GAME, **Alto**)
- **Recuperação após falha real** (GAME, **Crítico**)

---

# Matriz de separação por tipo

## Offline (prioridade de implementação)
- Parsing de estado, classificação dinâmica, planner ROI/score, guards de logística, dedup/retry/backoff, checker de classificação de resultado, cenários por fixtures/mocks, determinismo.

## Integração
- Encadeamento State→Planner→TaskQueue→Executor→Checker, locks de concorrência, reconciliação de estado pós-ação, coerência servidor/UI, política de erro e limpeza de task.

## Execução in-game
- Smokes operacionais, validação de token/contexto de tela, navegação real entre cidades, confirmação de efeitos no jogo, recuperação após falha/lag real.

---

# Priorização global (resumo)

## Crítico
- Leitura correta e consistente de estado multi-cidade.
- Classificação dinâmica sem hardcode.
- Planejamento econômico seguro (não tentar impossível).
- Logística com buffers/navios/conflitos e dedup.
- Navegação/contexto/token + checker pós-ação.
- Robustez: timeout, stale, loop, spam, cleanup.
- Fila/orquestração: prioridade, locks, replanejamento.

## Alto
- Otimizações de produção (workers/taberna), tie-breaks, custos dinâmicos, observabilidade/logs, fallback de seletor.

## Médio
- Doação (exceto regras de segurança), wake-up adaptativo, cancelamentos específicos.

---

# Ordem recomendada de implementação dos testes

1. **Base offline de estado e contratos** (fixtures + parser + validação schema).
2. **Classificação dinâmica das cidades** (papéis, overflow/déficit/storage risk, recálculo por ciclo).
3. **Planner econômico** (score/ROI, dependências, impossíveis, gargalos).
4. **COO/logística offline** (escolha de fonte, buffers, navios, in-transit, dedup).
5. **TaskQueue e orquestração** (prioridade, lock, retry/backoff, cleanup, anti-loop).
6. **Checker pós-ação** (sucesso/falha/inconclusivo com reconciliação).
7. **Integrações internas** (State→Planner→Queue→Executor→Checker).
8. **Fluxos críticos in-game (smoke)**: leitura, build, transporte.
9. **Fluxos de sustentação in-game**: workers, taberna, vinho, ouro.
10. **Fluxos de overflow/segurança e doação in-game**.
11. **Testes de robustez real**: lag, timeout, resposta parcial, divergência UI/servidor.
12. **Hardening final**: regressão completa + métricas de flakiness + suite contínua.

---

Checklist cobre arquitetura, estado, decisão e execução real sem dependência de nomes fixos de cidades e sem regras específicas de conta.

---

## Status de implementação (unitários)

Implementado nesta rodada (OFF/unit):

- [x] Leitura de vinho/taberna + fallback de consumo no contexto do planner (Seção 1, crítico)
- [x] Classificação de emergência por vinho/satisfação e bloqueio de build (Seções 1 e 2, crítico)
- [x] Ordem do ciclo de decisão HR→COO→CFO→CTO→CSO→MnA e resumo final (Seção 3, crítico)
- [x] Deduplicação de tasks por `type+cityId+phase` com coexistência entre fases (Seção 10, crítico)
- [x] Ordenação da fila por fase→prioridade→agendamento (Seção 10, crítico)
- [x] Preempção de task menos urgente quando existe fase mais urgente pronta (Seção 10, crítico)

Arquivos de teste criados:

- [`tests/unit/planner.test.js`](tests/unit/planner.test.js)
- [`tests/unit/taskqueue_orchestration.test.js`](tests/unit/taskqueue_orchestration.test.js)
