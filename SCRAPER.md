# SCRAPER.md — Mapeamento de Scraping

> Referência técnica do scraper Playwright para coleta de dados do Ikariam.
> Todos os seletores aqui foram **confirmados via inspeção do HTML real** em 2026-03-29.
> Seletores hipotéticos ou não validados são marcados explicitamente.
>
> Servidor de referência: `s73-br.ikariam.gameforge.com`
> Implementação: `scraper_explore.mjs` + `modules/BuildingScraper.mjs`

---

## Índice

1. [Estratégia geral](#1-estratégia-geral)
2. [Navegação e sessão](#2-navegação-e-sessão)
3. [View: city](#3-view-city)
4. [View: townHall](#4-view-townhall)
5. [View: island](#5-view-island)
6. [Edifícios via AJAX](#6-edifícios-via-ajax)
7. [Tabela de next_level_effect por edifício](#7-tabela-de-next_level_effect-por-edifício)
8. [Regras de parsing numérico](#8-regras-de-parsing-numérico)
9. [Chave única de edifício](#9-chave-única-de-edifício)
10. [Status de cobertura](#10-status-de-cobertura)

---

## 1. Estratégia geral

- Scraper usa **Playwright** com perfil de browser persistente (`./browser_profile`)
- Sessão reutilizada — sem login programático
- Navegação por URL direta: `SERVER_BASE/index.php?view={view}&cityId={id}`
- Edifícios coletados via **endpoint AJAX** (`ajax=1`), não via navegação de página
- HTML bruto de cada view salvo em `./scraper_dumps/` para auditoria
- Relatório final em `scraper_report.json`

---

## 2. Navegação e sessão

```
START_URL = https://s73-br.ikariam.gameforge.com/?view=city&cityId=6583
```

Se sessão expirada, o jogo redireciona para o lobby. O scraper:
1. Aguarda o botão do servidor: `button.button-default:has-text("Jogou pela última vez")`
2. Clica → jogo abre em nova aba
3. Detecta a nova aba com `context.pages().find(p => p.url().includes('s73-br'))`

**Espera de carregamento:** `domcontentloaded` + `networkidle` (timeout 5s, não fatal)

---

## 3. View: city

**URL:** `?view=city&cityId={id}`

### Recursos e ouro

| Campo | Seletor | Tipo | Status |
|---|---|---|---|
| Madeira atual | `#js_GlobalMenu_wood` | textContent | CONFIRMED |
| Vinho atual | `#js_GlobalMenu_wine` | textContent | CONFIRMED |
| Mármore atual | `#js_GlobalMenu_marble` | textContent | CONFIRMED |
| Cristal atual | `#js_GlobalMenu_crystal` | textContent | CONFIRMED |
| Enxofre atual | `#js_GlobalMenu_sulfur` | textContent | CONFIRMED |
| Ouro (abreviado) | `#js_GlobalMenu_gold` | textContent | CONFIRMED |
| Ouro (total numérico) | `#js_GlobalMenu_gold_Total` | textContent | CONFIRMED |
| Rendimento/h | `#js_GlobalMenu_income` | textContent | CONFIRMED |
| Manutenção/h | `#js_GlobalMenu_upkeep` | textContent | CONFIRMED |
| Cientistas (custo/h) | `#js_GlobalMenu_scientistsUpkeep` | textContent | CONFIRMED |
| Ouro líquido/h | `#js_GlobalMenu_gold_Calculation` | textContent | CONFIRMED |

### Capacidade de armazém

| Campo | Seletor | Status |
|---|---|---|
| Cap. madeira | `#js_GlobalMenu_max_wood` | CONFIRMED |
| Cap. vinho | `#js_GlobalMenu_max_wine` | CONFIRMED |
| Cap. mármore | `#js_GlobalMenu_max_marble` | CONFIRMED |
| Cap. enxofre | `#js_GlobalMenu_max_sulfur` | CONFIRMED |

### Produção por hora

| Campo | Seletor | Status |
|---|---|---|
| Produção cristal/h | `#js_GlobalMenu_production_crystal` | CONFIRMED |
| Produção madeira/h | `#js_GlobalMenu_production_wood` | NÃO CONFIRMADO |
| Produção vinho/h | `#js_GlobalMenu_production_wine` | NÃO CONFIRMADO |
| Produção mármore/h | — | NÃO LOCALIZADO |
| Produção enxofre/h | — | NÃO LOCALIZADO |

### Cidade e edifícios

| Campo | Fonte | Status |
|---|---|---|
| Nome da cidade | `#js_oldCityName` (textContent) | CONFIRMED |
| cityId | `URLSearchParams(location.search).get('cityId')` | CONFIRMED |
| Slots vazios | `querySelectorAll('[class*="buildingGround"]').length` | CONFIRMED |
| Lista de edifícios | JSON inline `updateBackgroundData.position[]` | CONFIRMED — ver seção 6 |

### Extração do position[]

Os dados de edifícios **não** são variável global — estão embutidos num script inline:

```js
ikariam.getClass(ajax.Responder, [["updateBackgroundData", {..., "position": [...]}], ...])
```

Extração via balanço de chaves durante `page.evaluate` (enquanto o script ainda está no DOM):

```js
const scripts = [...document.querySelectorAll('script:not([src])')];
for (const s of scripts) {
  const t = s.textContent;
  const i = t.indexOf('"updateBackgroundData"');
  if (i === -1) continue;
  const start = t.indexOf('{', i);
  let depth = 0, j = start;
  for (; j < t.length; j++) {
    if (t[j] === '{') depth++;
    else if (t[j] === '}') { depth--; if (depth === 0) break; }
  }
  const obj = JSON.parse(t.slice(start, j + 1));
  if (Array.isArray(obj.position)) return obj.position;
}
```

**Importante:** deve ser feito na mesma navegação da city view. Após navegar para outra view, o script já foi executado e removido do DOM.

---

## 4. View: townHall

**URL:** `?view=townHall&cityId={id}`

| Campo | Seletor | Tipo | Status |
|---|---|---|---|
| População atual | `#js_TownHallOccupiedSpace` | textContent | CONFIRMED |
| Capacidade máxima | `#js_TownHallMaxInhabitants` | textContent | CONFIRMED |
| Crescimento/h | `#js_TownHallPopulationGrowthValue` | textContent | CONFIRMED |
| Satisfação (texto) | `#js_TownHallHappinessSmallText` | textContent | CONFIRMED |
| Satisfação (classe) | `#js_TownHallHappinessSmall` | className | CONFIRMED |
| Satisfação total (número) | — | — | NÃO LOCALIZADO como ID isolado |
| Corrupção | `#js_TownHallCorruption` | textContent | CONFIRMED |
| Rendimento cidade | `#js_TownHallIncomeGoldValue` | textContent | CONFIRMED |
| Limite tropas terrestres | `#js_TownHallGarrisonLimitLand` | textContent | CONFIRMED |
| Limite tropas marítimas | `#js_TownHallGarrisonLimitSea` | textContent | CONFIRMED |
| Pontos de ação | `#js_TownHallActionPointsAvailable` | textContent | CONFIRMED |
| Pontos de ação (máx) | `#js_TownHallMaxActionPointsAvailable` | textContent | CONFIRMED |

### Composição da satisfação (granular)

| Campo | Seletor | Status |
|---|---|---|
| Bônus básico | `#js_TownHallSatisfactionOverviewBaseBoniBaseBonusValue` | CONFIRMED |
| Bônus governo | `#js_TownHallSatisfactionOverviewBaseBoniGovernmentBonusValue` | CONFIRMED |
| Bônus pesquisa | `#js_TownHallSatisfactionOverviewBaseBoniResearchBonusValue` | CONFIRMED |
| Bônus capital | `#js_TownHallSatisfactionOverviewBaseBoniCapitalBonusValue` | CONFIRMED |
| Bônus vinho (taberna) | `#js_TownHallSatisfactionOverviewWineBoniTavernBonusValue` | CONFIRMED |
| Bônus vinho (serviço) | `#js_TownHallSatisfactionOverviewWineBoniServeBonusValue` | CONFIRMED |
| Bônus cultura (museu) | `#js_TownHallSatisfactionOverviewCultureBoniMuseumBonusValue` | CONFIRMED |
| Bônus tratados | `#js_TownHallSatisfactionOverviewCultureBoniTreatyBonusValue` | CONFIRMED |
| Dedução superpopulação | `#js_TownHallSatisfactionOverviewOverpopulationMalusValue` | CONFIRMED |

**Observação:** `townHall` retorna texto de satisfação sujo (whitespace excessivo). Usar `.replace(/\s+/g, ' ').trim()` antes de parsear.

---

## 5. View: island

**URL:** `?view=island&cityId={id}`

| Campo | Fonte | Seletor/Campo | Status |
|---|---|---|---|
| Coordenada X | JSON `updateBackgroundData` | `islandXCoord` | CONFIRMED |
| Coordenada Y | JSON `updateBackgroundData` | `islandYCoord` | CONFIRMED |
| ID da ilha | JSON | `islandId` | CONFIRMED |
| Nome da ilha | JSON | `islandName` | CONFIRMED |
| Recurso base (título) | `#js_islandResourceLink` | atributo `title` | CONFIRMED |
| Recurso base (scroll) | `#js_islandResourceScrollTitle` | textContent | CONFIRMED |
| Recurso especial (título) | `#js_islandTradegoodLink` | atributo `title` | CONFIRMED |
| Recurso especial (scroll) | `#js_islandTradegoodScrollTitle` | textContent | CONFIRMED |
| Tipo recurso especial | JSON | `tradegood` (int: 1=vinho, 2=mármore, 3=cristal, 4=enxofre) | CONFIRMED |
| Nível serraria | JSON | `resourceLevel` | CONFIRMED |
| Nível mina especial | JSON | `tradegoodLevel` | CONFIRMED |
| Maravilha (nome) | JSON | `wonderName` | CONFIRMED |
| Maravilha (nível) | JSON | `wonderLevel` | CONFIRMED |
| Maravilha (link) | `#js_islandWonderLink` | atributo `href` | CONFIRMED |
| Cidades na ilha | JSON array | `cities[]` | CONFIRMED |

---

## 6. Edifícios via AJAX

### Endpoint

```
GET /index.php?view={building_type}&cityId={cityId}&position={array_index}&ajax=1
```

**`position`** = posição serial no array `position[]` do `updateBackgroundData` (0..N).
**Não usar `groundId`** — groundId é o tipo de slot, não o identificador da posição.

### Extração do HTML

A resposta é um array JSON. O HTML do edifício está em:

```js
data.find(d => d[0] === 'changeView')?.[1]?.[1]
```

### Estrutura do position[]

Cada entrada em `position[]` tem:

```json
{
  "buildingId": 4,
  "name": "Academia",
  "level": 19,
  "isBusy": false,
  "canUpgrade": false,
  "isMaxLevel": false,
  "building": "academy",
  "groundId": 2,
  "allowedBuildings": [...]
}
```

- `building` = tipo usado no endpoint (`view=academy`)
- `groundId` = tipo de slot: `0`=townHall, `1`=litoral, `2`=terra, `3`=muralha, `4`=mar, `5`=doca
- `buildingId null` = slot vazio (`building` = `"buildingGround land"` ou similar)

### Campos coletados por edifício

| Campo | Fonte | Status |
|---|---|---|
| `level` | `position[]` | CONFIRMED — nunca extrair do HTML AJAX |
| `can_upgrade` | `position[].canUpgrade` | CONFIRMED |
| `is_busy` | `position[].isBusy` | CONFIRMED |
| `is_max_level` | `position[].isMaxLevel` | CONFIRMED |
| `upgrade_costs` | `ul.resources li` no HTML AJAX | CONFIRMED |
| `upgrade_time_text` | `li.time` no HTML AJAX | CONFIRMED |
| `upgrade_time_seconds` | derivado de `upgrade_time_text` | CONFIRMED |
| `next_level_effect_raw` | varia por prédio — ver seção 7 | PARCIAL |
| `next_level_effect_parsed` | derivado de `next_level_effect_raw` | PARCIAL |
| `effect_type` | classificado por prédio | PARCIAL |

### Custos de upgrade

```js
// Seletor confirmado
const items = doc.querySelectorAll('ul.resources li');
// Cada <li> tem classe do recurso: wood, wine, marble, crystal, sulfur
// Remover .accesshint antes de ler textContent
li.cloneNode(true).querySelectorAll('.accesshint').forEach(n => n.remove());
```

### Tempo de upgrade

- Seletor confirmado: `li.time`
- Estrutura: `"6h 13m\n<tooltip...>"` — pegar só a primeira linha não-vazia
- Converter para segundos: parse de `Nd`, `Nh`, `Nm`, `Ns`

---

## 7. Tabela de next_level_effect por edifício

| Edifício | Seletor | Fallback | Raw exemplo | Parsed | Tipo | Status |
|---|---|---|---|---|---|---|
| warehouse | `#informationSidebar td.amount` (non-empty) | `.sidebar_table td.amount` | `+480` | `480` | capacity | CONFIRMED |
| carpentering | `#informationSidebar td.center` (non-empty) | — | `-27,00%` | `-27` | reduction | CONFIRMED |
| forester | `#informationSidebar td.info.center` (non-empty) | `.sidebar_table td:last-child` | `+20%` | `20` | percent | CONFIRMED |
| glassblowing | `#informationSidebar td.info.center` (non-empty) | — | `+26%` | `26` | percent | CONFIRMED |
| stonemason | `#informationSidebar td.info.center` (non-empty) | — | `+32%` | `32` | percent | CONFIRMED |
| alchemist | `#informationSidebar td.info.center` (non-empty) | — | `+24%` | `24` | percent | CONFIRMED |
| palaceColony | `#informationSidebar .content` | — | `Corrupção: -0%` | `0` | percent | CONFIRMED |
| academy | `#valueResearch` | — | `+164` | `164` | production | REQUIRES_DERIVATION¹ |
| tavern | `#wineAmount option:last-child` | — | `112 Vinho por hora` | `112` | capacity | REQUIRES_DERIVATION² |
| museum | — | — | — | — | unknown | NOT_EXPOSED_IN_AJAX |
| palace | — | — | — | — | unknown | NOT_EXPOSED_IN_AJAX |
| port | — | — | — | — | unknown | NOT_EXPOSED_IN_AJAX |
| townHall | — | — | — | — | unknown | NOT_EXPOSED_IN_AJAX |
| workshop | — | — | — | — | unknown | NOT_EXPOSED_IN_AJAX |
| wall | — | — | — | — | unknown | NOT_EXPOSED_IN_AJAX |
| safehouse | — | — | — | — | unknown | NOT_EXPOSED_IN_AJAX |
| vineyard | — | — | — | — | unknown | NOT_EXPOSED_IN_AJAX |
| winegrower | `#informationSidebar td.info.center` (non-empty) | — | — | — | percent | CONFIRMED (seletor) / sem dado |

> ¹ **academy:** `#valueResearch` retorna a produção **atual** de pesquisa, não o efeito do próximo nível. O próximo nível permite +1 cientista adicional — requer derivação externa.
>
> ² **tavern:** `#wineAmount option:last-child` retorna o máximo de vinho/h servível no nível **atual**, não no próximo. Para o próximo nível, requer derivação via tabela de progressão da taberna.

**Padrão do `#informationSidebar`:** A primeira `td` de cada classe é sempre um ícone/imagem vazia. O valor real está na segunda. Sempre usar `.find(td => td.textContent.trim().length > 0)` para pular a primeira.

---

## 8. Regras de parsing numérico

Implementado em `parseIkariamNumber()` em `modules/BuildingScraper.mjs`.

| Input | Output | Observação |
|---|---|---|
| `"1.928"` | `1928` | Ponto = separador de milhar |
| `"+1.332"` | `1332` | Sinal positivo ignorado |
| `"-3.052"` | `-3052` | Sinal negativo preservado |
| `"0.00"` | `0` | Decimal com vírgula |
| `"2,93M"` | `2930000` | Sufixo M |
| `"1,5K"` | `1500` | Sufixo K |
| `"313 + 156"` | `{ raw, parts: [313,156], sum: 469, meaning: "unknown_until_validated" }` | Campo composto — nunca colapsar |
| `"-27,00%"` | `-27` | Remove % e converte vírgula |

**Regra crítica:** `"313 + 156"` nunca deve ser colapsado em `313156`. Campos compostos retornam objeto estruturado para validação manual.

---

## 9. Chave única de edifício

**Chave:** `cityId + array_index`

onde `array_index` é a posição serial (0..N) no array `position[]` do `updateBackgroundData`.

**Por que não outros campos:**

| Campo | Motivo de rejeição |
|---|---|
| `groundId` | Tipo de slot — múltiplos prédios compartilham o mesmo (`groundId=2` = todos os prédios de terra) |
| `buildingId` | ID do tipo de prédio — 3 armazéns têm o mesmo `buildingId=7` |
| `building_type` | Não único — dois portos, três armazéns |
| `position` no endpoint | Alias de `array_index` — é o mesmo valor |

**Porto "duplicado":** Dois portos em `array_index=1` e `array_index=2` são instâncias reais e independentes no mesmo slot litoral (`groundId=1`). Cada um tem seu endpoint: `position=1` e `position=2`.

---

## 10. Status de cobertura

### Confirmado

- Todos os recursos atuais da city (`wood`, `wine`, `marble`, `crystal`, `sulfur`)
- Ouro total, rendimento, manutenção, líquido
- Capacidade de armazém (4 recursos)
- Nome da cidade, cityId, slots vazios
- Lista de edifícios completa via `position[]`
- Nível, `canUpgrade`, `isBusy`, `isMaxLevel` de todos os edifícios
- Custos de upgrade para todos os edifícios
- Tempo de upgrade (texto limpo + segundos) para todos os edifícios
- `next_level_effect` para: warehouse, carpentering, forester, glassblowing, stonemason, alchemist, palaceColony
- Dados completos da ilha (coordenadas, recurso, maravilha, níveis)
- Dados completos da townHall (população, crescimento, satisfação, tropas, ouro)

### Parcial / Requires Derivation

- `next_level_effect` de academy (produção atual, não próximo nível)
- `next_level_effect` de tavern (capacidade atual, não próximo nível)
- Produção por hora (só cristal confirmado; madeira, vinho, mármore, enxofre não localizados)
- Satisfação total numérica (sem ID isolado — calculada a partir dos sub-componentes)

### Não localizado / NOT_EXPOSED_IN_AJAX

- `next_level_effect` de: museum, palace, port, townHall, workshop, wall, safehouse, vineyard
- Workforce atual (está no JSON `dataSetForView.citizens`, não num seletor direto)
