# Ikariam JavaScript Model — Mapa Completo

> Documento de referência universal — válido para qualquer conta/servidor.
> Exemplos de valores usam placeholders: `{cityId}`, `{avatarId}`, `{token}`, etc.
> Última atualização: 2026-03-18

---

## Como acessar

```javascript
// Objeto raiz do jogo
ikariam                                          // ~82 chaves top-level

// Model principal (atualizado a cada 15s via periodicDataRefresh)
ikariam.model                                    // ~50 chaves

// Dados detalhados da cidade atual
ikariam.backgroundView.screen.data               // islandId, position[], construção, etc.

// Dados da view/diálogo aberto atualmente
ikariam.templateView.script.params               // objeto estruturado (maioria dos edifícios)
ikariam.templateView.mainbox.contentEls          // HTML bruto (fallback — port, warehouse, etc.)
```

---

## `ikariam.model` — Campos Relevantes

| Campo | Tipo | Exemplo | Notas |
|-------|------|---------|-------|
| `actionRequest` | string | `"{token}"` | CSRF token — obrigatório em todo POST |
| `serverTime` | number | Unix ts (s) | Tempo atual do servidor |
| `requestTime` | number | Unix ts (s) | Igual a serverTime no momento da resposta |
| `initialBrowserTime` | number | Unix ts (ms) | Timestamp do browser no carregamento |
| `initialServerTime` | number | Unix ts (ms×1000) | Em milissegundos — dividir por 1000 |
| `realHour` | number | `3600` | Segundos por hora real (constante) |
| `currentResources` | object | ver abaixo | Recursos da cidade atual |
| `maxResources` | object | ver abaixo | Capacidade máxima do armazém |
| `maxResourcesWithModifier` | object | igual a maxResources | Com bônus de edifícios |
| `branchOfficeResources` | object | todos 0 | Recursos no escritório comercial |
| `resourceProduction` | number | float (unidades/s) | Produção de madeira por segundo |
| `tradegoodProduction` | number | float (unidades/s) | Produção do tradegood por segundo |
| `producedTradegood` | string | `"1"` a `"4"` | Tipo de tradegood ⚠️ STRING na raiz (headerData tem number) |
| `upkeep` | number | negativo | Custo de manutenção por hora |
| `income` | number | float | Renda bruta de ouro por hora |
| `wineSpendings` | number | inteiro | Consumo de vinho/h ⚠️ menos confiável que headerData |
| `wineTickInterval` | number | `3600` | Intervalo de check de vinho (s) |
| `cityProducesWine` | bool | `true`/`false` | A cidade atual produz vinho? |
| `isOwnCity` | bool | `true`/`false` | Cidade própria? |
| `relatedCityData` | object | ver abaixo | Lista de cidades + selectedCity |
| `headerData` | object | ver abaixo | **Fonte autoritativa** para a maioria dos dados |
| `woodCounter` | object | `{timer:{...}}` | Timer de madeira — production, startRes, serverTimeDiff |
| `tradegoodCounter` | object | `{timer:{...}}` | Timer do tradegood |
| `wineCounter` | null/object | `null` se não produz | Timer de vinho |
| `nextETA` | number | Unix ts (s) | Próximo evento agendado |
| `titleCounter` | object | `{enddate:...}` | Timer do título na aba do browser |
| `hasAlly` | bool | `true`/`false` | Tem aliança? |
| `advisorData` | object | ver abaixo | Links e status dos advisors |
| `specialEvent` | number | `0` | Evento especial ativo (0 = nenhum) |
| `viewParams` | object | coordenadas | Posição do painel na UI |
| `shortcuts` | array | `[]` | Atalhos configurados pelo jogador |
| `badTaxAccountant` | number | `0` | Penalidade fiscal |
| `godGoldResult` | number | `0` | Bônus do deus |
| `scientistsUpkeep` | number | inteiro | Custo de cientistas |
| `avatarId` | number | inteiro | ID numérico do jogador atual |

---

## `currentResources` e `maxResources`

```javascript
ikariam.model.currentResources = {
  "resource": {number},  // Madeira
  "1":        {number},  // Wine
  "2":        {number},  // Marble
  "3":        {number},  // Crystal/Glass
  "4":        {number},  // Sulfur (comprado, não produzido aqui)
  "citizens": {number},
  "population": {number}
}

ikariam.model.maxResources = {
  "resource": {number},  // Madeira max (= capacidade do armazém)
  "0":        {number},  // (não usado diretamente)
  "1":        {number},  // Wine max
  "2":        {number},  // Marble max
  "3":        {number},  // Crystal max
  "4":        {number},  // Sulfur max
  // Todos os valores são iguais — é a capacidade geral do armazém
}
```

**IDs dos recursos — mapeamento universal:**
| Chave no model | Recurso | resName interno | sufixo DOM | resourceId (mina) |
|----------------|---------|-----------------|------------|-------------------|
| `resource` | Madeira | `wood` | `wood` | `resourceMine` |
| `1` | Wine | `wine` | `wine` | `tradegoodWineMine` |
| `2` | Marble | `marble` | `marble` | `tradegoodMarbleMine` |
| `3` | Crystal | `glass` ⚠️ | `glass` ⚠️ | `tradegoodCrystalMine` |
| `4` | Sulfur | `sulfur` | `sulfur` | `tradegoodSulfurMine` |

> ⚠️ Crystal usa `glass` como sufixo em **todos** os IDs DOM do jogo e internamente no builder.
> `GLASS === CRYSTAL` — são o mesmo recurso, dois nomes.

> **Nunca usar nome de cidade como identificador** — é definido pelo jogador e pode mudar.
> Usar sempre o `id` numérico (`relatedCityData.selectedCityId`, `backgroundView.screen.data.id`).

---

## `headerData` — Fonte Autoritativa

> Sempre preferir `headerData` sobre campos duplicados na raiz do model.

```javascript
ikariam.model.headerData = {
  ambrosia:            {number},   // ambrosia disponível
  gold:                "{string}", // ⚠️ gold é STRING
  freeTransporters:    {number},   // transportadores livres — SÓ AQUI (ausente na raiz)
  maxTransporters:     {number},   // total de transportadores
  freeFreighters:      {number},   // cargueiros livres
  maxFreighters:       {number},
  scientistsUpkeep:    {number},
  income:              {number},
  upkeep:              {number},   // negativo
  godGoldResult:       {number},
  wineSpendings:       {number},   // ✅ valor correto (raiz pode diferir)
  badTaxAccountant:    {number},
  adVideoHappeningActive: {0|1},
  maxActionPoints:     {number},
  producedTradegood:   {number},   // ✅ NUMBER (raiz entrega STRING)
  currentResources:    { ... },    // igual a model.currentResources
  maxResources:        { ... },
  relatedCity:         { owncity: {0|1} },
  advisors:            { ... },
  cityDropdownMenu:    { ... }     // ⚠️ NÃO tem selectedCityId
}
```

**Inconsistências raiz vs headerData:**
| Campo | Raiz | headerData | Usar |
|-------|------|-----------|------|
| `wineSpendings` | pode divergir | valor correto | **headerData** |
| `producedTradegood` | STRING `"2"` | NUMBER `2` | **headerData** |
| `freeTransporters` | ausente | presente | **headerData** |

