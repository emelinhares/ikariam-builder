# Plano de correção e evolução — outubro 2026

Baseado em medição na conta real (xEmEx, Cyclops, `s76-br`, 5 cidades) e em três
execuções da suíte `full` do health check. Cada item diz o que foi **medido**, o que é
**inferido** e o que ainda é **hipótese**.

## O que foi medido no servidor

| Teste | Resultado |
|---|---|
| 5 leituras de cidade, sequenciais, sem delay | **3.395 ms** (667, 664, 705, 666, 692) |
| As mesmas 5 leituras **em paralelo** | **1.314 ms**, todas HTTP 200, todas com a cidade correta |
| As mesmas 5 leituras via `fetchAllCities` | **24.638 ms** |
| `actionRequest` em 4 leituras seguidas | **1 valor distinto** — estável, e igual ao `ikariam.model` |
| Variação entre as 5 respostas | **6 %** |

**Conclusões firmes:** o servidor responde rápido e de forma consistente; não há
throttling; aceita leituras concorrentes de cidades diferentes sem erro; e leitura
**não** rotaciona o `actionRequest`. Os 24,6 s do ERP são 86 % sono próprio.

**Questão em aberto:** se a rota usada por `navigate()`/`probeCityData()` move a
cidade ativa da sessão. Tentei usar o `<title>` de `/index.php?view=city` como
testemunha, mas o controle falhou — nem uma navegação completa (`view=city&cityId=X`,
sem `ajax`) alterou a testemunha. **A testemunha é inválida; a pergunta continua
aberta.** Não gaste tempo repetindo esse caminho.

---

## Estado da execução (23/10/2026, commit 6a3f5b2)

| Item | Estado |
|---|---|
| A1 laço de redespacho | **feito** — invariante no ponto de emissão + marcadores de estágio |
| A2 penalidade de probing | **feito** — 30s → 5s, configurável |
| A3 delay duplicado | **feito** — ~8s a menos por ciclo |
| A4 ponto cego da instrumentação | **feito** — `blockedTicks` |
| A5 idempotência da suíte | **parcial** — restos cancelados; dedup contra outros módulos em aberto |
| B1 cidade de sessão | **aberto** — precisa do modo REC contra clique real |
| B2 escrita rotaciona token | **aberto** |
| C1–C3, D1–D3 | não iniciados |

Efeito esperado da janela de probing: 24,6s → ~16s (A3), e a penalidade deixa
de ultrapassá-la (A2). A fração de bloqueio cai de 41% para a ordem de 25%, e
some o ciclo que se auto-sustentava. **Ainda não medido ao vivo** — exige nova
execução da suíte com a extensão recarregada.

## Execução 4 — medida depois das correções (23/10, `hc_2bCGV2Do`)

```
janela de probing     24.638 ms  ->  15.831 ms   (-35,7 %)
fração do minuto           41,1 %  ->      26,4 %
penalidade / janela        1,22 x  ->       0,32 x
passRate                   42,9 %  ->      57,1 %
```

| Cenário | 3 execuções anteriores | execução 4 |
|---|---|---|
| state_snapshot | passed ×3 | passed |
| **transport_dispatch** | NEVER_DISPATCHED / DUPLICATE / PROBING | **passed (40 s)** |
| build_upgrade | NEVER_DISPATCHED / NO_CONFIRMATION / PROBING | timeout / NEVER_DISPATCHED (240 s) |
| donation_flow | passed ×3 | passed (5 s) |
| wine_adjust | NEVER_DISPATCHED / DUPLICATE ×2 | inconclusive / **WINE_LEVEL_UNCHANGED** (10 s) |
| workers_science | NEVER_DISPATCHED / NO_CONFIRMATION / PROBING | blocked / PROBING_IN_PROGRESS (12 s) |
| queue_guardrails | passed ×3 | passed |

Três dos quatro cenários quebrados mudaram de categoria: `transport_dispatch`
**passa pela primeira vez**; `wine_adjust` deixa de colidir com lixo da execução
anterior (A5) e produz um veredito de negócio real; `workers_science` falha em 12 s
com causa nomeada em vez de pendurar 120 s. O que sobrou é diagnóstico, não mistério.

### Por que `build_upgrade` continua sem despachar — e não é a fila

Evidência da própria task, com a instrumentação nova:

```
taskStatusAtTimeout = waiting_resources
dispatchCount       = 0
blockedTicks        = 157
skippedTicks        = 30
attempts            = 0/1
```

