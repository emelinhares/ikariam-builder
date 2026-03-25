# Ikariam ERP — Documento Fundacional v1.0
> Projeto do zero. Não herda código do Builder v5.0 nem do IKAEASY.
> Herda aprendizados, armadilhas documentadas, e padrões validados.

---

## 1. Visão e Nomenclatura

O sistema é um **ERP corporativo** rodando sobre o jogo Ikariam via Chrome Extension (MV3).

| Papel de Negócio | Módulo Técnico |
|------------------|----------------|
| CFO (fluxo de caixa, ROI, custo de oportunidade) | `modules/CFO.js` |
| COO (logística JIT, otimização de frete) | `modules/COO.js` |
| RH (população, vinho, alocação de trabalhadores) | `modules/HR.js` |
| CTO (pesquisa, academia, fila de ciência) | `modules/CTO.js` |
| CSO (mimetismo, proteção, dispersão de recursos) | `modules/CSO.js` |
| M&A (expansão, seed money, nova colônia) | `modules/MnA.js` |

Cada módulo de negócio **consome** dados do `StateManager` e **emite** tarefas para o `TaskQueue`.

---

## 2. Arquitetura em Camadas

```
┌─────────────────────────────────────────────────────────┐
│  UI Layer (Dashboard Executivo)                          │
│  panel.html / panel.js / panel.css                      │
│  Exibe: Reasoning logs, Health monitor, Timeline        │
└──────────────────────┬──────────────────────────────────┘
                       │ Events
┌──────────────────────▼──────────────────────────────────┐
│  Business Logic Layer                                    │
│  CFO / COO / HR / CTO / CSO / MnA                       │
│  Lê: StateManager  |  Escreve: TaskQueue                │
└──────────┬───────────────────────┬──────────────────────┘
           │ read                  │ emit tasks
┌──────────▼──────────┐  ┌────────▼──────────────────────┐
│  StateManager        │  │  TaskQueue (executor JIT)     │
│  Visão única global  │  │  Fila persistida, com delay   │
│  de todas as cidades │  │  gaussiano entre cada ação    │
└──────────┬──────────┘  └────────┬──────────────────────┘
           │ feeds                 │ executes via
┌──────────▼──────────────────────▼──────────────────────┐
│  Game API Layer                                          │
│  GameClient.js — todos os requests ao /index.php        │
│  Único ponto de saída de ações no jogo                  │
└──────────┬──────────────────────────────────────────────┘
           │ intercepts / reads
┌──────────▼──────────────────────────────────────────────┐
│  Data Acquisition Layer                                  │
│  DataCollector.js — XHR/fetch interceptor + AJAX probes │
│  Extrai dados do ikariam.model, screen.data, headerData │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Camada de Aquisição de Dados (DataCollector)

### 3.1 Fontes de Verdade — Hierarquia

```
Prioridade 1: headerData (response de qualquer AJAX)
  → freeTransporters, maxTransporters, wineSpendings, maxStorage
  → currentResources (snapshot mais fresco)
  → actionRequest (CSRF renovado)

Prioridade 2: screen.data (cidade ATUAL apenas)
  → position[] (slots de edifícios ao vivo)
  → underConstruction (status de construção ao vivo)
  → lockedPosition (slots bloqueados por pesquisa)
  → islandId, citizens, workers

Prioridade 3: ikariam.model (snapshot periódico, 15s)
  → relatedCityData (lista de cidades com selectedCityId)
  → research.investigated[] (pesquisas completas)
  → serverTime, requestTime, initialBrowserTime

Prioridade 4: AJAX probing (fetchAllCities)
  → Dados de cidades não-ativas (não é a cidade atual)
  → headerData de cada cidade individualmente
```

### 3.2 Campos Críticos e Tipos Corretos

| Campo | Fonte Correta | Tipo Declarado | Armadilha |
|-------|---------------|----------------|-----------|
| `freeTransporters` | `headerData` APENAS | `Number` | Não existe em `ikariam.model` |
| `maxTransporters` | `headerData` APENAS | `Number` | Idem |
| `wineSpendings` | `headerData.wineSpendings` | `Number` | Em `model` diverge ~11% (não conta vinhedo) |
| `producedTradegood` | `headerData` → cast imediato | `Number` (1-4) | Vem como STRING no root do model |
| `maxResources` | `headerData.maxStorage` | `Number` | Capacidade real, não estrutura |
| `selectedCityId` | `relatedCityData.selectedCityId` | `Number` | Usar numérico direto, não string `"city_X"` |
| `underConstruction` | `screen.data.underConstruction` | `-1` ou posição | `-1` = livre; checar `!== -1 && !== false` |
| `lockedPosition` | `backgroundData.lockedPosition` | `{ "pos": "msg" }` | Bloqueia slot mesmo sem construção ativa |
| `actionRequest` | Última resposta AJAX | `String` | Renovar após CADA resposta |
| Wood production | `model.resourceProduction` | `Number/s` | Multiplicar × 3600 para /h |
| Tradegood production | `model.tradegoodProduction` | `Number/s` | Idem |

### 3.3 Mapa de Recursos

```javascript
const RESOURCE_KEY = {
    wood:   'resource',   // madeira = chave 'resource' (string!)
    wine:   '1',
    marble: '2',
    glass:  '3',          // glass === crystal (mesmo recurso, dois nomes)
    sulfur: '4',
};

// Campos de cargo no payload de transporte:
const CARGO_FIELD = {
    wood:   'cargo_resource',
    wine:   'cargo_tradegood1',
    marble: 'cargo_tradegood2',
    glass:  'cargo_tradegood3',
    sulfur: 'cargo_tradegood4',
};
```

### 3.4 Dados da Câmara Municipal (Town Hall DOM)

> Fonte: DOM scraping via `/index.php?view=townHall&...&ajax=1`

```
#citizens             → cidadãos livres (sem alocação)
#population           → população total
#growthRateValue      → crescimento /h (pode ser negativo)
#goldPerHour          → ouro líquido após todos os custos
#corruptionValue      → % de corrupção (0–100)
#satisfactionValue    → satisfação total
#actionPointsValue    → pontos de ação disponíveis
#woodWorkers          → alocados em serraria
#luxuryWorkers        → alocados em mina de luxo
#scientists           → alocados na academia
#priests              → alocados no templo
```

### 3.5 Dados de Frota (Military Advisor DOM)

> Fonte: `/index.php?view=militaryAdvisor&oldView=city&ajax=1`

Cada linha da tabela `#fleet_movements` contém:
- `data-event-id` → ID único do movimento
- `.mission_type` → transport / deployarmy / plunder / occupy
- `.arrival_time` → timestamp Unix de chegada (arrivalTs)
- `.origin_city` + `.destination_city` → cityIds
- `.resources` → carga transportada