---

## `relatedCityData` — Cidades do Jogador

```javascript
ikariam.model.relatedCityData = {
  "city_{id}": {
    id:           {cityId},       // ID numérico — usar como identificador
    name:         "{string}",     // ⚠️ definido pelo jogador — NÃO usar como ID
    coords:       "[XX:YY]",      // coordenadas da ilha
    tradegood:    {1|2|3|4},      // tipo de tradegood produzido
    islandId:     {number},       // ⚠️ NEM SEMPRE presente aqui — ver nota abaixo
    relationship: "ownCity",      // "ownCity" | "foreign" | etc.
  },
  // ... uma entrada por cidade própria
  additionalInfo:  "tg",
  selectedCity:    "city_{id}",   // chave string da cidade atual
  selectedCityId:  {cityId}       // ✅ ID numérico — SÓ EXISTE AQUI
}
```

> `cityDropdownMenu` em `headerData` tem as mesmas cidades mas **NÃO tem `selectedCityId`**.
> `selectedCityId` só existe em `relatedCityData`.

> ⚠️ `relatedCityData` é um **objeto**, não array. Chaves no formato `"city_6582"`.
> `selectedCity` (não `selectedCityId`) contém a chave ativa ex: `"city_6582"`.
> Confirmado ao vivo 2026-03-28.

> ⚠️ `islandId` pode não estar presente em `relatedCityData`.
> Fonte confiável para islandId: GET `view=transport` → HTML do form (`name="islandId" value="..."`).
> Ou navegar para a cidade e ler `backgroundView.screen.data.islandId`.

---

## `ikariam.backgroundView.screen.data` — Cidade Atual

```javascript
ikariam.backgroundView.screen.data = {
  id:               {cityId},      // ID numérico da cidade atual
  name:             "{string}",    // nome — não usar como ID
  islandId:         {number},      // ✅ ilha da cidade — essencial para transporte
  isCapital:        {bool},        // true somente na capital
  phase:            {number},
  position:         [ /* 25 slots */ ],  // ver seção abaixo
  underConstruction: {slot|false|-1},   // slot em construção, false ou -1 = nenhum
  endUpgradeTime:   {Unix ts|null},     // quando termina a construção
  startUpgradeTime: {Unix ts|null},
  lockedPosition:   { "{slot}": "{motivo}" },  // slots bloqueados por pesquisa
  cityLeftMenu:     { visibility: { ... } },
}
```

> `islandId` NÃO está em `headerData.cityDropdownMenu`.
> Para cidades que não são a atual: navegar até elas e ler `screen.data.islandId`.

---

## `position[]` — Slots de Construção

```javascript
// 25 slots por cidade, indexados de 0 a 24
ikariam.backgroundView.screen.data.position[i] = {
  position:         {number},       // índice do slot (= parâmetro ?position= na URL)
  buildingId:       {number},       // ID do edifício (0 = townHall, -1 = vazio)
  name:             "{string}",     // nome interno (ex: "townhall", "port")
  level:            {number},
  isBusy:           {bool},         // true = unidade sendo treinada (NÃO construção de edifício)
  canUpgrade:       {bool},
  groundId:         {number},       // tipo do terreno (ver tabela abaixo)
  allowedBuildings: [ {buildingId}, ... ]
}
```

> ⚠️ `isBusy = true` indica **unidade em treino** no edifício, não construção.
> Construção de edifício é indicada por `underConstruction = slot` no nível acima.

**`groundId` — Tipos de slot:**
| groundId | Tipo | Edifícios permitidos |
|----------|------|---------------------|
| 0 | Principal | só townHall |
| 1 | Marítimo | port, shipyard |
| 2 | Terreno normal | maioria dos edifícios |
| 3 | Muralha | wall |
| 4 | Mar | edifícios navais |

**Mapeamento `buildingId` → nome interno:**
| buildingId | name (CSS/interno) |
|-----------|-------------------|
| 0 | `townHall` |
| 3 | `port` |
| 4 | `academy` |
| 5 | `shipyard` |
| 6 | `barracks` |
| 7 | `warehouse` |
| 8 | `wall` |
| 9 | `tavern` |
| 10 | `museum` |
| 11 | `palace` |
| 12 | `embassy` |
| 13 | `branchOffice` |
| 16 | `safehouse` |
| 17 | `palaceColony` |
| 18 | `forester` |
| 19 | `stonemason` |
| 20 | `glassblowing` |
| 21 | `winegrower` |
| 22 | `alchemist` |
| 23 | `carpentering` |
| 24 | `architect` |
| 25 | `optician` |
| 26 | `vineyard` |
| 27 | `fireworker` |
| 29 | `dump` |
| 30 | `pirateFortress` |
| 31 | `blackMarket` |
| 32 | `marineChartArchive` |

---

## `lockedPosition` — Slots Bloqueados por Pesquisa

```javascript
backgroundData.lockedPosition = {
  "{slot}": "{mensagem de pesquisa necessária}"
  // ex: "13": "Para construir aqui precisas de pesquisar \"Burocracia\""
}
// Ausente ou objeto vazio = nenhum slot bloqueado
```

> Verificar antes de tentar construir — slot bloqueado retorna erro silencioso.

---

## `ikariam.templateView` — Diálogo Aberto

```javascript
// Maioria dos edifícios — objeto estruturado:
ikariam.templateView.script.params   // objeto JSON com dados do edifício

// Porto, warehouse e outros — retorna null:
ikariam.templateView.script.params   // null → usar HTML bruto:
ikariam.templateView.mainbox.contentEls  // coleção de elementos DOM
```

---

## Woodcounter / Timer de Recursos

```javascript
ikariam.model.woodCounter.timer = {
  serverTimeDiff:   {number (ms)},  // offset browser - servidor em ms (pode ser negativo)
  currenttime:      {Unix ts ms},   // timestamp atual em ms
  updatefrequency:  1000,           // atualiza a cada 1s
  ls:               {Unix ts s},    // last server time (s)
  startDate:        {Unix ts ms},   // quando começou a contar (ms)
  watchedResource:  "resource",     // "resource" para madeira, "1"-"4" para tradegoods
  production:       {float},        // unidades/segundo
  startRes:         {number},       // recurso no startDate
  updateImmediately: false,
  tm:               {number}        // tempo decorrido (ms)
}

// Cálculo do recurso atual:
// currentRes = startRes + production * (currentTime - startDate) / 1000
```

> `serverTimeDiff` é o offset mais atualizado para cálculo de tempo do servidor.
> Mais preciso que recalcular a partir de `initialBrowserTime` / `initialServerTime`.

---

## Transporte — Payload Confirmado

