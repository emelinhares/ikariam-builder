# Ikariam — Mapa Completo de Endpoints

> Mapeado via REC captures em 2026-03-24 + scraping ao vivo em 2026-03-28 (Playwright MCP).
> Todos os requests são POST para `index.php` com body form-encoded.
> `actionRequest` (CSRF token) é obrigatório em toda action que modifica estado.
> `currentCityId` deve corresponder à cidade navegada antes de enviar.
> ⚠️ `UpgradeExistingBuilding` sem recursos retorna `confirmResourcePremiumBuy` — tratar como falha.

## Padrão Geral de Request — CONFIRMADO em 2026-03-28

O servidor rejeita POST puro (`/index.php` sem query string). O padrão correto é:

```
POST /index.php?view={view}&cityId={id}&currentCityId={id}&backgroundView=city&templateView={view}&actionRequest={token}&ajax=1
Content-Type: application/x-www-form-urlencoded

action={action}&function={function}&...campos...&actionRequest={token}
```

> ⚠️ O `actionRequest` deve estar **tanto na query string da URL quanto no body**.
> ⚠️ O token fresco vem em `updateGlobalData[1].actionRequest` (raiz), **não** em `updateGlobalData[1].headerData.actionRequest`.
> ⚠️ Cada GET de view também consome o token — usar o token da resposta GET imediatamente no POST seguinte sem requests intermediários.

---

## Parâmetros Globais Recorrentes

| Parâmetro | Descrição |
|-----------|-----------|
| `actionRequest` | CSRF token — atualizado a cada resposta do servidor |
| `currentCityId` | Cidade que o jogador está vendo no momento |
| `backgroundView` | `city` ou `island` — contexto de fundo atual |
| `cityId` | Cidade alvo da operação (pode diferir de currentCityId) |
| `position` | Slot do edifício na cidade (0–25 aprox.) |
| `templateView` | Nome da view aberta (para manter contexto) |
| `activeTab` | Aba ativa dentro do view |

---

## 1. Navegação / Contexto

### `header` — Trocar cidade ativa
```
action=header
function=changeCurrentCity
cityId={novaCidadeId}
oldView=city            ← ou island
currentCityId={cidadeAtual}
islandX=0 islandY=0
```
**Resposta:** `[custom, updateBacklink, popupData]`
**Notas:** Deve ser chamado antes de enviar qualquer action de outra cidade.

### `updateGlobalData` — Refresh de estado
```
view=updateGlobalData
currentCityId={cityId}
```
**Resposta:** `[updateGlobalData, ...]` — atualiza recursos, token, freeTransporters.

---

## 2. Porto — Transporte de Recursos

### `port` — Abrir porto (listar cidades destino)
```
view=port
cityId={cityId}
position={portPosition}       ← normalmente 1
currentCityId={cityId}
backgroundView=city
activeTab=tabSendTransporter  ← ou tabBuyTransporter, tabTradeRoutes
```

### `transport` — Abrir formulário de carga para destino
```
view=transport
destinationCityId={destinoCityId}
position={portPosition}
currentCityId={cidadeOrigem}
```
**viewScriptParams contém:** `normalTransportersMax`, `capacity`, `islandId` do destino.

### `transportOperations` function=`loadTransportersWithFreight` — **ENVIAR CARGA**
```
action=transportOperations
function=loadTransportersWithFreight
currentCityId={cidadeOrigem}
destinationCityId={cidadeDestino}
islandId={ilhaDestino}
normalTransportersMax={navsDisponiveis}   ← de headerData.freeTransporters
cargo_resource={madeira}
cargo_tradegood1={vinho}
cargo_tradegood2={marmore}
cargo_tradegood3={crystal}
cargo_tradegood4={enxofre}
capacity={transporters × max_capacity}   ← CALCULAR, não usar o 0 do HTML
max_capacity={slotsMaxPorNavio}          ← do HTML do form transport (tipicamente 5)
transporters={qtdNavios}
jetPropulsion=0                          ← 1 se tiver pesquisa de propulsão
currentTab=tabSendTransporter
actionRequest={token}
```
**Fórmula de carga — CONFIRMADA em 2026-03-28:**
```
capacity    = transporters × max_capacity      (ex: 3 × 5 = 15)
cargo_total = capacity × 100                   (ex: 15 × 100 = 1.500 unidades)
```
> ⚠️ O campo `capacity` no HTML do form de transport começa em `0` (valor do slider).
> Nunca usar esse `0` — sempre calcular `transporters × max_capacity`.
> Confirmado: 3 barcos enviados, `freeTransporters` caiu de 65→62, 1.500 vinho debitado.

