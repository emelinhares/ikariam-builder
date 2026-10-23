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

## A Fase 3 JÁ RODOU — resultado em 22/10/2026

Três execuções da suíte `full` na conta xEmEx (Cyclops, s76-br, 5 cidades). Os JSONs
estão na pasta de Downloads do usuário. Nenhum cenário falhou por erro do jogo:
**todos os problemas são da fila**. Resumo:

| Execução | transport | build | wine | workers |
|---|---|---|---|---|
| 22:05 | `NEVER_DISPATCHED` 240s | `NEVER_DISPATCHED` 240s | `NEVER_DISPATCHED` 120s | `NEVER_DISPATCHED` 120s |
| 22:14 | `DUPLICATE_TASK` | `NO_CONFIRMATION` 240s | `DUPLICATE_TASK` | `NO_CONFIRMATION` 120s |
| 22:16 | `PROBING_IN_PROGRESS` | `PROBING_IN_PROGRESS` | `DUPLICATE_TASK` | `PROBING_IN_PROGRESS` |

`state_snapshot`, `donation_flow` e `queue_guardrails` passaram nas três. A doação
passa porque chama `client.donateIslandResource` direto, **sem passar pela fila** —
o que confirma que o `GameClient` e a sessão do jogo estão saudáveis. O problema
está entre `TaskQueue.add` e a execução.

### Descoberta 1 — não é starvation de fase

Minha hipótese principal estava errada. Em todos os `NEVER_DISPATCHED` a evidência
traz **`skippedTicks=0`**. O contador só incrementa para tasks que estavam em `ready`
e perderam a ordenação. Zero significa que a task **nunca entrou em `ready`**.

A causa é o gate do `_tick`: `if (!this._executing) { ... }`. Enquanto uma task
executa, o bloco inteiro é pulado e `ready` nem é calculado. Com a fila saturada
(`pending=7` a `9` nas execuções), uma sucessão de tasks mantém `_executing` quase
sempre true e as novas nunca são consideradas. É **head-of-line blocking** num
executor de slot único, não disputa de prioridade.

E `watchdogResets=0` confirma: `_executing` nunca ficou travado mais de 60s de uma
vez — eram várias tasks curtas em sequência.

> **Isto é também um ponto cego da instrumentação que eu mesmo escrevi.** O contador
> de starvation em `_tick` só enxerga quem perde dentro de `ready`. Precisa de um
> segundo contador para "tempo pendente sem nunca ser considerado". Corrija isso
> antes de confiar no próximo relatório.

### Descoberta 2 — o probing bloqueia quase tudo

A execução das 22:16 mostra o mecanismo cru: `PROBING_IN_PROGRESS` em três dos
quatro cenários, cada um reagendado com **`delayMs=30000`**.

Em `TaskQueue._execute`, quando `state.isProbing()` é true, só passa o que
`_canRunDuringProbing` aprova — e isso é apenas `WINE_ADJUST` e `TRANSPORT` com
`payload.wineEmergency`. Todo o resto leva 30s de penalidade. O heartbeat de
`fetchAllCities` roda a cada 60s sobre 5 cidades; se a janela de probing cobre uma
fração relevante desse minuto, tasks normais ficam ricocheteando.

**Suspeita principal para a Fase 4.** Investigue a razão entre duração do probing e
intervalo do heartbeat (`heartbeatFocusMs`, 60s). Opções: encurtar a janela de
probing, aumentar o intervalo, permitir que tasks já despachadas terminem, ou
reagendar para o fim do probing em vez de 30s fixos.

### Descoberta 3 — laço de redespacho a 1 Hz sem consumir tentativa

Na execução das 22:14, o `build_upgrade` emitiu **`QUEUE_TASK_STARTED` cerca de 240
vezes, uma por segundo** (veja a sequência de `msUntilStarted` subindo de 464 até
239066 de ~1000 em ~1000, que é o `taskQueueTickFocusMs`). O mesmo em
`workers_science`, 120 vezes.

No fim: **`attempts=0/1`**, `watchdogResets=0`, `taskStatusAtTimeout=pending`, e
**nenhuma entrada `outcomeClass=`** na evidência.

Ou seja: a task é despachada, emite STARTED, e volta para `pending` **sem registrar
outcome e sem incrementar `attempts`**. Como o contador nunca avança, `maxAttempts`
nunca protege, e como cada volta é rápida, o watchdog de 60s nunca dispara. Laço
infinito silencioso.

O caminho do probing (Descoberta 2) **não** é este, porque ele chama
`_recordTaskOutcome` e apareceria como `outcomeClass=guard_reschedule`. Procure um
retorno antecipado depois do `emit(QUEUE_TASK_STARTED)` que não registra outcome.
Candidato forte: o bloco de **preempção** logo antes do emit (cede a vez para task
de fase menor, faz `task.status = 'pending'` e retorna) — confirme se há caminho
equivalente *depois* do emit, e verifique `_runGuards`, `_guardBuild` e
`_guardTransport`.

### Descoberta 4 — a suíte não é idempotente entre execuções

`DUPLICATE_TASK` aparece nas execuções 2 e 3 porque tasks das execuções anteriores
**continuam pendentes na fila** (`pending` subiu de 7 para 9). A suíte colide com o
próprio lixo. Além disso, o `wine_adjust` reutiliza uma task do módulo **HR**
(`existingModule=HR`), não da própria suíte.