---

## 4. StateManager — Visão Única da Verdade

### 4.1 Estrutura do Estado Global

```javascript
StateManager = {
    // Indexed by cityId (Number)
    cities: Map<cityId, CityState>,

    // Global
    fleetMovements: FleetMovement[],
    research: ResearchState,
    serverTimeOffset: Number,   // (browserMs / 1000) - serverTs
    lastFullRefresh: Number,    // timestamp

    // Métodos
    getCity(id): CityState,
    getAllCities(): CityState[],
    getServerNow(): Number,     // serverTs corrigido
    needsRefresh(cityId): Boolean,
}
```

### 4.2 CityState — Por Cidade

```javascript
CityState = {
    id: Number,
    name: String,
    isCapital: Boolean,
    islandId: Number,
    tradegood: Number,          // 1-4 (o que a ilha produz)

    // Recursos (snapshot + timestamp)
    resources: { wood, wine, marble, glass, sulfur },
    maxResources: { wood, wine, marble, glass, sulfur },
    resourcesTs: Number,        // quando foram capturados

    // Produção (/hora)
    production: {
        wood: Number,
        tradegood: Number,
        wineSpendings: Number,  // consumo /h (negativo conceptualmente)
    },

    // Frota
    freeTransporters: Number,
    maxTransporters: Number,

    // Construção
    buildings: BuildingSlot[],  // 25 slots
    underConstruction: Number | false,  // posição ou false
    lockedPositions: Set<Number>,       // posições bloqueadas por pesquisa

    // Câmara Municipal
    economy: {
        population: Number,
        maxInhabitants: Number,
        growthPerHour: Number,  // pode ser negativo
        citizens: Number,       // livres (sem trabalho)
        goldPerHour: Number,    // líquido (após todos os custos)
        corruption: Number,     // 0.0 a 1.0
        satisfaction: Number,   // -6 a +6
        actionPoints: Number,
    },

    // Trabalhadores
    workers: {
        wood: Number,
        tradegood: Number,
        scientists: Number,
        priests: Number,
    },

    // Taverna
    tavern: {
        wineLevel: Number,      // índice 0-47 na tabela WINE_USE
        winePerHour: Number,    // consumo real (já descontado vinhedo se houver)
    },

    // Metadados
    dataAge: Number,            // ms desde última atualização
    fetchedAt: Number,          // timestamp da última probe
}
```

### 4.3 ResearchState

```javascript
ResearchState = {
    investigated: Set<Number>,  // IDs de pesquisas completas
    inProgress: { id: Number, finishTs: Number } | null,
    pointsPerHour: Number,
    fetchedAt: Number,
    ttl: 21600000,              // 6 horas
}
```

### 4.4 FleetMovement

```javascript
FleetMovement = {
    eventId: String,
    missionType: 'transport' | 'deployarmy' | 'plunder' | 'occupy' | 'spy',
    isOwn: Boolean,
    isHostile: Boolean,
    originCityId: Number,
    destinationCityId: Number,
    arrivalTs: Number,          // Unix timestamp
    resources: { wood, wine, marble, glass, sulfur },
    transporters: Number,
}
```

---

## 5. GameClient — Único Ponto de Saída

### 5.1 Regras de Ouro

1. **Todo request** passa pelo GameClient. Nenhum módulo faz `fetch/XHR` diretamente.
2. **CSRF renovado** após cada resposta. `updateToken()` é chamado em toda resposta.
3. **Delay gaussiano** entre requests: min 800ms, max 2500ms, σ = 400ms.
4. **Navegação antes de ação**: qualquer ação que exija `currentCityId` deve primeiro verificar se estamos na cidade correta. Se não, navegar e persistir a ação na fila.

### 5.2 Payloads Validados

**Upgrade de edifício:**
```javascript
{
    action:          'UpgradeExistingBuilding',  // EXATO (case-sensitive)
    function:        'upgradeBuilding',
    view:            buildingViewName,           // ex: 'townHall', 'warehouse'
    cityId:          String(cityId),
    position:        String(position),
    backgroundView:  'city',
    currentCityId:   String(cityId),             // DEVE ser cidade atual da sessão
    templateView:    buildingFullName,
    actionRequest:   token,
    ajax:            1,
}
```

**Transporte:**
```javascript
{
    action:                'transportOperations',
    function:              'loadTransportersWithFreight',
    destinationCityId:     toCityId,
    islandId:              toIslandId,           // ilha DESTINO, não origem
    normalTransportersMax: freeBoats,
    cargo_resource:        wood ?? 0,
    cargo_tradegood1:      wine ?? 0,
    cargo_tradegood2:      marble ?? 0,
    cargo_tradegood3:      glass ?? 0,
    cargo_tradegood4:      sulfur ?? 0,
    capacity:              5,                    // SEMPRE 5, não 500
    max_capacity:          5,                    // SEMPRE 5
    transporters:          boatsToSend,
    backgroundView:        'city',
    currentCityId:         fromCityId,           // cidade origem = sessão atual
    templateView:          'transport',
    currentTab:            'tabSendTransporter',
    actionRequest:         token,
    ajax:                  1,
}
```

**Fetch de custo de upgrade:**
```javascript
// GET endpoint
`/index.php?view=${buildingView}&cityId=${cityId}&position=${position}` +
`&backgroundView=city&currentCityId=${cityId}&ajax=1`

// Parse: DOMParser → querySelectorAll('ul.resources li') →
//   li.querySelector('.accesshint')?.remove()  // OBRIGATÓRIO antes do textContent
//   → parseInt(li.textContent.replace(/\./g, '').trim())
```