**Feedback de sucesso:** "A tua ordem foi executada."

**Fluxo correto:**
1. GET `view=transport&destinationCityId={dest}&position={portPos}` → extrair `max_capacity` e `islandId` do HTML, token de `upd[1].actionRequest`
2. POST imediato com os campos acima, URL: `?view=transport&...&templateView=transport&actionRequest={token}&ajax=1`

### `transportOperations` function=`abortFleetOperation` — Cancelar missão em voo
```
action=transportOperations
function=abortFleetOperation
eventId={idDaMissao}            ← obtido de militaryAdvisor viewScriptParams
currentCityId={cityId}
oldView=militaryAdvisor
activeTab=militaryMovements
actionRequest={token}
```

---

## 3. Edifícios — Construção e Gestão

### `buildingGround` — Ver terreno vazio (slot livre)
```
view=buildingGround
cityId={cityId}
position={slotVazio}
currentCityId={cityId}
backgroundView=city
actionRequest={token}
```
**viewScriptParams:** lista de edifícios construíveis no slot.

### `BuildNewBuilding` — **CONSTRUIR** em slot vazio
```
action=BuildNewBuilding
cityId={cityId}
position={slotVazio}
building={buildingId}     ← ver tabela de IDs abaixo
currentCityId={cityId}
backgroundView=city
templateView=buildingGround
actionRequest={token}
```

### `UpgradeExistingBuilding` — **MELHORAR** edifício existente
```
action=UpgradeExistingBuilding
cityId={cityId}
position={slotEdificio}
level={nivelAtual}        ← nível ANTES da melhoria
activeTab={tabAtiva}
backgroundView=city
currentCityId={cityId}
templateView={nomeView}
actionRequest={token}
```
**Resposta com recursos:** `[updateGlobalData, changeView, ...]` com `endUpgradeTime`.
**Resposta sem recursos:** view `confirmResourcePremiumBuy` — tratar como falha, NÃO como sucesso.

### `CityScreen` function=`cancelBuilding` — Cancelar construção em andamento
```
action=CityScreen
function=cancelBuilding
cityId={cityId}
position={slot}
templatePosition={slot}
activeTab={tabAtiva}
backgroundView=city
currentCityId={cityId}
templateView={nomeView}
actionRequest={token}
```

### `CityScreen` function=`demolishBuilding` — Demolir edifício
```
action=CityScreen
function=demolishBuilding
level={nivelAtual}
cityId={cityId}
position={slot}
backgroundView=city
currentCityId={cityId}
templateView=warehouse
actionRequest={token}
```
**Fluxo:** abrir `buildings_demolition` → confirmar → enviar este POST.

### `buildingConstructionList` — Consultar fila de construção
```
view=buildingConstructionList
cityId={cityId}
position={slot}
currentCityId={cityId}
```

### `buildingSpeedup` + `Premium` — Acelerar construção
```
view=buildingSpeedup
cityId={cityId}
position={slot}
currentCityId={cityId}
```
Se confirmar (gratuito ou ambrosia):
```
action=Premium
function=buildingSpeedup
cityId={cityId}
position={slot}
level=0
backgroundView=city
currentCityId={cityId}
actionRequest={token}
```

---

## 4. Building IDs (confirmados via REC)

| buildingId | Nome | view |
|------------|------|------|
| 0 | Câmara Municipal | townHall |
| 3 | Porto | port |
| 4 | Academia | academy |
| 5 | Templo | temple |
| 6 | Taverna | tavern |
| 7 | Depósito | warehouse |
| 8 | Museu | museum |
| 9 | Estaleiro | shipyard |
| 10 | Quartel | barracks |
| 12 | Escritório Comercial | branchOffice |
| 13 | Embaixada | embassy |
| 15 | Espionagem | safehouse |
| 17 | ? (Doca — req 2º porto) | — |
| 18–35 | ? (capturados na wiki, nomes não extraídos) | — |

---

## 5. Taverna — Ajuste de Vinho

### `tavern` — Abrir taberna
```
view=tavern
cityId={cityId}
position={slot}
currentCityId={cityId}
backgroundView=city
```