`waiting_resources` **não** é `pending`, então o filtro de `ready` em `_tick` a exclui
por completo: ela nunca foi candidata. Não é starvation nem probing. A cidade não tem
material para o upgrade.

O histórico da fila confirma e amplia:

```
SERVER_REFUSED_INSUFFICIENT_RESOURCES   48
TRANSPORT_SERVER_ACCEPTED                1   ← o transporte desta execução
WINE_LEVEL_UNCHANGED                     1
```

**48 das 50 tasks no histórico falharam porque o servidor recusou por falta de
recurso.** O ERP está decidindo ações que a conta não pode pagar, o servidor recusa,
e o executor de slot único fica ocupado com isso — o que explica os 157 ticks de
bloqueio de todo o resto.

Isto desloca o problema de camada: já não é encanamento de fila, é **decisão de
negócio**. CFO e COO aprovam sem verificar saldo, ou verificam contra um estado
desatualizado. É o novo item de topo, e deve vir antes de qualquer otimização
adicional de fila.

### Efeito colateral visível: poluição por NOISE

Na inspeção da fila durante a execução, 9 das 15 tasks pendentes eram `NOISE`, todas
com `dispatchCount = 0` e ~35 `skippedTicks`. NOISE é fase 5, a mais baixa, então
perde para tudo e se acumula indefinidamente enquanto o CSO continua gerando. Precisa
de teto ou de descarte por idade.

## A. Correções — bugs confirmados por evidência

### A1. Laço de redespacho a 1 Hz *(crítico)*

`build_upgrade` emitiu `QUEUE_TASK_STARTED` ~240 vezes em 240 s, uma por tick,
terminando com `attempts=0/1` e **nenhum** `outcomeClass` registrado. A task é
despachada, emite STARTED e volta a `pending` sem registrar desfecho e sem consumir
tentativa. `maxAttempts` nunca protege; o watchdog de 60 s nunca dispara porque cada
volta é rápida.

Procurar em `TaskQueue._execute` um retorno antecipado **depois** do
`emit(QUEUE_TASK_STARTED)` que não chama `_recordTaskOutcome`. O caminho de probing
não é este — ele registra outcome. Suspeitos: `_runGuards`, `_guardBuild`,
`_guardTransport`, e o bloco de preempção.

**Teste de aceitação:** nenhuma task pode emitir STARTED duas vezes sem que
`attempts` avance. Vale um teste unitário que falhe hoje.

### A2. Dormir dentro da seção crítica *(maior ganho por esforço)*

`fetchAllCities` segura o `_sessionLock` e mantém `_probing = true` por 24,6 s, dos
quais 21,2 s são `humanDelay`. Durante isso toda task não-emergencial leva 30 s de
castigo — penalidade **maior que a janela que a causou**, o que joga a task na janela
seguinte.

**Correção recomendada:** manter o espaçamento, parar de torná-lo exclusivo. Marcar
`_probing` apenas durante a janela real de request (~3,4 s) e soltar o lock durante o
sono leva o bloqueio de **41 % para ~6 %** sem alterar em nada o padrão de tráfego.

> **Não paralelize as leituras para ganhar tempo.** O teste mostra que o servidor
> aceita (1,3 s contra 3,4 s), mas 5 requests simultâneos é um padrão obviamente não
> humano. O `humanDelay` existe porque automação viola os termos da Gameforge e custa
> banimento. O ganho de 2 s não paga o risco; o ganho dos 21 s vem de A2 sem tocar no
> fingerprint.

### A3. Delay duplicado

Há dois `humanDelay` empilhados por cidade: `GameClient._enqueue` espaça **todo**
request (800–2500 ms) e `fetchAllCities` adiciona outro (1200–2000 ms) por cidade. O
segundo é redundante. Removê-lo corta ~8 s do ciclo mantendo o espaçamento entre
requests intacto.

### A4. Ponto cego da instrumentação de starvation

O contador `skippedTicks` só incrementa para tasks dentro de `ready` que perdem a
ordenação. Como o bloco inteiro está sob `if (!this._executing)`, uma task que nunca
chega a ser considerada marca **zero** — foi o que aconteceu nos `NEVER_DISPATCHED`.
Falta um contador de *tempo pendente elegível sem ser considerado*. Sem isso o próximo
relatório engana de novo.

### A5. Health check não é idempotente

Tasks de execuções anteriores continuam pendentes e causam `DUPLICATE_TASK`
(`pending` subiu de 7 para 9 entre execuções). Pior: `wine_adjust` reaproveita task do
módulo **HR**, que por construção nunca roda em MANUAL — o filtro do `_tick` só libera
`module === 'HEALTHCHECK'` registrada em `_manualHealthCheckTasks`.