Isso tem uma consequência pior no modo `MANUAL`: o filtro do `_tick` só libera task
com `module === 'HEALTHCHECK'` registrada em `_manualHealthCheckTasks`. Uma task do
HR reaproveitada **nunca** será despachada em MANUAL, por construção. Vale limpar a
fila antes de cada execução, ou dar à suíte um identificador próprio que não
deduplique contra tasks dos módulos de negócio.

## Descoberta 5 — o problema é de projeto, não de encanamento (medido ao vivo)

Medição real na conta, com a fila em MANUAL para não competir:

```
fetchAllCities (5 cidades)   24,6 s
heartbeatFocusMs             60,0 s
fila bloqueada               41 % do tempo
penalidade PROBING           30 s  =  1,22 × a janela que a causou
```

`StateManager.fetchAllCities` segura o **session lock** do `GameClient` durante o
laço inteiro: para cada cidade faz um GET e depois `humanDelay(1200, 2000)`, mais o
`fetchMilitaryAdvisor`, mais um `navigate` de retorno que ainda tenta até 3 vezes com
backoff. Com 5 cidades isso dá 24,6 s — e roda a cada 60 s.

Durante todo esse tempo `_probing` é true, e qualquer task que não seja emergência de
vinho leva **30 s** de castigo. Como 30 s é maior que a janela de 24,6 s, a task
penalizada acorda dentro ou às portas da **próxima** janela. É um ciclo que se
sustenta sozinho: a fila não está lenta, está estruturalmente impedida.

E escala mal. O custo é linear no número de cidades por causa do `humanDelay` fixo por
cidade. Com 8 cidades o probing passaria dos 60 s do heartbeat e o ERP ficaria
**permanentemente** em estado de probing. O sistema tem um teto de cidades embutido
que ninguém escreveu de propósito.

### A contradição no coração disso

`GameClient.navigate(cityId)` e `GameClient.probeCityData(cityId)` emitem **exatamente
o mesmo request**:

```
/index.php?view=port&cityId=X&position=N&backgroundView=city
          &currentCityId=X&activeTab=tabSendTransporter&ajax=1
```

Mas os comentários do código afirmam coisas opostas sobre ele:

- em `navigate`: *"Isso força o servidor a estabelecer X como cidade ativa"*
- em `fetchAllCities`: *"probeCityData é um GET simples — NÃO altera a cidade ativa no servidor"*

As duas não podem estar certas. E a arquitetura inteira depende da resposta: se o
probe **não** move a sessão, então o session lock de 24,6 s protege contra um perigo
inexistente e pode ser removido quase por inteiro. Se o probe **move**, então
`fetchAllCities` deixa o servidor na última cidade sondada enquanto `_activeCityId`
foi deliberadamente não atualizado — e o ERP fica dessincronizado do servidor depois
de cada heartbeat, o que explicaria ações caindo na cidade errada e guards girando.

**Verificado ao vivo:** ler dados de uma cidade arbitrária funciona sem navegar antes.
Com o navegador em BAD E (61748), o probe de BAD C (61747) voltou com
`backgroundData.id = 61747`. Leitura não exige navegação.

**Não verificado:** se esse mesmo request move a sessão do servidor. Tentei usar
`?view=city&ajax=1` como testemunha neutra, mas ele devolve 291 bytes sem
`updateGlobalData` — não serve. **Resolva isto primeiro**, é a pergunta da qual tudo
depende. Receita sugerida: ligar o modo REC, trocar de cidade clicando no próprio
jogo, e comparar o que o jogo faz com o que o `navigate` faz. O jogo é a fonte da
verdade; o `ENDPOINTS.md` é hipótese de março, de outro servidor.

### O que isso diz sobre a pergunta "o agente anterior entendeu o site?"

Entendeu os contratos HTTP individuais muito bem — os endpoints funcionam, a doação
real passou em três execuções seguidas. O que não foi entendido é o **modelo de
sessão**: o código trata "qual cidade está ativa" como um recurso global, exclusivo e
caro, e por isso serializa tudo atrás de um lock. Toda a dor — executor de slot único,
`_sessionLock`, `_probing`, penalidade de 30 s, head-of-line blocking — descende dessa
única premissa, que está documentada de forma contraditória e nunca foi testada.

Antes de otimizar a fila, responda se a premissa é verdadeira. Se não for, a correção
não é ajustar timeouts: é **deixar de serializar leituras**, e o problema evapora.

## Fase 4 — correção, guiada pela evidência

Ordem sugerida, agora que há evidência real:

1. **Corrigir o ponto cego da instrumentação** (Descoberta 1) — sem isso o próximo
   relatório mente de novo. Contador de tempo pendente sem ser considerado.
2. **Laço de redespacho** (Descoberta 3) — é o bug mais claro e mais grave: consome
   requests ao jogo a 1 Hz indefinidamente. Achar o retorno antecipado sem outcome.
3. **Contenção do probing** (Descoberta 2) — é o que trava a operação normal.
4. **Idempotência da suíte** (Descoberta 4) — para que os relatórios seguintes sejam
   comparáveis entre si.

Hipóteses que o relatório **descartou**: starvation de fase, travamento sob
`_sessionLock`, e mudança de contrato do jogo (a doação real passou nas três
execuções, e nenhum cenário reportou erro de HTTP ou parsing).

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