### `CityScreen` function=`assignWinePerTick` — **DEFINIR NÍVEL DE VINHO** ✅
```
action=CityScreen
function=assignWinePerTick
cityId={cityId}
position={slot}
amount={indice}        ← ÍNDICE do dropdown (0–18), não o valor em /hora!
currentCityId={cityId}
actionRequest={token}
```
**Notas:**
- `amount` é o **índice** da opção no select (0=sem vinho, 1=3/h, 2=6/h, ... 18=117/h para taberna nível 18).
- O máximo depende do nível da taberna (`setActualValue(N)` onde N = nível).
- Confirmado ao vivo: `amount=0` → `wineSpendings=0`, `amount=18` → `wineSpendings=117`.
- Fluxo correto: GET `view=tavern` → token em `upd[1].actionRequest` → POST imediato.
- URL do POST: `?view=tavern&cityId=...&templateView=tavern&actionRequest={token}&ajax=1`

---

## 6. Academia — Workers / Pesquisa

### `academy` — Abrir academia
```
view=academy
cityId={cityId}
position={slot}
currentCityId={cityId}
backgroundView=city
```

### `IslandScreen` function=`workerPlan` — **ALOCAR CIENTISTAS** ✅
```
action=IslandScreen
function=workerPlan
screen=academy
position={slot}
cityId={cityId}
s={qtdCientistas}      ← número final de cientistas a alocar
currentCityId={cityId}
actionRequest={token}
```
**Notas:** `s` = quantidade desejada de cientistas. Mesmo endpoint para outros edifícios
com workers — muda `screen=` (ex: `screen=barracks`).

### `CityScreen` function=`buyResearch` — **CONDUZIR ENSAIO** (acelerar pesquisa com cristal) ✅
```
action=CityScreen
function=buyResearch
useAthenasScroll=0     ← 1 = usar pergaminho de Atena (premium)
payWithAmbrosia=0      ← 1 = pagar com ambrosia se faltar recursos
cityId={cityId}
position={slot}
currentCityId={cityId}
actionRequest={token}
```
**Resposta com recursos:** pesquisa iniciada.
**Resposta sem recursos:** view `confirmResourcePremiumBuy`.

---

## 7. Câmara Municipal

### `townHall` — Abrir câmara
```
view=townHall
cityId={cityId}
position=0
currentCityId={cityId}
backgroundView=city
```

### `CityScreen` — Renomear cidade
```
action=CityScreen
[form com newCityName]
currentCityId={cityId}
actionRequest={token}
```

---

## 8. Mercado (Escritório Comercial)

### `branchOffice` — Abrir mercado
```
view=branchOffice
cityId={cityId}
position={slot}
currentCityId={cityId}
backgroundView=city
activeTab=tab_branchOffice   ← ou tab_branchOfficeOwnOffers, tab_branchOfficeSoldier, tab_branchOfficeTradePartners
```

### `branchOfficeOwnOffers` — Ver ofertas próprias
```
view=branchOfficeOwnOffers
activeTab=tab_branchOfficeOwnOffers
cityId={cityId}
position={slot}
currentCityId={cityId}
```

### `CityScreen` function=`updateOffers` — **CRIAR/ATUALIZAR OFERTAS** ✅
```
action=CityScreen
function=updateOffers
cityId={cityId}
position={slot}
resourceTradeType=333      ← 333=comprar ou 444=vender (confirmar)
resource={qtdMadeira}
resourcePrice={precoMadeira}
tradegood1TradeType=444    ← tipo da oferta (333 ou 444)
tradegood1={qtdVinho}      ← 0 = sem oferta
tradegood1Price={preco}
tradegood2TradeType=444
tradegood2={qtdMarmore}
tradegood2Price={preco}
tradegood3TradeType=444
tradegood3={qtdCrystal}
tradegood3Price={preco}
tradegood4TradeType=444
tradegood4={qtdEnxofre}
tradegood4Price={preco}
currentCityId={cityId}
currentTab=tab_branchOfficeOwnOffers
actionRequest={token}
```
**Notas:** Um único POST define TODAS as ofertas simultaneamente.
333 e 444 são os valores de tipo — provavelmente 333=comprar, 444=vender (⚠️ confirmar com captura).

---

## 9. Pesquisa Científica

### `noViewChange` researchType — Trocar categoria de pesquisa
```
view=noViewChange
researchType=seafaring    ← categorias: seafaring, economy, knowledge, military, mythology
currentCityId={cityId}
```
**Resposta:** `[updateGlobalData, updateViewScriptData, ...]` — atualiza lista de pesquisas da categoria.