### 5.3 Parsing de Respostas

```javascript
// Resposta é array de comandos: [[comando, dados], ...]
const response = JSON.parse(raw);

// Extrair headerData atualizado:
const globalData = response.find(c => c[0] === 'updateGlobalData')?.[1];
const headerData = globalData?.headerData;
const newToken   = globalData?.actionRequest;

// Extrair HTML de view:
const html = response.find(c => c[0] === 'changeView')?.[1]?.[1] ?? '';

// Extrair dados de template (pesquisa, edifício, etc.):
const tpl = response.find(c => c[0] === 'updateTemplateData')?.[1];
```

---

## 6. TaskQueue — Executor JIT

### 6.1 Estrutura de Tarefa

```javascript
Task = {
    id: String,                 // uuid
    type: TaskType,             // BUILD | TRANSPORT | RESEARCH | NAVIGATE | NOISE
    priority: Number,           // 0 = urgente, 10 = baixa prioridade
    cityId: Number,             // cidade de execução
    payload: Object,            // dados específicos por tipo
    scheduledFor: Number,       // timestamp mínimo de execução (JIT)
    createdAt: Number,
    attempts: Number,
    maxAttempts: Number,        // default 3
    reason: String,             // reasoning log: "Por que esta tarefa existe"
}
```

### 6.2 Regras de Execução

- **Apenas 1 tarefa por vez** por cidade (não paralelo)
- **scheduledFor** implementa JIT: executar quando o recurso chegará
- **90% de carga** mínima em transporte, exceto emergência de vinho
- **95% do armazém** dispara escoamento automático imediato (prioridade 0)
- **Risco de evasão** (vinho zerado projetado em < 4h) = prioridade máxima
- Delay gaussiano entre tarefas: `humanDelay(800, 2500)`

### 6.3 Tarefa NOISE (mimetismo)

```javascript
// Navegar para telas informativas sem executar ações
const NOISE_VIEWS = ['embassy', 'barracks', 'museum', 'academy', 'temple'];
// Frequência: 1 noise a cada 8-15 ações reais
// Delay: igual ao de ações reais (indistinguível)
```

---

## 7. Módulos de Negócio

### 7.1 CFO — Diretor Financeiro

**Responsabilidades:**
- Calcular ROI antes de qualquer upgrade
- Bloquear investimentos se `goldPerHour * 12 < upkeepTotal * 12`
- Calcular custo de oportunidade: produzir vs. comprar no mercado
- Emitir alerta se corrupção > 0% e não houver Governor's Residence em fila

**Inputs:** `StateManager.cities[*].economy`
**Outputs:** `TaskQueue.add(BUILD)` ou `TaskQueue.block()`

**Fórmula de ROI:**
```
ROI = (benefício_gerado_por_nivel × vida_útil_esperada) / custo_total_do_upgrade
Construir se ROI > threshold_configuravel (default: 2.0)
```

### 7.2 COO — Diretor de Operações

**Responsabilidades:**
- Calcular tempo de viagem cidade A → cidade B
- Disparar transporte para chegada D segundos após fim de construção anterior
- Nunca enviar barco com < 90% carga (exceto emergência de vinho)
- Ao atingir 95% do armazém, escoar automaticamente para cidade com espaço livre

**Inputs:** `StateManager.cities[*].freeTransporters`, `fleetMovements`
**Outputs:** `TaskQueue.add(TRANSPORT)` com `scheduledFor = finishTs_construcao - tempoViagem`

### 7.3 HR — Recursos Humanos

**Responsabilidades:**
- Manter satisfação em +1 com o mínimo de vinho possível
- Ajustar workers: mover de minas para cidadãos livres quando meta atingida
- Detectar risco de evasão (satisfação ≤ 0 projetada)
- Calcular ponto de equilíbrio de felicidade por cidade

**Inputs:** `StateManager.cities[*].economy`, `tavern`, `workers`
**Outputs:** Ajuste de `tavernWineLevel`, realocação de workers via `TaskQueue`

**Ponto de equilíbrio:**
```
wine_level_minimo = min(i) onde WINE_USE[i] ≥ wine_spendings_para_satisfacao_1
```

### 7.4 CTO — Diretor de Tecnologia

**Responsabilidades:**
- Monitorar fila de pesquisa e horas restantes
- Priorizar pesquisas que reduzem custo de construção (Pulley, Geometry, etc.)
- Calcular `researchPointsPerHour` com multiplicadores corretos
- Alertar quando pesquisa econômica está disponível e não foi iniciada

**Fórmula research/h:**
```
pts/h = scientists × baseMultiplier × (1 - corruption) × governmentMultiplier
baseMultiplier: Paper +2%, Ink +4%, Mechanical Pen +8%, Sci Future +2%/level
governmentMultiplier: Technocracy +5%, Theocracy -5%
```

### 7.5 CSO — Segurança

**Responsabilidades:**
- Delays gaussianos em todas as ações (Box-Muller)
- Inserir NOISE tasks periodicamente
- Se recursos desprotegidos > `warehouse.safe`, mover excedente ou dispersar em frota
- Monitorar `arrivalTs` de frotas inimigas

**Implementação humanDelay:**
```javascript
function humanDelay(min, max, multiplier = 1.0) {
    // Box-Muller
    const u1 = Math.random(), u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const mean = (min + max) / 2;
    const sigma = (max - min) / 6;
    const delay = Math.max(min, Math.min(max, mean + z * sigma)) * multiplier;
    return new Promise(resolve => setTimeout(resolve, delay));
}
```

### 7.6 M&A — Expansão

**Responsabilidades:**
- Seed Money: ao detectar nova colônia, sincronizar envios de múltiplas cidades
- Prioridade absoluta: Governor's Residence até corrupção = 0%
- Bloquear upgrades de grande porte enquanto corrupção > 0% na nova cidade

---

## 8. Estrutura de Arquivos