```javascript
// POST para /index.php
{
  action:                "transportOperations",
  function:              "loadTransportersWithFreight",
  destinationCityId:     {toCityId},    // ID numérico da cidade destino
  islandId:              {toIslandId},  // ⚠️ ilha do DESTINO (não da origem!)
  normalTransportersMax: {freeTransporters},
  premiumTransporter:    0,
  capacity:              {0-5},         // slider de capacidade por barco (0 a 5)
  max_capacity:          5,             // ⚠️ SEMPRE 5 (não 500)
  jetPropulsion:         0,
  cargo_resource:        {number},      // madeira
  cargo_tradegood1:      {number},      // wine
  cargo_tradegood2:      {number},      // marble
  cargo_tradegood3:      {number},      // crystal
  cargo_tradegood4:      {number},      // sulfur
  backgroundView:        "city",
  currentCityId:         {fromCityId},  // ⚠️ DEVE ser a cidade atual da sessão
  templateView:          "transport",
  currentTab:            "tabSendTransporter",
  actionRequest:         "{token}",     // CSRF token atual
  ajax:                  1,
}
```

**Armadilhas críticas:**
- `islandId` = ilha da cidade **destino** (não da origem)
- `capacity` vai de 0 a 5 (não 500 — são 5 cargas de 100 cada)
- `currentCityId` deve ser a cidade atual da sessão → navegar antes de enviar
- `actionRequest` CSRF é renovado a cada resposta — sempre usar o mais recente

**Campos de carga por recurso:**
| Recurso | Campo no POST | Chave no model |
|---------|--------------|----------------|
| Madeira | `cargo_resource` | `resource` |
| Wine | `cargo_tradegood1` | `1` |
| Marble | `cargo_tradegood2` | `2` |
| Crystal | `cargo_tradegood3` | `3` |
| Sulfur | `cargo_tradegood4` | `4` |

> ⚠️ Nos forms do porto, madeira = campo `cargo_resource` (não `0` como nos selects de rota comercial).

---

## `ikariam.model.advisorData`

```javascript
ikariam.model.advisorData = {
  military:  { link: "?view=militaryAdvisor...",  cssclass: "normal" | "normalactive" },
  cities:    { link: "?view=tradeAdvisor...",     cssclass: "normal" | "normalactive" },
  research:  { link: "?view=researchAdvisor...",  cssclass: "normal" | "normalactive" },
  diplomacy: { link: "?view=diplomacyAdvisor...", cssclass: "normal" | "normalactive" },
  hasPremiumAccount: {bool}
}
```

> `cssclass: "normalactive"` = advisor com alerta/ação pendente.
> Útil para detectar crises ou avisos sem fazer AJAX.

---

## Formato da Resposta do Servidor

Todas as ações retornam um array de comandos:

```javascript
[
  ["updateGlobalData", {
    actionRequest: "{novo_token}",  // ⚠️ CSRF renovado a cada resposta — ler sempre
    headerData:      { ... },       // recursos, gold, transportadores atualizados
    backgroundData:  { ... },       // position[], underConstruction, endUpgradeTime
    nextETA:         {Unix ts}
  }],
  ["changeView",        ["{viewName}", "{...html...}"]],
  ["updateTemplateData", { "{seletor css}": "{valor}" }],
  ["provideFeedback",   [{ location: {1|4}, text: "{msg}", type: {number} }]],
  ["popupData",         null],
  ["updateBacklink",    { link: "...", title: "..." }]
]
```

**Comandos possíveis na resposta:**
| Comando | O que contém |
|---------|-------------|
| `updateGlobalData` | Novo CSRF, headerData, backgroundData atualizado |
| `changeView` | Nome da view + HTML renderizado |
| `updateTemplateData` | Update parcial da UI via seletores CSS |
| `provideFeedback` | Mensagem de sucesso/erro (`location: 1` = edifício, `4` = unidade) |
| `popupData` | Popup a mostrar (`null` = nenhum) |
| `updateBacklink` | Link de navegação atualizado |
| `evalScript` | Executa JS arbitrário ⚠️ |
| `reload` | Recarrega a página |
| `custom` | Chama handler customizado: `w[fn](data)` |

> **Crítico:** após qualquer ação, ler `updateGlobalData.actionRequest` para renovar o CSRF token.

---

## `backgroundData` na Resposta — Estado da Cidade

```javascript
// Durante construção ativa:
backgroundData = {
  underConstruction:     {slot},      // índice do slot em construção
  endUpgradeTime:        {Unix ts},
  startUpgradeTime:      {Unix ts},
  buildingSpeedupActive: {0|1},
  speedupState:          {number},    // % de speedup disponível
  position: {
    [{slot}]: {
      building:       "{name} constructionSite",  // sufixo durante upgrade
      completed:      "{Unix ts}",
      countdownText:  "{string}",
      buildingimg:    "constructionSite",
      isBusy:         false           // isBusy é false mesmo durante construção de edifício
    }
  }
}

// Sem construção / após conclusão:
backgroundData = {
  underConstruction: -1,              // -1 = sem construção ativa
  endUpgradeTime:    -1,
  startUpgradeTime:  -1,
  position: {
    [{slot}]: {
      building: "{name}",             // sem sufixo constructionSite
      isBusy:   false
    }
  }
}
```

> **Diferença crítica:**
> - `underConstruction = {slot}` → edifício sendo construído/upgradado
> - `isBusy = true` (sem underConstruction) → unidade sendo treinada no edifício

---

## Resposta após Envio de Transporte

```javascript
// Sinais de sucesso:
headerData.freeTransporters        // diminuiu (barcos em trânsito)
headerData.maxActionPoints         // diminuiu em 1
backgroundData.position[n].isBusy  // porto ficou true

// Campos novos no backgroundData:
backgroundData.portLoadingTime    // Unix ts de fim do carregamento
backgroundData.portLoadingEventId // ID do evento (usar para cancelar)
backgroundData.portLoadingNotOwner // 0 = próprio

// URL para cancelar transporte:
// ?action=transportOperations&function=abortFleetOperation
//   &eventId={eventId}&oldView=port&cityId={id}&position={slot}
```

---

## Upgrade de Edifício — URL e Payload

```
GET ?action=UpgradeExistingBuilding
    &actionRequest={token}
    &cityId={cityId}
    &position={slot}
    &level={targetLevel}
```

> `level` = nível destino (nível atual + 1).

**Cancelar construção:**
```
GET ?action=CityScreen&function=cancelBuilding
    &cityId={cityId}&position={slot}
    &actionRequest={token}&templatePosition={slot}
```

---

## `periodicDataRefresh`

```javascript
// Executa automaticamente a cada ~15 segundos
// Atualiza ikariam.model com dados frescos do servidor
// Renova CSRF token, recursos, gold, transportadores

// Para observar (debug):
const orig = ikariam.periodicDataRefresh;
ikariam.periodicDataRefresh = function() {
  console.log("refresh!", new Date());
  return orig.apply(this, arguments);
}
```

---

## `ikariam.controller` — Métodos Relevantes

### `executeAjaxRequest(url, callbackClass, data, async)`

```javascript
// Como o jogo faz qualquer chamada ao servidor
ikariam.controller.executeAjaxRequest(url, callbackClass, data, async)
// url           — string com a URL (incluindo querystring)
// callbackClass — classe JS a instanciar com a resposta (null = ajaxResponder padrão)
// data          — POST body (null para GETs simples)
// async         — true (padrão)
```