### Iniciar pesquisa específica ⚠️ NÃO CAPTURADO
> Provavelmente `action=CityScreen function=startResearch researchId={id}` ou similar.
> Requer captura clicando numa pesquisa disponível na lista do researchAdvisor.

---

## 10. Espionagem

### `safehouse` — Abrir espionagem
```
view=safehouse
cityId={cityId}
position={slot}
currentCityId={cityId}
backgroundView=city
activeTab=tabSafehouse    ← ou tabReports, tabArchive
```

### `sendSpy` — Formulário de envio de espiões
```
view=sendSpy
isMission=1
destinationCityId={cidadeAlvo}
islandId={ilhaAlvo}
currentIslandId={ilhaAtual}
```

### `Espionage` function=`sendSpy` — **ENVIAR ESPIÃO** ✅
```
action=Espionage
function=sendSpy
tab=tabSafehouse
destinationCityId={cidadeAlvo}
cityId={ilhaAtual}         ← ⚠️ campo se chama cityId mas recebe islandId
islandId={ilhaAtual}
spies[{cidadeOrigem}][agents]={qtdEspioes}
spies[{cidadeOrigem}][decoys]=0
currentIslandId={ilhaAtual}
actionRequest={token}
```

---

## 11. Militar — Frotas e Exércitos

### `militaryAdvisor` — Painel militar
```
view=militaryAdvisor
oldView={viewAnterior}
currentCityId={cityId}    ← ou currentIslandId se em ilha
```
**viewScriptParams:** `militaryAndFleetMovements[]` — lista de missões com `eventId`, `eventTime` (ETA Unix), `isFleetReturning`, `missionType`, `cargo`.

### `cityDetails` — Detalhes de cidade alheia (prep para missão)
```
view=cityDetails
isMission=1
destinationCityId={cidadeAlvo}
islandId={ilhaAlvo}
currentIslandId={ilhaAtual}
backgroundView=island
```

### `transportOperations` function=`deployFleet` — **TRANSFERIR BARCOS**
```
action=transportOperations
function=deployFleet
islandId={ilhaAtual}
destinationCityId={destino}
cargo_fleet_210={qtd}   cargo_fleet_210_upkeep=15   ← 210 = trade ship
cargo_fleet_213={qtd}   cargo_fleet_213_upkeep=20
deploymentType=fleet
currentIslandId={ilhaAtual}
actionRequest={token}
```

### `transportOperations` function=`deployArmy` — **MOVER EXÉRCITO**
```
action=transportOperations
function=deployArmy
islandId={ilhaAtual}
destinationCityId={destino}
cargo_army_302={qtd}   cargo_army_302_upkeep=4
cargo_army_303={qtd}   cargo_army_303_upkeep=3    ← 303 = Cozinheiro
cargo_army_304={qtd}   cargo_army_304_upkeep=3
cargo_army_310={qtd}   cargo_army_310_upkeep=10
cargo_army_311={qtd}   cargo_army_311_upkeep=20
deploymentType=army
currentIslandId={ilhaAtual}
actionRequest={token}
```

---

## 12. Ilha — Recursos e Bárbaros

### `tradegood` — Vinha/Mina na ilha
```
view=tradegood
type={tipoTradegood}   ← 1=vinho, 2=mármore, 3=crystal, 4=enxofre
islandId={ilha}
backgroundView=island
currentIslandId={ilha}
```

### `IslandScreen` (donateForm) — Doação de madeira para recurso da ilha
```
action=IslandScreen
[form#donateForm — campo donateWood={valor}]
currentIslandId={ilha}
actionRequest={token}
```

### `barbarianVillage` — Ver vila bárbara
```
view=barbarianVillage
destinationIslandId={ilhaComVila}
islandId={ilhaAtual}
currentIslandId={ilhaAtual}
backgroundView=island
```

### `transportOperations` function=`attackBarbarianVillage` — **ATACAR BÁRBAROS**
```
action=transportOperations
function=attackBarbarianVillage
islandId={ilha}
destinationCityId=0
barbarianVillage=1
cargo_army_303={qtd}   cargo_army_303_upkeep=3
cargo_army_302={qtd}   cargo_army_302_upkeep=4
[... outras unidades ...]
transporter={qtdNavios}
currentIslandId={ilha}
actionRequest={token}
```

