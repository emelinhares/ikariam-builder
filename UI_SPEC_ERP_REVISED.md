# UI Spec — ERP Foundation (Ikariam) — Revisada

> Este documento substitui `UI_UX_SPEC_ERP_FOUNDATION_IKARIAM.md` como blueprint executável.
> A visão de produto original está preservada na seção **Produto-Alvo (Fase C)**.
> A implementação começa pela **Fase A**.

---

## Estrutura do Documento

1. Princípios permanentes (valem para todas as fases)
2. Fase A — MVP operacional (implementar agora)
3. Fase B — UI com ranking heurístico (quando priorizador existir)
4. Fase C — Produto-alvo completo (quando Optimizer existir)
5. Contrato de dados UI ↔ Motor

---

## 1. Princípios Permanentes

Esses princípios valem em todas as fases. Não negociáveis.

### Separação de camadas de estado

A UI deve sempre distinguir visualmente:

- **Observed** — lido do jogo há pouco tempo
- **Estimated** — inferido por timers/modelos
- **Stale** — observado, mas velho (> threshold)
- **Conflicted** — duas fontes discordam
- **Unknown** — sem dado suficiente

Nunca apresentar estimativa como fato.

### Reason first

Toda ação relevante na fila deve responder:
- o que vai acontecer
- por que foi gerada
- qual módulo originou
- qual o bloqueador (se houver)

### Estado antes de ação

A UI nunca executa ação sem exibir o estado atual e a confiança dele.

### Silêncio quando saudável

Alertas só aparecem quando há problema real. Nenhum ruído de status verde.

### UI não carrega lógica de negócio

`panel.js` consome `UIState` pronto. Não chama StateManager diretamente. Não calcula nada.

---

## 2. Fase A — MVP Operacional

**Pré-requisito de motor:** StateManager + TaskQueue + módulos CFO/COO/HR/CTO básicos.
**Sem requisito:** Optimizer, shadow pricing, beam search, EROI.

### Objetivo

Permitir ao operador:
- saber se o bot está operando com segurança
- ver o que ele vai fazer agora
- intervir rapidamente se necessário

### Regra de ouro

> Na tela principal, só entra aquilo que responde "está seguro continuar?" e "o que ele vai fazer agora?"

Tudo o mais vai para drawer, aba secundária ou detalhe.

---

### 2.1 Layout Principal (720px)

```
┌─────────────────────────────────────────┐
│  TOP BAR (fixa)                         │
├─────────────────────────────────────────┤
│  NOW / NEXT                             │
├─────────────────────────────────────────┤
│  QUEUE (3–5 tasks)                      │
├─────────────────────────────────────────┤
│  CITIES (lista compacta)                │
├─────────────────────────────────────────┤
│  QUICK ACTIONS                          │
└─────────────────────────────────────────┘
```

Stack vertical. Sem colunas. Sem cards gordos. Sem cockpit de múltiplos painéis.

Drawers laterais abrem sobre o layout ao clicar em cidade ou task.

---

### 2.2 Top Bar (sempre visível)

Altura: ~40px. Fixa no topo.

| Elemento | Detalhe |
|----------|---------|
| Status badge | `RUNNING` / `PAUSED` / `DEGRADED` / `BLOCKED` |
| Confiança global | `HIGH` / `MEDIUM` / `LOW` com cor |
| Última sync | "há 2min" ou timestamp relativo |
| Cidade ativa | nome da cidade atual da sessão |
| Contador de alertas | só aparece se > 0 |
| Modo de operação | `FULL-AUTO` / `SEMI` / `MANUAL` / `SAFE` |

Alertas críticos (P0) transformam a top bar inteira em vermelho e ficam persistentes até resolução.

---

### 2.3 Now / Next

Bloco de destaque. Primeira coisa visível após a top bar.

```
┌─────────────────────────────────────────┐
│ ▶ PRÓXIMA AÇÃO                          │
│   Upgrade Carpentry — BAD C             │
│   Motivo: maior ROI disponível, slot    │
│   livre, recursos OK                    │
│                                         │
│   Confiança: MEDIUM  |  ETA: agora      │
│   Bloqueador: —                         │
│                                         │
│   [Executar agora]  [Adiar]  [Detalhes] │
└─────────────────────────────────────────┘
```