**`ajaxHandlerCall` vs `executeAjaxRequest`:**
| | `ajaxHandlerCall` | `executeAjaxRequest` |
|--|--|--|
| Método HTTP | GET | POST |
| Uso | Links/botões simples | Forms, ações com data |
| Processa resposta | Sim (ajaxResponder) | Sim (ajaxResponder ou callback custom) |

### `ajaxResponder` — Handlers de Comandos

`parseResponse` itera o array de comandos e chama `this[comando](params)`.

**`updateGlobalData` — campos processados:**
```javascript
"cityDropdownMenu"  → model.relatedCityData       // lista de cidades
"advisors"          → model.advisorData            // estado dos advisors
"relatedCity"       → model.updateHeaderCityInfos() // troca de cidade ativa
"maxActionPoints"   → model.maxActionPoints
"headerData.*"      → atualiza model[campo] se mudou
// Após atualizar:
// woodCounter.updateTimerConfig(resourceProduction)
// tradegoodCounter.updateTimerConfig(tradegoodProduction)
// model.serverTime = model.requestTime
```

**`screen.update(backgroundData)` — campos processados:**
```javascript
"id"                → screenId (muda cidade atual)
"endUpgradeTime"    → timer de construção
"position[]"        → slots de edifícios (atualiza DOM)
"lockedPosition"    → slots bloqueados
"underConstruction" → estado de construção
"portLoadingTime"   → timer do porto
"harbourOccupied"   → porto ocupado
"spiesInside"       → espiões detectados
"cityOccupied"      → cidade ocupada
"occupierId"        → ID do ocupante
```

---

## Detecção de Troca de Cidade

```javascript
// Opção 1 — interceptar screen.update (screenId muda a cada troca):
const origUpdate = ikariam.getScreen().update;
ikariam.getScreen().update = function(data) {
  const oldId = this.screenId;
  const result = origUpdate.call(this, data);
  if (oldId !== data.id) {
    console.log("Cidade trocou:", oldId, "→", data.id);
  }
  return result;
};

// Opção 2 — interceptar updateHeaderCityInfos:
const orig = ikariam.getModel().updateHeaderCityInfos;
ikariam.getModel().updateHeaderCityInfos = function(data) {
  const result = orig.call(this, data);
  if (result) {  // true = cidade própria, houve troca
    const newCityId = ikariam.model.relatedCityData.selectedCityId;
    console.log("Nova cidade:", newCityId);
  }
  return result;
};
```

---

## `backgroundView.screen.data` — View da Ilha

Quando o jogador está na view da ilha (não da cidade):

```javascript
ikariam.backgroundView.screen.data = {
  id:              "{islandId}",      // ⚠️ STRING aqui (cidade usa number)
  islandId:        "{islandId}",      // STRING
  islandName:      "{string}",
  xCoord:          "{string}",
  yCoord:          "{string}",
  tradegood:       {1|2|3|4},         // tipo de tradegood da ilha
  resourceLevel:   "{number}",        // nível da mina de madeira (STRING)
  tradegoodLevel:  "{number}",        // nível da mina de tradegood (STRING)
  wonder:          "{wonderId}",      // ID da maravilha
  wonderLevel:     "{number}",        // STRING
  wonderName:      "{string}",
  isOwnCityOnIsland: {bool},
  tradegoodEndUpgradeTime: {0|Unix ts},   // 0 = não em upgrade
  resourceEndUpgradeTime:  {0|Unix ts},
  wonderEndUpgradeTime:    {0|Unix ts},
  isHeliosTowerBuilt: {bool},
  heliosActive:    {0|1},
  cities:          [ ... ],           // ver abaixo
  barbarians:      { ... },
  avatarScores:    { ... },
  walkers:         { add: [...], remove: [...] }
}
```

> Detectar view de ilha: `typeof screen.data.id === "string"` ou `String(screen.data.id).includes(':')`.

### `cities[]` — Slots da Ilha

```javascript
// Slot vazio:
{ id: -1, type: "buildplace", name: "{string}", level: 0,
  buildplace_type: "normal" | "premium" }

// Cidade ocupada:
{ type: "city", id: {cityId}, name: "{string}", level: {number},
  ownerId: "{avatarId}",    // ⚠️ STRING
  ownerName: "{string}",
  ownerAllyId: {number},
  hasTreaties: {0|1},
  actions: [],
  state: "{string}",
  viewAble: {number},
  infestedByPlague:      {bool},
  abyssalAmbushCSSClass: "{string}" }
```

> `infestedByPlague` e `abyssalAmbushCSSClass` — úteis para evitar enviar recursos para cidades afetadas.

### `barbarians`

```javascript
{
  count:           {number},
  level:           {number},
  wallLevel:       {number},
  underAttack:     {0|1},
  isTradegoodSiege:{0|1},
  destroyed:       {0|1},
  actionClass:     "{string}",  // "plundering disabled" = sem tropas disponíveis
  city:            "{string}"   // nome do bárbaro (ex: "kingOlaf")
}
```

### `walkers` — Animações Visuais

```javascript
walkers.add    = [ ["{walkerId}", "walkers", [[x,y,dir,vel,ts,tipo],...], ts, tooltip, ...], ... ]
walkers.remove = [ ["{eventId}"], ... ]
// ex: [["ship_transport_{id}"]]
```

> `walkers.remove` pode detectar chegada/saída de transportes em tempo real.
> Monitorar no detection loop para invalidar cache imediatamente ao chegarem recursos.

### O que a view de ilha dá de útil

| Campo | Uso |
|-------|-----|
| `resourceLevel` | Nível da mina de madeira — ⚠️ STRING, mas valor direto sem offset (ex: `"16"` = nível 16) |
| `tradegoodLevel` | Nível da mina de tradegood — mesmo formato STRING direto |
| `tradegood` | Tipo de tradegood produzido na ilha |
| `wonder` / `wonderName` / `wonderLevel` | ID, nome e nível da maravilha da ilha |
| `cities[]` | Cidades presentes (próprias, aliados, inimigos) |
| `tradegoodEndUpgradeTime` | Mina de tradegood em upgrade |
| `resourceEndUpgradeTime` | Mina de madeira em upgrade |
| `walkers.remove` | Transportes recém-chegados/saídos |

---

## Townhall — `templateView.script.params`

```javascript
{
  citizens: {float},  // população atual (float, não inteiro)

  factors: {
    WoodProduction:          {float},  // multiplicador de produção de madeira
    WoodProductionOverload:  {float},  // penalidade por sobrecarga de população
    LuxuryProduction:        {float},  // multiplicador de tradegood
    LuxuryProductionOverload:{float},
    ScienceProduction:       {float},  // multiplicador de ciência
    ScienceCosts:            {number}, // custo por cientista (ouro por cientista/hora)
    PriestsProduction:       {number},
    CitizensProduction:      {number}  // ouro por cidadão livre/hora (constante = 3)
  },

  standard: {
    Wood:   {number},   // produção base de madeira sem multiplicadores
    Luxury: {number}    // produção base de tradegood sem multiplicadores
  }
}

// Produção real:
// madeira/h   = standard.Wood   × factors.WoodProduction
// tradegood/h = standard.Luxury × factors.LuxuryProduction
```