Dar à suíte um identificador próprio que não deduplique contra tasks dos módulos de
negócio, e limpar as tasks da suíte anterior ao iniciar.

---

## B. Investigação obrigatória antes de otimizar mais

### B1. A cidade de sessão é um recurso global?

É a premissa da qual descende toda a serialização: executor de slot único,
`_sessionLock`, `_probing`, penalidade de 30 s. Os comentários do código se
contradizem sobre o mesmo request — `navigate` diz que ele estabelece a cidade ativa,
`fetchAllCities` diz que não altera nada.

**Receita:** ligar o modo REC (`setRec`), trocar de cidade **clicando no próprio
jogo**, e comparar o request que o jogo emite com o que `navigate()` emite. O jogo é a
fonte da verdade; o `ENDPOINTS.md` é hipótese de março, colhida em outro servidor
(`s72-br`/Styx — a conta ativa hoje é `s76-br`/Cyclops).

Se a sessão **não** for global, leituras não precisam de lock nenhum e A2 vira trivial.
Se **for**, então `fetchAllCities` deixa o servidor na última cidade sondada enquanto
`_activeCityId` não é atualizado, e o ERP fica dessincronizado após todo heartbeat —
o que explicaria ações caindo na cidade errada.

### B2. Escrita rotaciona o `actionRequest`?

Leitura não rotaciona (medido). Se escrita rotacionar, escritas concorrentes se
invalidam e **devem** continuar serializadas — mas leituras não. O código já tem sinal
disso em `_validateWineAdjustOutcome` (`tokenRotated`). Confirmar com uma escrita real
de baixo impacto antes de relaxar qualquer serialização de escrita.

---

## C. Melhorias

### C1. Validade por cidade em vez de varredura total

Hoje o heartbeat re-sonda **todas** as cidades a cada 60 s, custe o que custar. Com
custo linear por cidade, há um teto embutido: com 8 cidades o probing passaria dos 60 s
e o ERP ficaria permanentemente sondando.

Trocar por validade por cidade: re-sondar só quem está perto de um evento relevante
(obra terminando, frota chegando, vinho no limite). O `Planner` já calcula esses
instantes para os wake-ups adaptativos — a informação existe, só não é usada para
decidir o que sondar.

### C2. Backpressure

A suíte registrou `pending` subindo de 7 para 9 enquanto nada era despachado. Faltam
freios: limite de fila por tipo, e recusa de enfileirar quando a vazão está zerada.

### C3. Teto de cidades explícito

Enquanto C1 não existir, registrar em log um aviso quando
`duração do probing > heartbeat × 0,5`. Hoje o sistema degrada silenciosamente.

---

## D. Implementações novas

### D1. Métricas de vazão no painel

O painel mostra estado, não saúde. Expor: fração do tempo com `_probing` ativo, tempo
médio pendente por task, contagem de redespachos sem outcome, e a duração do último
`fetchAllCities`. Todas as quatro já são deriváveis do que existe — foi assim que esta
investigação foi feita, mas na mão pelo console.

### D2. Modo dry-run

Executar o ciclo completo de decisão registrando as ações que **seriam** tomadas, sem
emitir request de escrita. Hoje a única forma de testar é agir de verdade no jogo —
foi o que a suíte `full` fez: 500 de enxofre, um upgrade e uma doação reais por
execução, três vezes.

### D3. Suíte de verificação de contrato

Um alvo menor que o health check: só confere que os endpoints documentados em
`ENDPOINTS.md` ainda respondem com o formato esperado, **sem** executar ação. Serve
para detectar mudança do jogo sem gastar recurso. Teria respondido em segundos a
pergunta "o contrato mudou desde março?" — que esta investigação levou horas para
responder por outros meios.

---

## Ordem sugerida

1. **A1** — é o bug mais grave: bate no servidor 1×/s indefinidamente.
2. **A4** — sem isso, nenhuma medição seguinte é confiável.
3. **B1** — define se A2 é trivial ou delicado.
4. **A2 + A3** — o ganho grande: 41 % → ~6 % de bloqueio.
5. **A5** — para que relatórios sucessivos sejam comparáveis.
6. **D1** — para enxergar o efeito das correções sem console.
7. **C1** — remove o teto de cidades.

Itens B2, C2, C3, D2 e D3 entram quando os anteriores estiverem fechados.