```
ikariam-erp/
├── manifest.json               # MV3, content_scripts, web_accessible
├── content/
│   └── content.js              # Bridge storage (postMessage ↔ chrome.storage)
├── inject/
│   └── inject.js               # Entry point (rodando em page context)
├── background/
│   └── background.js           # Notificações Chrome, service worker
├── modules/
│   ├── Events.js               # Pub/sub (on/once/off/emit/clear)
│   ├── Storage.js              # chrome.storage via postMessage bridge
│   ├── DataCollector.js        # XHR/fetch interceptor + AJAX probes
│   ├── StateManager.js         # Visão única da verdade (todas as cidades)
│   ├── GameClient.js           # Único ponto de saída de ações
│   ├── TaskQueue.js            # Fila JIT persistida com delay gaussiano
│   ├── CFO.js                  # ROI, fluxo de caixa, custo de oportunidade
│   ├── COO.js                  # Logística JIT, otimização de frete
│   ├── HR.js                   # Vinho, satisfação, alocação de workers
│   ├── CTO.js                  # Pesquisa, academia, redutores de custo
│   ├── CSO.js                  # Mimetismo, proteção, dispersão
│   ├── MnA.js                  # Expansão, seed money, nova colônia
│   └── Audit.js                # Reasoning logs, health monitor
├── data/
│   ├── const.js                # Constantes (Resources, Buildings, Research, etc.)
│   ├── buildings.js            # Tabela de custos por nível (até lvl 60+)
│   ├── wine.js                 # Tabela WINE_USE[0..47]
│   └── research.js             # IDs e categorias de todas as pesquisas
└── ui/
    ├── panel.html              # Dashboard executivo (5 views)
    ├── panel.js                # UI reativa, sem lógica de negócio
    └── panel.css               # Tema dark tipo Ikariam
```

---

## 9. Padrões Arquiteturais Obrigatórios

### 9.1 Timing

```javascript
// SEMPRE recursive setTimeout, NUNCA setInterval
function tick() {
    doWork();
    const delay = document.visibilityState === 'hidden' ? 300_000 : 60_000;
    setTimeout(tick, delay);
}

// Heartbeat adaptativo:
// - Tab em foco: 60s
// - Tab em background: 300s
// - Durante construção ativa: 250ms (detection loop)
// - Entre actions no GameClient: humanDelay(800, 2500)
```

### 9.2 Storage

```javascript
// Prefixo: IA_ERP_{server}_{world}_{avatarId}_{key}
// Ex: IA_ERP_br_s73_12345_taskQueue
function storageKey(name) {
    const m = location.host.match(/(s\d+)-([a-z]+)?\.ikariam/i);
    const world = m?.[1] ?? 's0';
    const server = m?.[2] ?? 'xx';
    const avatarId = window.ikariam?.model?.avatarId ?? '0';
    return `IA_ERP_${server}_${world}_${avatarId}_${name}`;
}
```

### 9.3 Parsing Seguro de HTML

```javascript
// SEMPRE remover .accesshint antes de ler textContent de custos
function parseCostFromLi(li) {
    li.querySelector('.accesshint')?.remove();
    return parseInt(li.textContent.trim().replace(/[.\s]/g, ''), 10);
}
```

### 9.4 Type Safety em Campos do Model

```javascript
// SEMPRE castear imediatamente ao ler do model
const tradegood    = Number(headerData?.producedTradegood ?? model.producedTradegood ?? 0);
const freeBoats    = Number(headerData?.freeTransporters ?? 0);
const wineCost     = Number(headerData?.wineSpendings ?? 0);
const cityId       = Number(relatedCityData?.selectedCityId ?? 0);
```

### 9.5 Guards Antes de Construir

```javascript
// Verificar ANTES de qualquer build:
// 1. Cidade atual = cidade da tarefa (currentCityId match)
// 2. Slot não está bloqueado por pesquisa (lockedPositions)
// 3. Cidade não está construindo (underConstruction === -1 || false)
// 4. Gold projetado em 12h > upkeep × 12 (CFO.canAfford())
```

---

## 10. Dashboard Executivo

### 10.1 Views Planejadas

| View | Conteúdo |
|------|---------|
| **Empire** | Mapa de cidades, gold/h total, satisfação global, alerta de corrupção |
| **Operations** | Fila de tarefas (TaskQueue), timeline de chegadas (COO), barcos em trânsito |
| **Finance** | ROI por upgrade pendente, fluxo de caixa 24h, custo de oportunidade |
| **Research** | Fila de pesquisa, pontos/h, próximo redutor de custo |
| **Log** | Reasoning logs (200 entradas), health monitor (data age por cidade) |

### 10.2 Regras de UI

- **Reason first**: toda ação exibida deve ter o "porquê" (reasoning log)
- **Health indicator**: badge colorido por cidade (verde < 5min, amarelo < 30min, vermelho > 30min desde última atualização)
- **Drag livre** com posição salva em localStorage
- Troca de aba **não** dispara fetch — apenas renderiza cache
- Status bar permanente no rodapé: `[Construindo: X | Frota: Y barcos | Última ação: Z]`
- Painel 720px, fonte 13px, tema dark

---

## 11. O Que NÃO Repetir (Bugs do Builder v5.0)

| Erro | Consequência | Regra para o ERP |
|------|-------------|-----------------|
| `producedTradegood` como string | Aritmética silenciosamente errada | Sempre `Number()` ao ler |
| `wineSpendings` do model.root | Divergência ~11% (ignora vinhedo) | Sempre de `headerData` |
| `getCityId()` via screen.screenId | CityId errado, ação na cidade errada | `selectedCityId` numérico direto |
| `isBuilding()` só via queue length | Pula cidade que está construindo | Checar `screen.data.underConstruction` |
| Action `'upgradeBuilding'` | 400/404 do servidor | `'UpgradeExistingBuilding'` (exato) |
| Build sem checar lockedPosition | Erro de slot bloqueado | Guard sempre antes de build |
| `capacity: 500` no transporte | Server rejeita | `capacity: 5` sempre |
| `islandId` origem no transporte | Barco vai para ilha errada | `islandId` = destino |
| Não navegar antes do Porto | `currentCityId` mismatch | Navegar + persistir fila |
| Parsing sem remover `.accesshint` | Números errados nos custos | `li.querySelector('.accesshint')?.remove()` |
| `setInterval` em heartbeats | Não adapta ao foco/background | Recursive `setTimeout` sempre |
| Sem prefixo de servidor no storage | Conflito multi-conta | `IA_ERP_{server}_{world}_{id}_{key}` |