---

## Townhall — IDs DOM (satisfação, população, trabalhadores)

> ⚠️ Estes dados **não existem** em `ikariam.model` nem em `script.params`.
> Só estão disponíveis via DOM quando o diálogo da Câmara Municipal está aberto.

### População e Crescimento

```javascript
document.getElementById('js_TownHallOccupiedSpace').innerText      // população atual (ex: "1.535")
document.getElementById('js_TownHallMaxInhabitants').innerText     // capacidade máxima (ex: "1.616")
document.getElementById('js_TownHallPopulationGrowthValue').innerText // crescimento/hora (ex: "3,00")
document.getElementById('js_TownHallCorruption').innerText         // corrupção % (ex: "0%")
document.getElementById('js_TownHallIncomeGoldValue').innerText    // ouro líquido/hora (ex: "2.964")
document.getElementById('js_TownHallActionPointsAvailable').innerText    // pontos de ação disponíveis
document.getElementById('js_TownHallMaxActionPointsAvailable').innerText // pontos de ação máximos
document.getElementById('js_TownHallGarrisonLimitLand').innerText  // limite de guarnição terrestre
document.getElementById('js_TownHallGarrisonLimitSea').innerText   // limite de guarnição naval
```

### Trabalhadores (lacuna #4 — só via DOM)

```javascript
// Formato: "N + M" onde N = trabalhadores fixos, M = trabalhadores extras (bônus de pesquisa)
document.getElementById('js_TownHallPopulationGraphResourceWorkerCount').innerText  // ex: "153 + 76"  (mina de madeira)
document.getElementById('js_TownHallPopulationGraphSpecialWorkerCount').innerText   // ex: "212 + 106" (mina de tradegood)
document.getElementById('js_TownHallPopulationGraphScientistCount').innerText       // cientistas
document.getElementById('js_TownHallPopulationGraphPriestCount').innerText          // sacerdotes
document.getElementById('js_TownHallPopulationGraphCitizenCount').innerText         // cidadãos livres

// Inputs de alocação (valores editáveis pelo jogador)
document.getElementById('inputWood').value       // trabalhadores alocados na madeira
document.getElementById('inputLuxury').value     // trabalhadores alocados no tradegood
document.getElementById('inputScientists').value // cientistas alocados
document.getElementById('inputPriests').value    // sacerdotes alocados

// Máximos permitidos (data-max dos inputs)
document.getElementById('inputWood').dataset.max       // max trabalhadores madeira
document.getElementById('inputLuxury').dataset.max     // max trabalhadores tradegood
document.getElementById('inputScientists').dataset.max // max cientistas (= MAX_SCIENTISTS[academyLevel])
```

> ⚠️ Formato "153 + 76": primeiro valor = trabalhadores base, segundo = bônus de Ajuda Mútua ou pesquisa.
> Para o total real: somar ambos.

### Produção por grupo de trabalhadores

```javascript
document.getElementById('js_TownHallPopulationGraphWoodProduction').innerText       // ex: "+294" (madeira/h)
document.getElementById('js_TownHallPopulationGraphTradeGoodProduction').innerText  // ex: "+295" (tradegood/h)
document.getElementById('js_TownHallPopulationGraphScientistsResearchCost').innerText    // custo ouro de cientistas
document.getElementById('js_TownHallPopulationGraphScientistsResearchProduction').innerText // pesquisa/h
document.getElementById('js_TownHallPopulationGraphPriestsGoldProduction').innerText     // ouro de sacerdotes
document.getElementById('js_TownHallPopulationGraphCitizensGoldProduction').innerText    // ouro de cidadãos livres
```

### Satisfação — Breakdown Completo (lacuna #1)

```javascript
// Estado geral
document.getElementById('js_TownHallHappinessLargeValue').innerText  // satisfação total (ex: "148")
document.getElementById('js_TownHallHappinessLargeText').innerText   // texto do estado (ex: "contente")
// Classes CSS do estado: happiness_ecstatic | happiness_happy | happiness_neutral | happiness_sad | happiness_outraged

// ── BÔNUS BASE ──
document.getElementById('js_TownHallSatisfactionOverviewBaseBoniBaseBonusValue').innerText       // bônus básico (ex: "+196")
document.getElementById('js_TownHallSatisfactionOverviewBaseBoniGovernmentBonusValue').innerText // bônus de governo (ex: "+75")
document.getElementById('js_TownHallSatisfactionOverviewBaseBoniResearchBonusValue').innerText   // bônus de pesquisa (ex: "+25")
document.getElementById('js_TownHallSatisfactionOverviewBaseBoniCapitalBonusValue').innerText    // bônus capital (ex: "+50", 0 se não capital)
document.getElementById('js_TownHallSatisfactionOverviewBaseBoniHappeningBonusValue').innerText  // bônus evento especial
document.getElementById('js_TownHallSatisfactionOverviewBaseBoniTransferBonusValue').innerText   // bônus transferência de conta

// ── BÔNUS DE VINHO ──
document.getElementById('js_TownHallSatisfactionOverviewWineBoniTavernBonusValue').innerText  // bônus nível taberna (ex: "+207")
document.getElementById('js_TownHallSatisfactionOverviewWineBoniServeBonusValue').innerText   // bônus serviço de vinho (ex: "+1.037")

// ── BÔNUS CULTURAL ──
document.getElementById('js_TownHallSatisfactionOverviewCultureBoniMuseumBonusValue').innerText  // bônus museu (ex: "+144")
document.getElementById('js_TownHallSatisfactionOverviewCultureBoniTreatyBonusValue').innerText  // bônus tratados culturais

// ── PENALIDADES ──
document.getElementById('js_TownHallSatisfactionOverviewOverpopulationMalusValue').innerText  // penalidade superpopulação (= população total)
document.getElementById('js_TownHallSatisfactionOverviewCorruptionMalusValue').innerText      // penalidade corrupção
document.getElementById('js_TownHallSatisfactionOverviewPunishmentMalusValue').innerText      // penalidade revolta
document.getElementById('js_TownHallSatisfactionOverviewGovernmentMalusValue').innerText      // penalidade tipo de governo
```

> **Fórmula confirmada (sem modificadores ocultos):**
> ```
> satisfação = base + governo_bônus + pesquisa + capital + evento + transferência
>            + taberna + vinho
>            + museu + tratados
>            - superpopulação - corrupção - revolta - governo_malus
> ```
> Verificado: 196 + 75 + 25 + 50 + 0 + 0 + 266 + 1332 + 176 + 0 - 1928 - 0 - 0 - 0 = **192** ✅
> A penalidade de superpopulação é exatamente igual ao valor de `population` (total de habitantes).

---

## Warehouse — IDs DOM (sem `script.params`)

```javascript
// Recursos seguros (protegidos contra pilhagem)
document.getElementById('js_secure_wood').innerText
document.getElementById('js_secure_wine').innerText
document.getElementById('js_secure_marble').innerText
document.getElementById('js_secure_glass').innerText    // ⚠️ Crystal = "glass" no DOM
document.getElementById('js_secure_sulfur').innerText

// Recursos desprotegidos (pilháveis)
document.getElementById('js_plunderable_{resource}').innerText

// Totais
document.getElementById('js_total_{resource}').innerText
document.getElementById('js_capacity_{resource}').innerText   // igual para todos = capacidade geral

// Capacidade total
document.getElementById('js_total_safe_capacity').innerText
document.getElementById('js_total_storage_capacity').innerText
```

