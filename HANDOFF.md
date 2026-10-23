# Handoff — diagnóstico ao vivo do ikariam-builder

> Cole o bloco abaixo no Codex. Ele é autossuficiente: não depende desta conversa.

---

## Contexto

Você vai continuar o trabalho num projeto chamado **ikariam-builder**: uma extensão Chrome MV3 (~25.000 linhas, 42 módulos, 238 testes) que automatiza o jogo de navegador Ikariam. A arquitetura modela o império como uma empresa: módulos C-level (`CFO` decide o que construir, `COO` faz logística de transporte, `HR` cuida de vinho e população, `CTO` de pesquisa, `CSO` de segurança e ruído, `MnA` de colonização), orquestrados pelo `Planner` em cinco fases. O `TaskQueue` executa uma task por vez com guards e pós-validação, e o `GameClient` é o único ponto de saída HTTP.

Repositório: `https://github.com/emelinhares/ikariam-builder`
Pasta local: `C:\Users\emers\OneDrive\Documentos\Projetos\ikariam-builder`
Branch: `chore/higiene-e-instrumentacao`

Leia `AGENTS.md` primeiro — é o entrypoint de contexto do projeto e roteia para a documentação certa por tipo de tarefa.

## O que já foi feito (não refaça)

O projeto estava parado desde abril de 2026. Duas fases foram concluídas:

**Fase 1 — higiene.** `node_modules` (3.376 arquivos), gravações de sessão (`rec*.txt`), `analise.json` e capturas brutas em `docs/ikariam-capture/` saíram do versionamento, e o histórico foi reescrito com `git filter-branch` para remover os blobs do passado — inclusive dois tokens de sessão que estavam expostos num repositório público. O repo caiu de 14,25 MiB para 588 KiB. Também foram removidas ~1.900 linhas de código morto: `Builder.js` não era importado por ninguém e era o único caminho até `Goals.js`, `Port.js`, `Patrol.js`, `WineBalance.js` e `ResourceBalance.js` — a arquitetura da geração anterior, que convivia desligada com a atual.

**Fase 2 — instrumentação.** O objetivo era tornar legível uma falha que o relatório antigo registrava apenas como "timeout", sem causa.

## O problema a resolver

O último relatório de health check guardado no repo (março de 2026) mostrava 5 de 7 cenários passando. Os dois que falharam são os que dão valor ao sistema: `transport_dispatch` e `build_upgrade`, ambos em timeout de 120s. Esse relatório **não serve como diagnóstico** — ele rodou antes do commit que adicionou os campos de diagnóstico, e vieram quatro commits depois dele.

Na investigação apareceram três coisas, todas já corrigidas na Fase 2:

1. **O watchdog do cenário e a espera interna da task usavam o mesmo valor (120s).** Corriam juntos, e quando a exceção externa vencia a corrida, toda a evidência coletada pela espera interna era descartada. Agora o externo é sempre o interno + 20s de margem.

2. **O orçamento de 120s era otimista.** O caminho real de confirmação (navigate → ação → probe de estado) é serializado atrás do `_sessionLock` do `GameClient` e disputa espaço com o heartbeat de `fetchAllCities` a cada 60s. TRANSPORT e BUILD passaram para 240s. "Timeout" não provava falha.

3. **O watchdog do `TaskQueue` não tinha teto.** Resetava `_executing` após 60s e devolvia a task para `pending` indefinidamente: um `_execute` travado era redespachado para sempre, `QUEUE_TASK_STARTED` disparava a cada volta e `QUEUE_TASK_DONE` nunca vinha. É exatamente o padrão do `build_upgrade`. Agora tem contador e teto de 3 resets, com `reasonCode` `WATCHDOG_EXHAUSTED`.

O relatório agora distingue dois desfechos que antes viravam o mesmo "timeout":

- **`NEVER_DISPATCHED`** — a fila nunca elegeu a task. Investigue starvation de fase: `TaskQueue._tick` ordena por `phase → priority → scheduledFor` e despacha uma por vez, então uma task de `LOGISTICA` (fase 2) pode ser preterida indefinidamente por tasks de `SUSTENTO` (fase 1) que se reagendam. Há log de starvation registrando quem passou na frente, e a evidência `skippedTicks` no relatório.
- **`NO_CONFIRMATION`** — executou e a pós-validação não confirmou. Investigue `_validateBuildOutcome` e `_validateTransportOutcome` em `modules/TaskQueue.js`, ou mudança de contrato do jogo.

## Sua tarefa: Fase 3 — diagnóstico ao vivo

O usuário tem conta ativa. O estado quando a sessão anterior parou:

- Navegador: **Brave** (funciona, apesar de o suporte oficial do Claude in Chrome ser só Chrome)
- Conta: **xEmEx**, mundo **Cyclops**, servidor **`s76-br.ikariam.gameforge.com`**, **5 cidades**
- A extensão do ERP **ainda não foi carregada** no Brave

