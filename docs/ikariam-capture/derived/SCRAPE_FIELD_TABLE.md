# SCRAPE_FIELD_TABLE

Derived table of confirmed/derived/partial fields promoted from scrape evidence into ERP typed state.

Source basis: `Town Hall`, `Tavern`, `workerPlan`, `assignWinePerTick`, island `workerPlan`, `donation`, `increaseTransporter`, `startColonization`, and `militaryAdvisor` captures.

## Status legend

- **confirmed**: direct evidence in current scrape set and safe to consume in typed state.
- **derived**: deterministic calculation from confirmed fields.
- **partial**: observed but semantic meaning still ambiguous.

## Field mapping table

| Field | Source | Raw source | Type | Status | Notes |
|---|---|---|---|---|---|
| `localWood` | model | `currentResources.resource` | number | confirmed | Confirmed as local wood |
| `population` | model | `currentResources.population` | number | confirmed |  |
| `citizens` | model (fallback) | `currentResources.citizens` | number | confirmed | Keep model fallback; Town Hall HTML can be stronger when inspected |
| `populationUsed` | html | `Housing space: X / Y` | number | confirmed | Example: `378` |
| `maxInhabitants` | html | `Housing space: X / Y`, `js_TownHallMaxInhabitants` | number | confirmed | Example: `1370` |
| `populationUtilization` | calculated | `populationUsed / maxInhabitants` | number | derived | Ratio in `[0, +∞)` |
| `populationGrowthPerHour` | html | `js_TownHallPopulationGrowth` | number | confirmed | Example: `15.1` |
| `netGoldPerHour` | html | `js_TownHallIncomeGold` | number | confirmed | Example: `834` |
| `corruptionPct` | html | `js_TownHallCorruption` | number | confirmed | Example: `0` |
| `actionPointsAvailable` | html | `js_TownHallActionPointsAvailable` | number | confirmed | Example: `5` |
| `happinessScore` | html | `js_TownHallHappinessLargeValue` | number | confirmed | Examples: `752`, `49`, `-11` |
| `happinessState` | html | `js_TownHallHappinessLargeText` | string | confirmed | Enum candidates: `EUPHORIC`, `HAPPY`, `NEUTRAL`, `UNHAPPY` |
| `happinessBaseBonus` | html | `js_TownHallSatisfactionOverviewBaseBoniBaseBonusValue` | number | confirmed | Example: `196` |
| `happinessResearchBonus` | html | `js_TownHallSatisfactionOverviewBaseBoniResearchBonusValue` | number | confirmed | Example: `25` |
| `happinessTavernBonus` | html | `js_TownHallSatisfactionOverviewWineBoniTavernBonusValue` | number | confirmed | Example: `152` |
| `happinessServedWineBonus` | html | `js_TownHallSatisfactionOverviewWineBoniServeBonusValue` | number | confirmed | Examples: `0`, `758` |
| `woodPerHourCity` | html | `js_TownHallPopulationGraphWoodProduction` | number | confirmed | Examples: `34`, `339` |
| `tradegoodPerHourCity` | html | `js_TownHallPopulationGraphTradeGoodProduction` | number | confirmed | Examples: `35`, `153` |
| `scientistsGoldCostPerHour` | html | `js_TownHallPopulationGraphScientistsResearchCost` | number | confirmed | Example: `-120` |
| `researchPointsPerHour` | html | `js_TownHallPopulationGraphScientistsResearchProduction` | number | confirmed | Example: `21` |
| `priestsGoldPerHour` | html | `js_TownHallPopulationGraphPriestsGoldProduction` | number | confirmed | Example: `0` |
| `citizensGoldPerHour` | html | `js_TownHallPopulationGraphCitizensGoldProduction` | number | confirmed | Examples: `243`, `956` |
| `woodWorkersCity` | html | `js_TownHallPopulationGraphResourceWorkerCount` | number | confirmed | Example: `195` |
| `tradegoodWorkersCity` | html | `js_TownHallPopulationGraphSpecialWorkerCount` | number | confirmed | Example: `87` |
| `scientistsCity` | html | `js_TownHallPopulationGraphScientistCount` | number | confirmed | Example: `20` |
| `priestsCity` | html | `js_TownHallPopulationGraphPriestCount` | number | confirmed | Example: `0` |
| `citizensCity` | html | `js_TownHallPopulationGraphCitizenCount` | number | confirmed | Example: `81` |
| `wineSpendings` | model | `wineSpendings` | number | confirmed | Examples: `0`, `13`, `78` |
| `freeTransporters` | model | `freeTransporters` | number | confirmed | Examples: `0`, `1`, `3`, `4` |
| `maxTransporters` | html | `js_GlobalMenu_maxTransporters` | number | confirmed | Example: `51` |
| `buyTransporterCostGold` | html | `js_transporterCosts.gold` | number | confirmed | Example: `47533` |
| `islandResourceWorkers` | html_request | `valueWorkers + workerPlan type=resource rw` | number | confirmed |  |
| `islandTradegoodWorkers` | html_request | `valueWorkers + workerPlan type=tradegood tw` | number | confirmed |  |
| `resourcePerHourIslandPreview` | html | `valueResource` | number | confirmed | Examples: `35`, `144`, `287` |
| `workCostIslandPreview` | html | `valueWorkCosts` | number | confirmed | Examples: `138`, `300`, `405` |
| `overpopulationMalusRaw` | html | `js_TownHallSatisfactionOverviewOverpopulationMalusValue` | number | partial | Do not promote as finalized semantic malus yet |

## Merge precedence adopted for typed state

1. When `townHall` was inspected for city context, prefer Town Hall HTML values for population/workforce/happiness/economy metrics.
2. Outside inspected Town Hall context, keep model values as fallback.
3. Keep both traces (source + confidence) and record mismatch when HTML and model diverge for same semantic field.