---

## Porto — Tempo de Viagem e Destino (lacuna #7 — RESOLVIDA)

> ⚠️ `ikariam.templateView.script.params` retorna `null` no porto — tudo via DOM.
> O destino e tempo de viagem ficam no `transportForm` e no `#missionSummary`.

### Destino selecionado (hidden inputs do form)

```javascript
// Cidade e ilha destino — preenchidos automaticamente ao selecionar destino
document.querySelector('#transportForm input[name="destinationCityId"]').value  // cityId destino (ex: "6581")
document.querySelector('#transportForm input[name="islandId"]').value            // islandId destino (ex: "1032")
```

> ⚠️ O destino NÃO é um `<select>` visível — é um `<input type="hidden">` atualizado via JS
> quando o jogador clica numa das cidades listadas. Não há select de destino para observar.

### Tempo de viagem e chegada

```javascript
document.getElementById('journeyTime').innerText   // ex: "44m 44s"  — duração da viagem
document.getElementById('loadingTime').innerText   // ex: "7s"       — tempo de carregamento no porto
document.getElementById('arrival').innerText       // ex: "18.03.2026 19:31:23" — horário de chegada
```

> **Como obter tempo de viagem via AJAX (sem abrir o porto):**
> O tempo de viagem é calculado pelo servidor — não há fórmula client-side exposta.
> Para obter programaticamente: fazer GET na view do porto com `destinationCityId` na querystring
> e ler `#journeyTime` do HTML retornado no `changeView`.

### Velocidade e capacidade

```javascript
document.getElementById('selectedTransportersInput').value          // barcos selecionados (ex: "96")
document.querySelector('.totalNormalTransporters').innerText         // total de barcos disponíveis
document.querySelector('.js_completeTransportCapacity span').innerText // capacidade total (ex: "48.000")
document.getElementById('capacitySpeedValue').innerText             // bônus de velocidade por capacidade
document.getElementById('speedValue').innerText                     // bônus de velocidade Motores Triton

// Velocidade detalhada (summary expandido)
document.getElementById('summary_capacity').value  // bônus capacidade (ex: "+0%")
document.getElementById('summary_triton').value    // bônus triton
document.getElementById('summary_wonder').value    // bônus maravilha
document.getElementById('summary_total').value     // bônus total de velocidade
```

### Velocidade de carregamento por porto

```javascript
// Cada porto tem seu próprio ID (position 1, 2, ...)
document.getElementById('js_loadingSpeedPort0').innerText  // ex: "438 Bens por minuto" (porto slot 1)
document.getElementById('js_loadingSpeedPort1').innerText  // ex: "510 Bens por minuto" (porto slot 2)
```

### Campos de carga (inputs do form de transporte)

```javascript
document.getElementById('textfield_wood').value        // madeira a enviar   → name="cargo_resource"
document.getElementById('textfield_wine').value        // vinho               → name="cargo_tradegood1"
document.getElementById('textfield_marble').value      // mármore             → name="cargo_tradegood2"
document.getElementById('textfield_glass').value       // cristal             → name="cargo_tradegood3"
document.getElementById('textfield_sulfur').value      // enxofre             → name="cargo_tradegood4"
document.getElementById('textfield_capacity').value    // capacidade por barco (0-5) → name="capacity"
document.getElementById('max_capacity').value          // sempre "5"          → name="max_capacity"
document.getElementById('textfield_premium').value     // mercenários         → name="premiumTransporter"
document.getElementById('textfield_jet').value         // motores triton      → name="jetPropulsion"
```

---

## Porto — IDs DOM (sem `script.params`)

```javascript
// Transportadores
document.getElementById('js_currentBuyableTransporters').innerText
document.getElementById('js_transporterCosts').innerText
document.getElementById('js_maxTransporter').innerText

// Tempo de viagem / chegada
document.getElementById('journeyTime').innerText           // ex: "44m 44s"
document.getElementById('arrival').innerText               // ex: "18.03.2026 8:59:32"

// Transportadores selecionados
document.querySelector('.totalNormalTransporters').innerText
document.getElementById('selectedTransportersInput').value
```

### Rotas Comerciais — Payload

```javascript
{
  action:        "Premium",         // feature premium
  function:      "editTradeRoute",
  updatePosition: {1|2|...},        // índice da rota
  renew:          {0|1},            // 1 = ativar rota
  cityId:        {portCityId},
  position:      {portSlot},
  city1Id:       {fromCityId},
  city2Id:       {toCityId},
  tradegood:     {0|1|2|3|4},       // 0=madeira, 1-4=tradegoods (ORDER diferente do model!)
  time:          {0-23},            // hora de envio
  number:        {amount}
}
```

> ⚠️ Nos selects de rotas comerciais, madeira = `0` (não `"resource"` como no model).

---

## Espionagem — Safehouse

```javascript
// Treinar espião:
// POST action=Espionage&function=buildSpy
//      &cityId={id}&position={slot}&actionRequest={token}

// IDs DOM dos custos:
document.getElementById('js_spygold').innerText   // custo em gold
document.getElementById('js_spyglass').innerText  // custo em crystal (glass no DOM!)
document.getElementById('js_spycompletion').innerText

// Abortar treino:
// ?action=Espionage&function=abortSpyTraining
//   &cityId={id}&eid={eventId}&actionRequest={token}&position={slot}
```

---

## `ikariam.events` — Eventos Agendados

```javascript
ikariam.events = {
  "{index}": {
    counterType: "popup",          // tipo do evento
    timeLeft:    {number},         // segundos restantes
    timeout:     {Unix ts},        // timestamp de expiração
    scrollText:  "{string}",       // texto do evento (ex: "A Roda dos Deuses aguarda-te!")
    scrollCssClass: "{string}",
    scrollType:     "{string}"
  }
  // ... um por evento agendado
}
```

> Útil para detectar eventos especiais (Roda dos Deuses, etc.) sem polling.

---

## Military Advisor

Dados chegam via HTML (`changeView`), sem `script.params`.

**Tipos de missão (`data-filter`):**
| Valor | Tipo |
|-------|------|
| `transport` | Transporte de recursos |
| `deployarmy` | Destacar exército |
| `deployfleet` | Destacar frota |
| `trade` | Rota comercial |
| `transport_barbarians` | Transporte para bárbaros |
| `plunder` | Pilhar |
| `occupy` | Ocupar cidade |
| `blockade` | Bloquear porto |
| `defend` | Defender cidade |
| `defend_port` | Defender porto |
| `barbarianFleet` | Frota bárbara |
| `piracyRaid` | Raid de pirataria |

**IDs DOM das secções:**
```javascript
#js_MilitaryMovementsCombatsInProgress
#js_MilitaryMovementsFleetMovementsTable
#js_MilitaryMovementsOccupiedCitiesTable
#js_MilitaryMovementsOccupiedPortsTable
```