---

## 12. Matriz de ROI — Algoritmo de Prioridade de Construção

### 12.1 Score de Prioridade (0–100)

Cada edifício recebe um score calculado em tempo real. A TaskQueue ordena por score decrescente.

| Edifício | Peso Base | Gatilho de Elevação | Score Máximo |
|----------|-----------|---------------------|--------------|
| Governor's Residence / Palace | variável | corrupção > 1% → 100 | 100 |
| Carpentry (Carpintaria) | 90 | fila futura de madeira > 500k → mantém 90 | 90 |
| Architect's Office | 85 | fase de expansão (edifícios nível 20+) → mantém 85 | 85 |
| Academy | 60 | pesquisa "Future" ou redutor de custo a < 48h → 95 | 95 |
| Trading Port | 50 | tempo de carregamento full > 30min → 80 | 80 |
| Governor's Residence / Palace | 10 | corrupção = 0% → cai para 10 | 10 |

**Fórmula do score dinâmico:**
```
score(building, cityState) = baseWeight(building)
    + corruptionBonus(cityState)       // +90 se corruption > 0.01
    + woodQueueBonus(cityState)        // +0..+10 proporcional à fila de madeira futura
    + expansionBonus(cityState)        // +0 ou fixo se avg building level ≥ 20
    + researchProximityBonus()         // +35 se pesquisa econômica a < 48h
    + portLoadBonus(cityState)         // +30 se loading time > 1800s
```

### 12.2 Cálculo de Fila de Madeira Futura

```
woodQueue = Σ cost_wood(building, targetLevel)
            para cada (building, targetLevel) na fila de metas desta cidade

Se woodQueue > 500_000 → Carpentry.score += max(0, 10 × (woodQueue / 500_000 - 1))
                          (capped em 90)
```

### 12.3 Custo de Oportunidade: Produzir vs. Comprar

O CFO executa este cálculo antes de manter trabalhadores alocados em minas:

```
valorTrabalhadorMina =
    (producao_por_hora × precoMercado_recurso) - salario_por_hora

valorTrabalhadorLivre =
    goldPerCitizen_per_hour   // ouro gerado por cidadão livre (taxa de imposto)

Se valorTrabalhadorLivre > valorTrabalhadorMina:
    → demitir trabalhador (mover para cidadãos livres)
    → emitir WORKER_REALLOC task
    → reasoning: "ROI mineiro < ROI cidadão livre. Comprando recurso no mercado."
```

**Preço de mercado:** lido do endpoint de mercado se disponível; fallback = valor configurável pelo usuário (padrão: 0 = feature desabilitada até confirmação do endpoint).

---

## 13. Supply Chain: Hub & Spoke

### 13.1 Identificação do Hub (Centro de Distribuição)

```
hubScore(city) = portLevel(city) × 2 + warehouseLevel(city)
Hub = cidade com maior hubScore entre todas as cidades da conta
```

Em caso de empate: capital tem prioridade. Hub é recalculado a cada `fetchAllCities`.

### 13.2 Fluxo Push (Periférica → Hub)

- **Estoque de segurança periférico:** custo da próxima obra desta cidade × 1.1 (buffer 10%)
- **Excedente** = `currentResources - stockSecurity`
- Se `excedente > 0` e `hubCity.freeSpace > excedente`:
  - Emite TRANSPORT task: periférica → hub
  - `scheduledFor = now` (imediato)
  - Frequência máxima: 1 push a cada 4h por rota (evitar spam)

### 13.3 Fluxo Pull (Hub → Cidade Construtora)

```
Quando CFO aprova próxima obra em cidadeX:
    custoObra = fetchCosts(building, position, cityX)
    recursosDisponiveis = cityX.resources
    deficit = max(0, custoObra[res] - recursosDisponiveis[res]) para cada res

    Para cada recurso com deficit > 0:
        fonte = hub (ou cidade com maior excedente desse recurso)
        travelTime = calcTravelTime(fonte, cityX)  // ver seção 14
        buildStartTs = cityX.underConstructionFinishTs ?? StateManager.getServerNow()
        dispatchTs = buildStartTs - travelTime - SAFETY_BUFFER_S  // 300s de margem

        TaskQueue.add({
            type: TRANSPORT,
            scheduledFor: dispatchTs,
            fromCityId: fonte.id,
            toCityId: cityX.id,
            cargo: deficit,
            reason: `JIT para ${building} em ${cityX.name}: chega ${travelTime}s antes do início`
        })
```

### 13.4 Regra 90% de Carga

```
boatsNeeded = ceil(totalCargo / (500 × boatCapacityMultiplier))
boatsAvailable = hub.freeTransporters

Se boatsAvailable < boatsNeeded:
    cargoFit = floor(boatsAvailable × 500 × boatCapacityMultiplier)
    Se cargoFit / totalCargo < 0.9:
        → aguardar retorno de barcos (re-agendar scheduledFor += estimatedReturnTime)
        → EXCETO se é emergência de vinho (wineEmergency = true)
```

---

## 14. Logística JIT — Fórmulas de Tempo (Matemática Real)

### 14.1 Tempo de Carregamento

**Fórmula exata:**
```
T_carga (segundos) = (R / V) × 60

Onde:
    R = total de recursos carregados (soma de todos os bens)
    V = velocidade de carregamento do porto (unidades/minuto)
```