Se não houver próxima ação: exibir "Nenhuma ação pendente — sistema idle."
Se houver bloqueador: exibir em laranja com motivo.
Se confiança for LOW: exibir aviso e não permitir execução automática.

---

### 2.4 Queue

Lista compacta de 3 a 5 tasks. Expansível via "ver todas".

Cada linha:

```
[TIPO] [CIDADE]  [MOTIVO CURTO]  [ETA]  [STATUS]  [⋮]
BUILD  BAD C     ROI > threshold  ~2h   pending    ⋮
TRANS  BAD E→M   wine emergency   now   ready      ⋮
BUILD  BAD M     corruption=0     4h    waiting    ⋮
```

`⋮` abre micro-menu: executar / adiar / cancelar / ver detalhes.

Status possíveis:
- `planned` — gerada, ainda não enfileirada para execução
- `ready` — pronta, aguardando contexto/tempo
- `in-flight` — enviada, aguardando feedback
- `blocked` — tem bloqueador ativo
- `failed` — última tentativa falhou

"Ver todas" abre drawer com lista completa separada em 4 seções: Planned / Pending / In-Flight / Completed.

---

### 2.5 Cities (lista compacta)

Uma linha por cidade. Sem card gordo.

```
● BAD C   wood  🔨 Carpentry lv4→5  ouro+12  ⚠ stale
● BAD E   sulf  ⏳ idle              ouro+8   ✓ fresh
● BAD M   marb  🔨 Town Hall lv8→9  ouro+6   ✓ fresh  [capital]
● BAD M2  marb  ⏳ idle              ouro+4   ✓ fresh
● BAD V   wine  🔨 Vineyard lv3→4   ouro-2   ⚠ stale
```

Legenda de ícones:
- `●` verde/amarelo/vermelho = saúde da cidade
- `🔨` = construção ativa (com ETA no hover)
- `⏳` = slot livre
- `⚠ stale` = dado com mais de 5min
- `✓ fresh` = dado recente

Clicar em qualquer cidade abre drawer lateral com detalhe completo (ver 2.7).

---

### 2.6 Quick Actions

Botões fixos no rodapé do painel.

| Botão | Ação |
|-------|------|
| Pause / Resume | Para/retoma execução da fila |
| Refresh All | Dispara fetchAllCities |
| Replan | Força reavaliação das prioridades pelos módulos |
| Safe Mode | Ativa modo defensivo (não constrói sem HIGH confidence) |

Pause e Safe Mode ficam destacados quando ativos.

---

### 2.7 Drawer de Cidade

Abre ao clicar em uma cidade na lista. Ocupa ~60% da largura do painel.

**Blocos:**

1. **Resumo** — nome, ilha, tradegood, papel (hub / produtora / científica / etc.)
2. **Estado e confiança** — idade do dado, fonte, nível de confiança, botão "refresh cidade"
3. **Produção e economia** — wood/h, tradegood/h, gold/h, wine líquido, corrupção
4. **Edifícios e slots** — grade 5×5 dos slots (ver 2.9)
5. **Ações recomendadas** — top 3 ações geradas pelos módulos para esta cidade
6. **Fila da cidade** — tasks ativas desta cidade
7. **Histórico recente** — últimas 10 ações executadas

---

### 2.8 Drawer de Task

Abre ao clicar em "Detalhes" de qualquer task. Mostra:

- tipo e cidade
- módulo originador (CFO / COO / HR / CTO)
- regra que disparou (texto da razão)
- pré-condições e status de cada uma
- bloqueadores ativos
- confiança no momento da criação
- histórico de tentativas
- botões: executar agora / adiar / cancelar

---

### 2.9 Grade de Slots (dentro do drawer de cidade)

Grid 5×5. Cada slot mostra:

- ícone do edifício (ou vazio)
- nível atual
- estado: `normal` / `building` / `locked` / `empty`

Hover/click abre tooltip com:
- nome e nível
- próximo nível: custo e tempo estimado
- motivo de bloqueio (se locked)
- se está em construção: ETA