### Movimentos de Frota — Estrutura da Tabela (lacuna #8 — RESOLVIDA)

> ⚠️ `script.params` retorna `null` no militaryAdvisor — tudo via DOM.
> Cada linha da tabela `#js_MilitaryMovementsFleetMovementsTable` é um movimento ativo.

**Estrutura de uma linha de transporte:**

```javascript
// Iterar todas as linhas da tabela de frotas:
const rows = document.querySelectorAll('#js_MilitaryMovementsFleetMovementsTable tr.own, #js_MilitaryMovementsFleetMovementsTable tr.enemy');

// Por linha, extrair:
row.querySelector('.mission_icon').className          // tipo: "mission_icon transport" | "mission_icon deployarmy" etc.
row.querySelector('[title="Tempo de chegada"]').innerText   // ex: "01h 10m"
row.querySelector('.nowrap:nth-child(2)').innerText   // estado: "(em curso)" | "(a carregar)" | "(a regressar)"
row.querySelector('.nowrap[title^="A decorrer"]').innerText // countdown: ex: "0:02:35"

// Origem e destino
row.querySelector('.source a').title                  // nome cidade origem (ex: "BAD C")
row.querySelector('.source a').href                   // URL com cityId origem
row.querySelector('.target a').title                  // nome cidade destino (ex: "BAD V")
row.querySelector('.target a').href                   // URL com cityId destino

// Proprietário
row.querySelector('.source span').title               // nome do jogador origem
row.querySelector('.target span').title               // nome do jogador destino

// Direção da missão (classe da célula arrow)
row.querySelector('.mission.arrow_right_green')       // missão em andamento (ida)
row.querySelector('.mission.arrow_left_green')        // retorno

// Unidades/recursos transportados
row.querySelectorAll('.unit_detail_icon')             // ícones com title = quantidade
// Exemplo: .icon40.ship_transport title="1" → 1 barco
//          .resource_icon.glass title="500"  → 500 cristal

// Ação de cancelar — contém o eventId
row.querySelector('.action_icon.abort').href
// ex: "?action=transportOperations&function=abortFleetOperation&eventId=479735&..."
// Extrair eventId: href.match(/eventId=(\d+)/)[1]
```

**Extrair cityId da URL:**
```javascript
// href="?view=island&cityId=6580"
new URL(row.querySelector('.source a').href).searchParams.get('cityId')  // "6580"
new URL(row.querySelector('.target a').href).searchParams.get('cityId')  // "6582"
```

**Exemplo de parsing completo de um movimento:**
```javascript
function parseMovements() {
  const rows = [...document.querySelectorAll('#js_MilitaryMovementsFleetMovementsTable tr.own')];
  return rows.map(row => {
    const missionClass = row.querySelector('[class*="mission_icon"]')?.className ?? '';
    const type = missionClass.replace('mission_icon', '').trim(); // "transport", "deployarmy", etc.

    const abortHref = row.querySelector('.action_icon.abort')?.href ?? '';
    const eventId = abortHref.match(/eventId=(\d+)/)?.[1] ?? null;

    const units = [...row.querySelectorAll('.unit_detail_icon[title]')]
      .map(el => ({ icon: el.className, amount: parseInt(el.title) }));

    return {
      type,
      eventId,
      eta: row.querySelector('[title="Tempo de chegada"]')?.innerText?.trim(),
      countdown: row.querySelector('.nowrap[title^="A decorrer"]')?.innerText?.trim(),
      status: row.querySelectorAll('.nowrap')[1]?.innerText?.trim(), // "(em curso)" etc.
      sourceName: row.querySelector('.source a')?.title,
      sourceCityId: new URL(row.querySelector('.source a')?.href ?? location.href).searchParams.get('cityId'),
      targetName: row.querySelector('.target a')?.title,
      targetCityId: new URL(row.querySelector('.target a')?.href ?? location.href).searchParams.get('cityId'),
      units,
    };
  });
}
```

---

## IDs DOM da Barra de Recursos (Header)

```javascript
// Cidade própria:
#resources_population
#resources_wood
#resources_marble
#resources_wine
#resources_sulfur
#resources_glass    // ⚠️ Crystal = "glass" em TODOS os IDs DOM do jogo

// Cidade estrangeira:
#resources_foreign
```

---

## Comandos de Console Úteis (Debug)

```javascript
// === NAVEGAÇÃO ===
// Todas as cidades e tradegoods
Object.entries(ikariam.model.relatedCityData)
  .filter(([k]) => k.startsWith('city_'))
  .map(([k, v]) => `${v.id} tg=${v.tradegood}`)

// Cidade atual
ikariam.model.relatedCityData.selectedCityId

// islandId da cidade atual
ikariam.backgroundView.screen.data.islandId

// === RECURSOS ===
ikariam.model.currentResources       // recursos atuais
ikariam.model.headerData.freeTransporters  // barcos livres
parseFloat(ikariam.model.headerData.gold)  // ouro (headerData.gold é STRING)
ikariam.model.resourceProduction * 3600    // madeira/hora

// === CONSTRUÇÃO ===
// Slots com edifícios
ikariam.backgroundView.screen.data.position
  .filter(p => p.buildingId > 0)
  .map(p => `[${p.position}] ${p.name} lv${p.level}`)

// Tem construção ativa?
ikariam.backgroundView.screen.data.underConstruction  // -1 ou false = não

// === TIMING ===
ikariam.model.serverTime                              // Unix s
ikariam.model.woodCounter.timer.serverTimeDiff        // offset browser-servidor (ms)
new Date(ikariam.model.nextETA * 1000)                // próximo evento

// === INTERCEPTAR periodicDataRefresh ===
const orig = ikariam.periodicDataRefresh;
ikariam.periodicDataRefresh = function() {
  console.log("refresh!", new Date(), ikariam.model.actionRequest);
  return orig.apply(this, arguments);
}

// === CSRF ===
ikariam.model.actionRequest   // token atual
```

---

## Research Advisor — `templateView.script.params` (lacuna #10 — RESOLVIDA)

> ✅ `script.params` está disponível no researchAdvisor (ao contrário do porto e militaryAdvisor).

```javascript
ikariam.templateView.script.params = {
  currResearchType: {
    "{nome_pesquisa}": {
      aHref:   "?view=noViewChange&researchId={id}",  // ID da pesquisa na URL
      liClass: "explored"       // "explored" = pesquisada
               | "selected unexplorable red"  // selecionada mas bloqueada (pré-requisitos em falta)
               | "gray",        // não disponível ainda
      aClass:  "" | "red" | "gray"
    },
    // ... uma entrada por pesquisa da categoria atual
  },

  currResearchName:     "{string}",   // nome da pesquisa atualmente selecionada
  currResearchDesc:     "{html}",     // descrição com HTML
  currResearchTimeNeeded: "{string}", // ex: "4A 11M" (Anos e Meses de pesquisa)
  currResearchTimeNeededClass: "",
  currResearchPrecond: {             // pré-requisitos
    "{nome}": {
      type:      "{categoria}",      // ex: "Economia"
      aHref:     "?view=noViewChange&researchId={id}&researchType=economy",
      spanClass: "arrow_ok" | "arrow_nok"  // ok = já pesquisado
    }
  },
  currResearchCosts:    "{string}",  // ex: "106.560" — pontos de pesquisa necessários ⚠️ STRING com ponto
  currResearchCostClass: "research_cost" | "research_cost red",  // red = pontos insuficientes
  currResearchPointsNotEnoughTxt: "{string}",
  currResearchPointsNotEnoughClass: "" | "red",
  currResearchBtnState: "invisible" | "",  // invisible = não pode pesquisar agora
  currResearchBtnTxt:   "Pesquisa",
}
```