**Tabela de velocidade V por nível de porto** — completa, confirmada via wiki in-game:
```javascript
// data/const.js
// Velocidade de carregamento por nível de porto (Bens/minuto)
// Fonte: aba de Ajuda in-game (ikipedia), confirmado nível 14=768 e 15=870 via DOM ao vivo
// IMPORTANTE: estes são valores BASE por porto individual.
// Cidade com 2 portos (nível A + nível B) → velocidade total = PORT_SPEED[A] + PORT_SPEED[B]
const PORT_LOADING_SPEED = {
     1:    10,
     2:    18,
     3:    28,
     4:    40,
     5:    54,
     6:    70,
     7:    88,
     8:   108,
     9:   118,
    10:   130,
    11:   510,
    12:   588,
    13:   672,
    14:   768,
    15:   870,
    16:   984,
    17:  1110,
    18:  1248,
    19:  1398,
    20:  1566,
    21:  1746,
    22:  1950,
    23:  2172,
    24:  2418,
    25:  2682,
    26:  2982,
    27:  3306,
    28:  3660,
    29:  4056,
    30:  4488,
    31:  4962,
    32:  5490,
    33:  6066,
    34:  6696,
    35:  7392,
    36:  8160,
    37:  9006,
    38:  9930,
    39: 10950,
    40: 12072,
    41: 13308,
    42: 14664,
    43: 16158,
    44: 17802,
    45: 19608,
    46: 21600,
    47: 23784,
    48: 26190,
    49: 28836,
    50: 31746,
    51: 34950,
    52: 38466,
    53: 42342,
    54: 46602,
    55: 51294,
    56: 56448,
    57: 62118,
    58: 68358,
    59: 75222,
    60: 82770,
};

// ATENÇÃO: salto anômalo entre nível 10 (130) e nível 11 (510)
// Níveis 1–10 são a progressão inicial do porto "básico"
// Níveis 11+ requerem pesquisa "Doca" — provavelmente porto de nível 2 (segundo slot)
// Na prática: cidade com 1 porto nível 10 = 130/min
//             cidade com 2 portos (10+11) = 130 + 510 = 640/min  (BAD M: 14+15 = 768+870 = 1638 ✓)

function getPortSpeed(level) {
    return PORT_LOADING_SPEED[level] ?? PORT_LOADING_SPEED[Math.min(level, 60)];
}

function getCityLoadingSpeed(buildings) {
    // Soma a velocidade de todos os portos da cidade
    return buildings
        .filter(b => b.buildingId === Buildings.PORT)
        .reduce((sum, b) => sum + getPortSpeed(b.level), 0);
}
```

**Como obter V em runtime:**
- Fonte primária: `getCityLoadingSpeed(city.buildings)` — soma todos os portos
- Fonte secundária: DOM `#js_loadingSpeedSumValue` ao visitar o porto (já inclui bônus de governo/maravilha)

**Alerta de performance:**
```
Se T_carga > 1800s (30min para carga full):
    → Trading Port score += 30  // sobe prioridade de upgrade
    → reasoning: "Porto nível ${level}: carregamento full leva ${min}min. Upgrade reduz para ${newMin}min."
```

### 14.2 Tempo de Viagem

**Fórmula exata:**
```
D = sqrt((X2 - X1)² + (Y2 - Y1)²)   // distância euclidiana entre ilhas

T_viagem (segundos) =
    Se mesma ilha: SAME_ISLAND_TRAVEL_S  // ~600–1200s (fixo, depende do servidor)
    Se ilhas diferentes: D × WORLD_SPEED_CONSTANT + DEPARTURE_FIXED_S
```

**Constantes — variam por servidor (mundo 1x, 2x, 4x):**
```javascript
const TRAVEL = {
    // DEPARTURE_FIXED_S: tempo de manobra fixo independente da distância
    // Confirmado: 1200s (20min) em mundos 1x
    // Em mundos 2x: ~600s | Em mundos 4x: ~300s
    DEPARTURE_FIXED_S:  1200,

    // WORLD_SPEED_CONST: segundos por unidade de distância euclidiana
    // Deve ser calibrado por servidor com a fórmula abaixo
    WORLD_SPEED_CONST:  null,   // null = requer calibração antes de usar JIT preditivo

    SAME_ISLAND_S:      900,    // estimativa — substituir por journeyTime do AJAX se disponível
};
```

**Procedimento de calibração (executar uma vez por conta/servidor):**
```
1. Anotar coordenadas de duas cidades: (X1,Y1) e (X2,Y2)
   → Fonte: relatedCityData[cityId].coords ou DOM da câmara municipal

2. Calcular distância euclidiana:
   D = sqrt((X2-X1)² + (Y2-Y1)²)

3. Abrir view=transport, selecionar destino, capturar do AJAX:
   journeyTime (segundos) — campo na response do servidor

4. Calcular a constante:
   WORLD_SPEED_CONST = (journeyTime - DEPARTURE_FIXED_S) / D

5. Validar com 2 pares diferentes de cidades para confirmar consistência

6. Salvar no Storage: Storage.set('worldSpeedConst', valor)
   → DataCollector carrega na inicialização
```

**Como obter coordenadas das cidades:**
- `relatedCityData[cityId].coords` ou equivalente no model
- Armazenar em `CityState.coords: [x, y]` no StateManager uma única vez
- Coordenadas nunca mudam — cachear permanentemente

**Comportamento antes da calibração:**
```javascript
function calculateTravelTime(origin, dest) {
    if (!TRAVEL.WORLD_SPEED_CONST) {
        // Constante não calibrada: usar arrivalTs do servidor quando disponível
        // Para planejamento preditivo: bloquear JIT e alertar no Dashboard
        Audit.warn('TRAVEL_CONST_NOT_CALIBRATED', 'JIT preditivo desabilitado até calibração.');
        return null;
    }
    // ... cálculo normal
}
```

### 14.3 Função calculateEta (COO)

```javascript
function calculateEta(originCity, destCity, totalCargo) {
    const portLevel = getBuildingLevel(originCity, Buildings.PORT);
    const V = PORT_LOADING_SPEED[portLevel] ?? PORT_LOADING_SPEED[1];

    const loadingTime = Math.ceil((totalCargo / V) * 60);

    let travelTime;
    if (originCity.islandId === destCity.islandId) {
        travelTime = TRAVEL.SAME_ISLAND_S;
    } else {
        const dx = destCity.coords[0] - originCity.coords[0];
        const dy = destCity.coords[1] - originCity.coords[1];
        const D  = Math.sqrt(dx * dx + dy * dy);
        travelTime = Math.ceil(D * TRAVEL.WORLD_SPEED_CONST + TRAVEL.DEPARTURE_FIXED_S);
    }

    return {
        loadingTime,    // segundos de carregamento
        travelTime,     // segundos de viagem
        totalEta: loadingTime + travelTime,  // da ordem ao atracamento
    };
}
```