---

## 13. Estaleiro e Quartel

### `BuildShips` — **CONSTRUIR NAVIOS**
```
action=BuildShips
210={qtdTradeship}
211=0 212=0 213=0 214=0 215=0 216=0 217=0 218=0 219=0 220=0
cityId={cityId}
position={slot}
currentCityId={cityId}
actionRequest={token}
```
**Nota:** 210 = trade ship. Campo por shipTypeId, zero para não construir.

### `BuildUnits` — **RECRUTAR UNIDADES**
```
action=BuildUnits
301=0 302=0 303=0 304=0 305=0 306=0 307=0 308=0 309=0 310=0 311={qtd} 312=0 313=0 315=0
cityId={cityId}
position={slot}
currentCityId={cityId}
actionRequest={token}
```
**Nota:** campo por unitTypeId, zero para não recrutar.

---

## 14. Painel Global (Header)

### `merchantNavy` — Frota de Comércio (navios livres/em missão)
```
view=merchantNavy
currentCityId={cityId}
```
Abre clicando no contador de navios no header. Mostra total de navios, livres, em missão.

### `finances` — Finanças (ouro, receitas, despesas)
```
view=finances
currentCityId={cityId}
```
Abre clicando no ouro no header. Mostra receitas, upkeep de exército e frota, saldo/hora.

---

## 15. Museu e Diplomacia

### `culturalPossessions_assign` — Ver distribuição de bens culturais
```
view=culturalPossessions_assign
cityId={cityId}
position={slotMuseu}
currentCityId={cityId}
```

### `culturalPossessions` function=`assign` — **REDISTRIBUIR BENS CULTURAIS** ✅
```
action=culturalPossessions
function=assign
goodscity_{cityId1}={qtd}   ← um campo por cidade própria
goodscity_{cityId2}={qtd}
goodscity_{cityId3}={qtd}
goodscity_{cityId4}={qtd}
goodscity_{cityId5}={qtd}
position={slotMuseu}
currentCityId={cityId}
actionRequest={token}
```

### `diplomacyTreaty` — Tratados ativos
```
view=diplomacyTreaty
activeTab=tab_diplomacyTreaty
currentCityId={cityId}
```

### `diplomacyIslandBoard` — Quadro de avisos da ilha
```
view=diplomacyIslandBoard
activeTab=tab_diplomacyIslandBoard
currentCityId={cityId}
```

---

## 16. Fluxo Padrão de Automação

### Enviar transporte:
1. `header function=changeCurrentCity` → navegar para cidade origem
2. `transport` → obter `normalTransportersMax`, `islandId` do destino, token atualizado
3. `transportOperations function=loadTransportersWithFreight`

### Construir/melhorar edifício:
1. `header` → navegar para cidade alvo (se diferente)
2. `{view}` → abrir edifício para obter token + `level` atual
3. `UpgradeExistingBuilding` ou `BuildNewBuilding`
4. Verificar resposta: se `confirmResourcePremiumBuy` → recursos insuficientes

### Ajustar vinho:
1. `CityScreen function=assignWinePerTick amount={valor}`

### Alocar cientistas:
1. `IslandScreen function=workerPlan screen=academy s={qtd}`

### Monitorar frotas:
1. `militaryAdvisor` → parsear `viewScriptParams.militaryAndFleetMovements`
2. Cada missão: `eventId`, `eventTime` (ETA Unix), `isFleetReturning`, `missionType`

### Criar ofertas de mercado:
1. `branchOfficeOwnOffers` → obter estado atual + token
2. `CityScreen function=updateOffers` com todos os campos resource + tradegood1–4

---

## 17. Endpoints Pendentes

| Endpoint | Status | Notas |
|----------|--------|-------|
| Iniciar pesquisa específica | ⚠️ não capturado | Clicar numa pesquisa no researchAdvisor |
| `resourceTradeType` 333 vs 444 | ⚠️ confirmar | 333=comprar? 444=vender? Testar com oferta conhecida |
| `deleteOffer` | ⚠️ não capturado | Pode ser `updateOffers` com qtd=0 |
| `populationManagement` (townHall sliders) | ⚠️ não capturado | Workers de madeira/luxo direto na câmara |
| `deploymentType=spy` | ⚠️ não capturado | Espionagem militar ativa |
| Building IDs 18–35 | ⚠️ nomes ausentes | HTML das buildingDetail não lido |