Sem shadow price, sem EROI, sem candidatas alternativas — isso é Fase B/C.

---

### 2.10 Tabs de Navegação (Fase A)

```
[ Overview ]  [ Queue ]  [ Cities ]  [ Logs ]
```

- **Overview** — layout principal descrito acima
- **Queue** — lista completa de tasks (4 seções)
- **Cities** — lista expandida com filtros básicos
- **Logs** — reasoning log do Audit.js (virtualizado, filtro por cidade/módulo)

---

### 2.11 Sistema de Alertas (Fase A)

**P0 — Crítico** (top bar vira vermelha, persiste até resolução):
- token inválido
- cidade errada ativa ao tentar construir
- vinho em colapso iminente (< 4h)
- overflow iminente sem rota de escoamento
- divergência grave de estado (conflicted em campo crítico)

**P1 — Alto** (banner laranja abaixo da top bar):
- fila bloqueada há mais de 15min
- freeTransporters incerto (dado > 10min)
- construção concluída mas estado não atualizado

**P2 — Médio** (badge na cidade afetada):
- dado stale em cidade com task pendente
- carga de transporte subótima

**P3 — Informativo** (aparece no log, não na tela principal):
- build iniciado
- transporte enviado
- pesquisa concluída

---

### 2.12 Modos de Operação (Fase A)

Controlados pelo `ModeSwitcher` na top bar.

| Modo | Comportamento |
|------|--------------|
| `FULL-AUTO` | Executa tudo dentro dos guardrails |
| `SEMI` | Pede confirmação para P0-risk actions |
| `MANUAL` | Nada executa sem aprovação |
| `SAFE` | Só executa com confiança HIGH; prioriza refresh e proteção |

O modo atual deve ser impossível de ignorar na UI.

---

### 2.13 Explainability Operacional (Fase A)

O drawer de task substitui o "Decision Intelligence" da Fase C.

Em vez de EROI e shadow price, exibe:

```
Módulo:      CFO
Regra:       ROI > 2.0 calculado para Carpentry lv5
Dados usados: wood=4200, marble=1800, gold/h=+14 após upgrade
Confiança:   MEDIUM (dado com 3min)
Pré-cond.:   ✓ slot livre  ✓ recursos OK  ✗ cidade não ativa
Bloqueador:  cidade ativa = BAD M (precisa navegar)
```

Isso é explainability real sem depender do Optimizer.

---

## 3. Fase B — UI com Ranking Heurístico

**Pré-requisito de motor:** priorizador com score composto (não apenas ROI local).
**Sem requisito:** Optimizer completo, beam search, EROI de império.

### Adições em relação à Fase A

**Now/Next** passa a exibir:
- score heurístico da ação escolhida
- top 3 candidatas com score
- motivo de rejeição das alternativas (resumido)

**Drawer de cidade** passa a exibir:
- ranking das ações candidatas por score
- motivo de cada score

**Nova aba: Optimizer (parcial)**
- objetivo atual configurado
- top 5 ações do império com score heurístico
- ação escolhida e motivo

Nada de EROI completo, shadow price ou plano multi-step ainda.

---

## 4. Fase C — Produto-Alvo (Optimizer Completo)

**Pré-requisito de motor:** `Optimizer.js` com `evaluateEmpireState`, beam search, shadow pricing, min-cost flow.

Esta fase implementa a visão completa do `UI_UX_SPEC_ERP_FOUNDATION_IKARIAM.md`.

### Adições em relação à Fase B

**Aba Optimizer completa:**
- função-objetivo ativa e pesos configurados
- horizonte de planejamento (6h / 12h / 24h)
- melhor sequência encontrada pelo beam search
- score do plano
- top candidatas com EROI, delta V, custo logístico
- alternativas rejeitadas com motivo formal
- fatores frágeis (dados stale que podem invalidar o plano)
- sensibilidade da decisão

**Drawer de task (versão C):**
```
Ação escolhida:  Upgrade Carpentry — BAD C
EROI:            2.82
Delta V:         +182.4
Custo total:     resourceEq=41.2, timeEq=12.8, logEq=2.1, slotEq=8.5
Shadow price:    8.5 (slot aceita esta ação)
Confiança:       76%

Alternativas rejeitadas:
- Barracks BAD C    EROI=0.47  (dominado)
- Academy BAD C     EROI=1.31  (abaixo do threshold)

Fatores frágeis:
- freeTransporters com 8min de idade
- cidade ativa não confirmada
```