### 14.4 Sincronização JIT

```javascript
function calcDispatchTs(buildFinishTs, originCity, destCity, cargo) {
    const { totalEta } = calculateEta(originCity, destCity, cargo);
    const SAFETY_BUFFER_S = 300;  // 5min de margem

    const dispatchTs = buildFinishTs - totalEta - SAFETY_BUFFER_S;

    // Se já passou do momento ideal: enviar agora (melhor tarde que nunca)
    return Math.max(dispatchTs, StateManager.getServerNow());
}
```

---

## 15. Mercado e Arbitragem (MarketArbitrage)

### 15.1 Coleta de Preços (MarketPriceCache)

**Endpoint:** `/index.php?view=branchOffice&cityId=X&ajax=1`

```javascript
MarketPriceCache = {
    prices: Map<resource, OfferList>,
    // OfferList = [{ price, amount, distanceIslands, sellerId }, ...]
    fetchedAt: Number,
    TTL: 3_600_000,   // 1 hora (mercado é volátil)
}
```

**Estratégia de scraping:**
- Visitar mercado 1× por hora por hub (não por cidade — evitar spam)
- Registrar como NOISE task para mimetismo (aparência de visita manual)
- Filtrar ofertas com `distanceIslands > MAX_MARKET_DISTANCE` (default: 10 ilhas)

### 15.2 Preço Médio Ponderado por Distância

```javascript
function getWeightedAvgPrice(resource, maxDistance = 10) {
    const offers = MarketPriceCache.prices.get(resource) ?? [];

    const nearby = offers.filter(o => o.distanceIslands <= maxDistance);
    if (nearby.length === 0) return null;  // sem dados → usar fallback

    const totalAmount = nearby.reduce((s, o) => s + o.amount, 0);
    const weightedSum = nearby.reduce((s, o) => s + o.price * o.amount, 0);

    return weightedSum / totalAmount;  // preço médio ponderado por volume
}
```

### 15.3 Decisão Produzir vs. Comprar

```javascript
function shouldBuyFromMarket(resource, city) {
    const marketPrice = getWeightedAvgPrice(resource);
    const userMaxPrice = Config.maxBuyPrice[resource];  // configurável, default: Infinity (desabilitado)

    if (!marketPrice || marketPrice > userMaxPrice) return false;  // mercado caro ou sem dados

    // Valor do trabalhador na mina
    const productionPerHour   = city.production[resource];        // unidades/h
    const workerSalaryPerHour = city.economy.goldPerCitizen / city.workers[resource];  // ouro/h por minerador
    const valueProduced       = productionPerHour * marketPrice;  // "receita" equivalente em ouro/h

    // Valor do trabalhador livre
    const goldPerFreeCitizen  = city.economy.goldPerCitizen;      // ouro/h por cidadão livre

    if (goldPerFreeCitizen > valueProduced - workerSalaryPerHour) {
        return {
            buy: true,
            reason: `ROI mineiro ${(valueProduced - workerSalaryPerHour).toFixed(0)} < ROI cidadão livre ${goldPerFreeCitizen.toFixed(0)}. Comprando ${resource} no mercado.`,
        };
    }
    return false;
}
```

### 15.4 Proteção contra Inflação de Guerra

```javascript
// Se preço de mercado > userMaxPrice → não comprar, não demitir mineiro
// reasoning: "Preço de ${resource} (${price}) acima do teto configurado (${max}). Mantendo produção própria."
```

---

## 16. Módulo CSO — Proteção de Capital (Detalhado)

### 16.1 Cálculo de Exposição

```
capitalAtRisk(city) = Σ max(0, currentResources[res] - safeCapacity[res])
                      para cada recurso

safeCapacity = 100 + 480 × warehouseLevel

warshipCostGold ≈ 40_000  // custo aproximado de 1 navio de guerra (placeholder — confirmar)

Se capitalAtRisk > warshipCostGold → acionar protocolo de proteção
```

### 16.2 Protocolo de Proteção (Prioridade Decrescente)

```
1. GASTO IMEDIATO
   Se há upgrade pendente que consome o recurso em risco:
       → score do upgrade → 100 (urgente)
       → reasoning: "Capital em risco. Antecipando upgrade para consumir excesso."

2. DISPERSÃO LOGÍSTICA (Trade-Fleet Ghosting)
   → emitir TRANSPORT imediato para hub (ou cidade mais segura)
   → reasoning: "Dispersando excedente para ${safe.name}: maior armazém e muralha."

3. GOLD ESCROW (Ghosting de Ouro via Mercado)
   → criar oferta de venda: 1 enxofre por goldAtRisk de ouro
   → preço absurdo garante que ninguém compra organicamente
   → ouro "sai" do caixa saqueável e fica travado na oferta
   → após ataque: cancelar oferta → ouro retorna instantaneamente
   → reasoning: "Escrow: ${gold} ouro ocultado em oferta de mercado até ataque passar."
```

**Payload de criar oferta (confirmado via inspetor de rede):**
```javascript
// Fonte: POST capturado em view=branchOffice → aba "Minhas Ofertas" → criar oferta manual
{
    action:       'CityScreen',        // EXATO
    function:     'createOffer',       // EXATO
    resourceId:   4,                   // 1=madeira, 2=vinho, 3=mármore, 4=cristal, 5=enxofre
                                       // usar 5 (enxofre) para ghosting — recurso menos crítico
    amount:       1,                   // 1 unidade (quantidade mínima)
    price:        goldToHide,          // preço = ouro que queremos retirar do caixa
    cityId:       String(cityId),
    backgroundView: 'city',
    currentCityId:  String(cityId),
    actionRequest:  token,
    ajax:           1,
}

// Para cancelar a oferta após o ataque:
{
    action:       'CityScreen',
    function:     'deleteOffer',       // a confirmar — pode ser 'cancelOffer' ou 'removeOffer'
    offerId:      offerIdRetornado,    // ID retornado na resposta do createOffer
    cityId:       String(cityId),
    backgroundView: 'city',
    currentCityId:  String(cityId),
    actionRequest:  token,
    ajax:           1,
}
```