> **Extrair lista de pesquisas concluídas:**
> ```javascript
> const investigated = Object.entries(params.currResearchType)
>   .filter(([, v]) => v.liClass === 'explored')
>   .map(([, v]) => parseInt(v.aHref.match(/researchId=(\d+)/)[1]));
> ```

> **Extrair researchId da pesquisa selecionada:**
> ```javascript
> params.currResearchType[params.currResearchName]?.aHref.match(/researchId=(\d+)/)?.[1]
> ```

> ⚠️ `currResearchType` contém apenas a categoria atualmente exibida (ex: "Economia").
> Para obter pesquisas de todas as categorias é necessário fazer AJAX para cada categoria.
>
> **Categorias confirmadas** (parâmetro `researchType`):
> | researchType | Nome exibido |
> |---|---|
> | `seafaring` | Navegação Marítima |
> | `economy` | Economia |
> | `knowledge` | Ciência |
> | `military` | Militar |
> | `mythology` | Mitologia |
>
> **Endpoint AJAX para obter pesquisas de uma categoria:**
> ```
> GET /index.php?view=researchAdvisor&researchType={categoria}&ajax=1&actionRequest={token}
> Header: X-Requested-With: XMLHttpRequest
> ```
> A resposta contém `updateTemplateData` com campo `load_js.params` — JSON string com o
> `currResearchType` completo da categoria. Parsear com `JSON.parse(data.load_js.params)`.
>
> **Script params vem em `load_js.params` (JSON string dentro do updateTemplateData):**
> ```javascript
> const templateData = response.find(d => d[0] === 'updateTemplateData')?.[1];
> const params = JSON.parse(templateData?.load_js?.params ?? '{}');
> // params.currResearchType = { "Nome": { liClass: "explored"|"gray"|"selected...", aHref: "...researchId=NNNN" } }
> ```

### Research Advisor — IDs DOM

```javascript
document.getElementById('js_researchAdvisorCurrResearchType').innerText  // categoria atual (ex: "Economia")
document.getElementById('js_researchAdvisorScientists').innerText         // cientistas alocados (ex: "0")
document.getElementById('js_researchAdvisorPoints').innerText             // pontos acumulados (ex: "19.439")
document.getElementById('js_researchAdvisorTime').innerText               // pontos/hora (ex: "2,00")
document.getElementById('js_researchAdvisorCurrResearchName').innerText   // pesquisa selecionada
document.getElementById('js_researchAdvisorCurrResearchCosts').innerText  // custo em pontos
document.getElementById('js_researchAdvisorCurrResearchTimeNeeded').innerText // tempo necessário

// Sidebar — próximas pesquisas disponíveis (índice 0, 1, 2, ...)
document.getElementById('js_researchAdvisorNextResearchName{N}').innerText    // nome
document.getElementById('js_researchAdvisorNextResearchCost{N}').innerText    // custo
document.getElementById('js_researchAdvisorCountdown{N}').innerText           // tempo disponível
// ex: N=0 → "Aríete Maciço", "120.000", "5A 8M"

// Tooltip de breakdown de produção de pesquisa (lacuna #1 de pesquisa — RESOLVIDA via AJAX)
// Estrutura da tabela no HTML retornado:
// Produção Base: 0,00   (cientistas × multiplicador)
// Corrupção: + 0,00
// Bónus do Premium: + 0,00
// Pesquisas: + 0,00
// Bens culturais: + 2,00   ← neste caso 2,00 pts/h vêm de bens culturais
// Total: 2,00
document.getElementById('js_infoResearchAdvisorBreakdownTooltip').innerText

// ⚠️ Confirmado: com 0 cientistas, os 2,00 pts/h vêm de "Bens culturais" (museus)
// Fórmula: pesquisa/h = base + corrupção + premium + pesquisas + bens_culturais
```

> **Formato de tempo:** `"{N}A {M}M"` = N anos e M meses de pesquisa acumulada necessária.
> Não é tempo real — é a quantidade de pontos de pesquisa expressa em anos/meses de produção.

> **Timestamps reais de disponibilidade** (via `updateTemplateData.js_researchAdvisorProgressbar{N}`):**
> ```javascript
> // Cada categoria na sidebar tem um progressbar com timestamps Unix:
> progressbar: {
>   startdate:   {Unix ts},  // quando a conta começou a acumular pontos
>   enddate:     {Unix ts},  // quando terá pontos suficientes para pesquisar
>   currentdate: {Unix ts},  // tempo atual do servidor
> }
> // enddate - currentdate = segundos restantes para poder pesquisar
> // Exemplo: enddate=1930683611, currentdate=1773871211 → 156812400s ≈ 4 anos 11 meses
> ```

---

## Maravilhas — Mapeamento Completo

> Todos os 8 IDs confirmados via `ikariam.backgroundView.screen.data.wonder` (STRING).

| wonder | wonderName | Efeito conhecido |
|--------|-----------|-----------------|
| `"1"` | Forja de Hefesto | Bônus de produção de recursos |
| `"2"` | Bosque Sagrado de Hades | Bônus de satisfação |
| `"3"` | Jardins de Deméter | Bônus de produção de recursos |
| `"4"` | Templo de Atena | Bônus de ciência/pesquisa |
| `"5"` | Templo de Hermes | Bônus de velocidade de navios |
| `"6"` | Fortaleza de Ares | Bônus militar |
| `"7"` | Templo de Poseidon | Bônus naval |
| `"8"` | Colosso | Bônus de satisfação/população |

> `wonderLevel` — STRING, valor direto (ex: `"1"` = nível 1), sem offset.
> `wonderEndUpgradeTime` — Unix ts ou `0` se não está em upgrade.
> `isHeliosTowerBuilt` — bool, Torre de Hélio construída na ilha.
> `heliosActive` — `0|1`, Torre de Hélio ativa.

---

## Áreas Ainda Não Mapeadas

- [ ] `templateView.script.params` de: workshop, barracks, academy (params completos)
- [ ] `ikariam.server` — conteúdo completo
- [ ] `ikariam.ajax` — como fazer chamadas diretamente
- [ ] `buildplace_type: "premium"` — o que diferencia slots premium
- [ ] `buildingId` de edifícios raros: forge, temple, etc.
- [ ] `updateTemplateData` — mapeamento completo de seletores por edifício
- [ ] Efeitos exatos por nível de cada maravilha (bônus numéricos)

---

*Documento baseado em observação direta via console. Atualizar conforme novas descobertas.*
*Não contém valores específicos de conta — usar apenas como referência de estrutura.*