**Drift Table (drawer ou aba Diagnostics):**
- variável / valor esperado / valor observado / delta / severidade

**Timeline Operacional:**
- construções, transportes, pesquisas, replaneamentos, falhas
- ordenada por timestamp, filtro por cidade/tipo

**Aba Diagnostics avançada:**
- divergências entre headerData, DOM e inferência
- conflitos de cidade ativa
- histório de replanejamento
- ações manuais do operador

**Topology Explorer (Fase C tardia):**
- comparação de arquiteturas de império
- score por topologia

---

## 5. Contrato de Dados UI ↔ Motor

O `panel.js` consome apenas este objeto. Nunca acessa StateManager, TaskQueue ou módulos diretamente.

```javascript
// Produzido por UIBridge.js — atualizado por eventos do motor
UIState = {

  // Controle global
  bot: {
    status:      'RUNNING' | 'PAUSED' | 'DEGRADED' | 'BLOCKED',
    mode:        'FULL-AUTO' | 'SEMI' | 'MANUAL' | 'SAFE',
    confidence:  'HIGH' | 'MEDIUM' | 'LOW',
    lastSync:    Number,     // timestamp
    alertCount:  Number,
    activeCity:  Number,     // cityId da sessão atual
  },

  // Alertas ativos
  alerts: [{
    id:       String,
    level:    'P0' | 'P1' | 'P2' | 'P3',
    message:  String,
    cityId:   Number | null,
    ts:       Number,
    resolved: Boolean,
  }],

  // Próxima ação
  nextAction: {
    type:       TaskType,
    cityId:     Number,
    summary:    String,     // "Upgrade Carpentry — BAD C"
    reason:     String,     // motivo curto
    module:     String,     // "CFO"
    confidence: 'HIGH' | 'MEDIUM' | 'LOW',
    eta:        Number | null,
    blocker:    String | null,
    // Fase B+:
    score:      Number | null,
    // Fase C+:
    eroi:       Number | null,
    deltaV:     Number | null,
    alternatives: [] | null,
  } | null,

  // Fila resumida
  queue: {
    planned:   Task[],
    pending:   Task[],
    inFlight:  Task[],
    completed: Task[],   // últimas 20
  },

  // Cidades (lista compacta)
  cities: [{
    id:              Number,
    name:            String,
    tradegood:       Number,
    role:            String,     // 'hub' | 'producer' | 'science' | 'wine' | etc.
    health:          'green' | 'yellow' | 'red',
    confidence:      'HIGH' | 'MEDIUM' | 'LOW',
    dataAge:         Number,     // ms
    isActive:        Boolean,
    isCapital:       Boolean,
    goldPerHour:     Number,
    underConstruction: { building: String, eta: Number } | null,
  }],

  // Detalhe de cidade (carregado sob demanda ao abrir drawer)
  cityDetail: {
    [cityId]: {
      production:   { wood, tradegood, wine },
      economy:      { goldPerHour, corruption, satisfaction, growthPerHour },
      workers:      { wood, tradegood, scientists, priests },
      resources:    { wood, wine, marble, glass, sulfur },
      maxResources: { wood, wine, marble, glass, sulfur },
      buildings:    BuildingSlot[],
      tasks:        Task[],
      recentHistory: AuditEntry[],
      // Fase B+:
      topActions:   ScoredAction[] | null,
    }
  },

  // Logs (Audit.js)
  logs: AuditEntry[],   // até 200 entradas, paginadas na UI
}
```

### Task (usado em queue e cityDetail)

```javascript
Task = {
  id:          String,
  type:        'BUILD' | 'TRANSPORT' | 'RESEARCH' | 'NAVIGATE' | 'NOISE',
  cityId:      Number,
  summary:     String,
  reason:      String,
  module:      String,
  priority:    Number,
  status:      'planned' | 'ready' | 'in-flight' | 'blocked' | 'failed',
  scheduledFor: Number,
  createdAt:   Number,
  attempts:    Number,
  blocker:     String | null,
  confidence:  'HIGH' | 'MEDIUM' | 'LOW',
  preconditions: { label: String, met: Boolean }[],
  // Fase C+:
  eroi:        Number | null,
  deltaV:      Number | null,
  alternatives: RejectedAction[] | null,
}
```