**Lógica completa do Gold Escrow:**
```javascript
async function activateGoldEscrow(city, goldAmount) {
    // 1. Criar oferta: 1 enxofre por goldAmount de ouro
    const createResp = await GameClient.request('/index.php', {
        action:         'CityScreen',
        function:       'createOffer',
        resourceId:     5,          // enxofre
        amount:         1,
        price:          goldAmount,
        cityId:         String(city.id),
        backgroundView: 'city',
        currentCityId:  String(city.id),
        actionRequest:  GameClient.getToken(),
        ajax:           1,
    });

    // 2. Extrair offerId da resposta para poder cancelar depois
    const offerId = createResp.find(c => c[0] === 'updateTemplateData')?.[1]?.offerId;

    // 3. Persistir no Storage para recuperar após reload
    await Storage.set(`escrow_${city.id}`, { offerId, gold: goldAmount, createdAt: Date.now() });

    Audit.log('GOLD_ESCROW_ACTIVE', `${goldAmount} ouro ocultado em oferta de mercado. OfferId: ${offerId}`);
    return offerId;
}

async function releaseGoldEscrow(city) {
    const escrow = await Storage.get(`escrow_${city.id}`);
    if (!escrow) return;

    await GameClient.request('/index.php', {
        action:         'CityScreen',
        function:       'deleteOffer',   // confirmar nome exato via inspetor
        offerId:        escrow.offerId,
        cityId:         String(city.id),
        backgroundView: 'city',
        currentCityId:  String(city.id),
        actionRequest:  GameClient.getToken(),
        ajax:           1,
    });

    await Storage.remove(`escrow_${city.id}`);
    Audit.log('GOLD_ESCROW_RELEASED', `${escrow.gold} ouro recuperado após ataque.`);
}
```

> **ATENÇÃO:** `resourceId` usa escala diferente de `cargo_tradegoodX`:
> - No payload de transporte: `cargo_tradegood4` = enxofre (ordinal 4)
> - No payload de mercado: `resourceId: 5` = enxofre (índice base-1 com madeira=1)
> - Confirmar `resourceId` exato via inspetor ao criar oferta de enxofre

### 16.3 Trade-Fleet Ghosting (Recursos)

**Timing de saída:**
```javascript
function calcFleetGhostDispatch(attackArrivalTs) {
    // Sair 1 minuto antes do impacto
    // Recursos no mar são invulneráveis
    return attackArrivalTs - 60;
}

// Destino: qualquer cidade aliada que aceite a carga
// Missão: transport normal
// Após ataque passar: emitir RETURN_FLEET task
// Trigger de retorno: attackArrivalTs + estimatedAttackDuration (default: 1800s)
```

### 16.4 Monitoramento de Ameaças

```javascript
// Frequência normal: militaryAdvisor a cada 30min
// Frequência de alerta: a cada 5min se ameaça ativa com ETA < 2h

const ameacaAtiva = fleetMovements.filter(m =>
    m.isHostile &&
    m.destinationCityId === minhaCidade &&
    m.arrivalTs < StateManager.getServerNow() + 7200
);

if (ameacaAtiva.length > 0) {
    militaryAdvisorInterval = 300_000;   // 5min
    CSO.activateDefenseProtocol(ameacaAtiva);
    chrome.notifications.create({ title: `Ataque em ${city.name}`, message: `ETA: ${eta}min` });
}
```

---

## 17. Protocolo M&A — Manual de Integração de Nova Filial

### 17.1 Detecção de Nova Colônia

```javascript
// Nova cidade aparece em relatedCityData sem histórico no StateManager
if (!StateManager.cities.has(cityId) && cityId in relatedCityData) {
    MnA.onNewColony(cityId);
    TaskQueue.blockCity(cityId, 'MA_ALPHA');  // bloqueia tudo exceto Governor's Residence
}
```

### 17.2 Fase Alpha — Eliminar Corrupção

```
HARD_LIMIT_WOOD = 5_000

Enquanto corruption > 0:
    Única obra permitida: Governor's Residence (próximo nível)
    Qualquer outra obra com custo > HARD_LIMIT_WOOD → bloqueada

reasoning: "M&A Fase Alpha: corrupção ${pct}%. Nenhuma obra > 5k madeira até corrupção = 0%."
```

### 17.3 Subsídio Cruzado (Seed Money)

```javascript
// Taxar 10% do excedente de madeira de cada cidade existente
for (const city of StateManager.getAllCities()) {
    if (city.id === newColony.id) continue;

    const security = city.nextBuildCost?.wood ?? 0;
    const surplus  = city.resources.wood - security;
    const contrib  = Math.min(surplus * 0.10, city.freeTransporters * 500);

    if (contrib > 100) {
        TaskQueue.add({
            type:      'TRANSPORT',
            fromCityId: city.id,
            toCityId:   newColony.id,
            cargo:      { wood: contrib },
            reason:    `Subsídio M&A para ${newColony.name}: ${contrib} madeira (10% excedente)`,
        });
    }
}
// Frequência: 1 rodada de subsídio a cada 8h até corrupção = 0%
```

### 17.4 Fase Beta — Foco em Porto e Residência (após corrupção = 0%)

```
Prioridades fixas (nesta ordem):
    1. Port → nível 10
    2. Governor's Residence → nível suficiente para 0% corrupção
    3. Town Hall → nível de workers
    4. Warehouse → nível 5

Regra: trabalhadores de luxo PROIBIDOS até Porto nível 10
Modo: máximo cidadãos livres → impostos → financiar investimento inicial
reasoning: "M&A Fase Beta: ${newColony.name} operando como fábrica de ouro até Porto 10."
```