Passos:

1. **O usuário precisa carregar a extensão** em `brave://extensions` → Modo do desenvolvedor → Carregar sem compactação → apontar para a pasta do projeto. Você não consegue fazer isso: navegadores bloqueiam extensões de automatizarem páginas `brave://` e `chrome://`.

2. **Confirme o boot.** Na aba do jogo, verifique no contexto da página:
   - `window.__erpLog` e `window.__erpInterceptCallback` — definidos de forma síncrona pelo `inject.js` antes de qualquer import. Se não existirem, a extensão não carregou (não é falha de boot).
   - `window.__ERP_BOOT_STAGE` deve chegar em `'done'`
   - `window.__ERP_BOOT_ERROR` deve ser `undefined`
   - `window.__ERP` expõe tudo: `state`, `queue`, `healthCheck`, `client`, `config`

3. **Confirme que o modo é `MANUAL`.** É o padrão de fábrica agora (`modules/Config.js`), mas configuração salva no storage prevalece sobre o padrão. O seletor `erp-mode-select` no painel troca em runtime.

4. **Rode a suíte `full`.** Pelo botão do painel (`erp-health-start-btn`, com `erp-health-suite` em `full`) ou por `window.__ERP.healthCheck.start({ suite: 'full' })`. O relatório `.json` e `.md` é exportado automaticamente para a pasta de Downloads no fim da execução.

> **A suíte executa ações reais no jogo do usuário.** Manda 500 de enxofre entre cidades, inicia um upgrade de verdade, doa 500 de recurso para a ilha e altera vinho e trabalhadores. Não é simulação. Confirme com o usuário a cidade antes de disparar. A suíte `critical` é menor (4 cenários) mas igualmente real.

5. **Leia o relatório** e classifique cada falha pelo `reasonCode`. A coluna `Reason` existe no markdown agora.

## Fase 4 — correção, guiada pela evidência

Só depois do relatório. Hipóteses mapeadas, em ordem de probabilidade:

| Hipótese | Onde olhar | Correção provável |
|---|---|---|
| Starvation de fase | `TaskQueue._tick`, ordenação `phase → priority` | Envelhecimento de prioridade, ou reserva de slot por fase |
| Travamento sob `_sessionLock` | `GameClient.acquireSession`, `navigate` com 3 tentativas e backoff | Timeout por operação dentro do lock |
| Pós-validação não confirma | `_validateBuildOutcome`, `_validateTransportOutcome` | Confirmar por outro sinal além de `underConstruction` / contagem de frota |
| Contrato do jogo mudou | `ENDPOINTS.md` vs. resposta real | Atualizar payload no `GameClient`; `plans/HYBRID_ENDPOINT_DOM_STRATEGY.md` já desenha o fallback por DOM |

## Armadilhas

- **`ENDPOINTS.md` documenta o servidor `s72-br` (mundo Styx), e a conta ativa está em `s76-br` (Cyclops).** A documentação é referência, não verdade garantida para este servidor. Divergência de endpoint é hipótese viva.
- **`node_modules` não está mais versionado.** Rode `npm install` antes de `npm test`.
- **Não é mais preciso `core.longpaths=true`** para clonar — era sintoma dos caminhos profundos de `node_modules`.
- **Há um commit local não empurrado:** `cf6255f` (modo MANUAL). O remoto está em `a5a195a`. Empurre ou avise o usuário.
- **Dois testes eram instáveis por corrida de relógio** e foram congelados com timers falsos (`hr_wine_retry.test.js` e os dois de timeout em `healthcheckrunner.test.js`). Se escrever teste sensível a tempo, use `vi.useFakeTimers()` — a suíte roda 49 arquivos em paralelo e timers reais com orçamento curto flakam.
- **Os testes de integração fixam `FULL-AUTO` no harness de propósito**, porque o padrão de fábrica agora é `MANUAL`. Não "corrija" isso.

## Verificação

- `npm test` — 238 testes, ~7s. Rode a suíte inteira algumas vezes ao mexer em timing.
- Fase 3 dá certo quando o relatório traz causa nomeada em vez de "timeout".
- Fase 4 dá certo quando `transport_dispatch` e `build_upgrade` confirmam, e o bot sobrevive a um ciclo completo em `SEMI`.

## Convenções

- Commits em português, no estilo convencional (`fix:`, `feat:`, `refactor:`, `chore:`), com corpo explicando **por quê**, não o quê.
- Mudanças pequenas e localizadas. Não refatore módulo não relacionado à tarefa.
- Prove mudança de comportamento com teste.
- Em dúvida de regra de negócio, `BUSINESS.md` manda; de implementação, `ARCHITECTURE.md`.