### BuildingSlot

```javascript
BuildingSlot = {
  position:  Number,
  building:  String | null,
  level:     Number,
  state:     'normal' | 'building' | 'locked' | 'empty',
  eta:       Number | null,      // se building
  lockReason: String | null,     // se locked
  // Fase C+:
  shadowPrice: Number | null,
  eroi:        Number | null,
}
```

---

## 6. UIBridge.js

Módulo responsável por transformar estado interno em `UIState` e publicar via `Events`.

```javascript
// Eventos publicados pelo UIBridge:
Events.emit('ui:state:updated', UIState)
Events.emit('ui:alert:added',   Alert)
Events.emit('ui:alert:resolved', alertId)
Events.emit('ui:nextAction:changed', nextAction)
Events.emit('ui:queue:changed', queue)

// panel.js apenas escuta esses eventos e re-renderiza
```

Isso mantém `panel.js` completamente isolado dos internals do motor.

---

## 7. Design System Mínimo (Fase A)

### Paleta funcional

| Cor | Uso |
|-----|-----|
| Verde `#4caf50` | saudável / confirmado / fresh |
| Amarelo `#ffb300` | atenção / stale / MEDIUM confidence |
| Laranja `#ff6d00` | degradado / P1 alert |
| Vermelho `#f44336` | crítico / P0 / blocked |
| Azul `#2196f3` | in-flight / informativo |
| Cinza `#616161` | inativo / unknown / idle |

### Componentes mínimos (Fase A)

- `StatusBadge` — status colorido com texto
- `ConfidenceBadge` — HIGH/MEDIUM/LOW com cor
- `TaskRow` — linha compacta de task
- `CityRow` — linha compacta de cidade
- `AlertBanner` — P0/P1 com mensagem e ação
- `QuickActionBar` — botões fixos de intervenção
- `Drawer` — overlay lateral reutilizável
- `SlotGrid` — grade 5×5 de slots de edifício
- `ReasonBlock` — bloco de explainability de task

### Componentes adicionados na Fase C

- `DecisionCard` — ação com EROI, alternativas, fragilidade
- `DriftTable` — variável / esperado / observado / delta
- `CandidateTable` — top ações com score comparativo
- `TimelineRow` — evento na timeline operacional
- `MetricTile` — KPI com valor, tendência e tooltip

---

## 8. Regras de Performance

- `panel.js` re-renderiza apenas por eventos, nunca por polling
- log virtualizado: renderizar apenas linhas visíveis (não todo o array)
- drawer carrega `cityDetail` sob demanda, não no boot
- sem recalcular nada na camada visual — tudo vem pronto no `UIState`
- debounce de 300ms em filtros de log

---

## 9. Checklist de Aceitação por Fase

### Fase A — completa quando:
- [ ] Operador vê status, modo e confiança em < 3 segundos
- [ ] Operador sabe o que o bot vai fazer agora, e por quê
- [ ] Operador consegue pausar, resumir e forçar refresh
- [ ] Alertas P0 são impossíveis de ignorar
- [ ] Drawer de cidade mostra dados com indicação de confiança
- [ ] Drawer de task mostra módulo, regra e bloqueador
- [ ] Log filtrado por cidade e módulo
- [ ] UI não quebra com dados parciais (campos null/undefined)

### Fase B — completa quando:
- [ ] Now/Next mostra score e top 3 candidatas
- [ ] Drawer de cidade mostra ranking heurístico de ações
- [ ] Aba Optimizer existe com conteúdo real (não placeholder)

### Fase C — completa quando:
- [ ] EROI, shadow price e delta V exibidos em decisões
- [ ] Plano 6h/12h/24h visualizável
- [ ] Alternativas rejeitadas com motivo formal
- [ ] Drift table funcional
- [ ] Timeline operacional funcional
- [ ] Topology Explorer existe
