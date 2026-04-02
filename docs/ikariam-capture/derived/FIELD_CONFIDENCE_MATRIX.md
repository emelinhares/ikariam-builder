# FIELD_CONFIDENCE_MATRIX

Confidence matrix for confirmed Town Hall/model/html_request fields integrated into typed ERP state.

## Confidence levels used

- **high**: confirmed and decision-driving in current capture basis.
- **medium**: confirmed with context dependency (typically requires inspected view).
- **low**: partial or semantically ambiguous; keep as observational only.

## Source precedence rules (state merge)

1. Town Hall HTML has high precedence when `townHall` view is inspected.
2. Model remains fallback outside inspected Town Hall context.
3. Mismatch between model and Town Hall HTML for same semantic metric must be recorded.
4. Confidence is stored per field in typed state metadata.

## Field confidence table

| Field | Preferred source | Fallback source | Confidence | Status |
|---|---|---|---|---|
| `localWood` | model | none | high | confirmed |
| `population` | model | none | high | confirmed |
| `citizens` | townHall html (`citizensCity`) when inspected | model `currentResources.citizens` | medium | confirmed |
| `populationUsed` | townHall html | none | high | confirmed |
| `maxInhabitants` | townHall html | model `city.maxInhabitants` | high | confirmed |
| `populationUtilization` | calculated from typed parents | none | high | derived |
| `populationGrowthPerHour` | townHall html | model `populationGrowthValue` | high | confirmed |
| `netGoldPerHour` | townHall html | model `income/gold` | high | confirmed |
| `corruptionPct` | townHall html | model `city.corruption` | high | confirmed |
| `actionPointsAvailable` | townHall html | model `maxActionPoints` | medium | confirmed |
| `happinessScore` | townHall html | model `city.satisfaction` | high | confirmed |
| `happinessState` | townHall html | none | medium | confirmed |
| `happinessBaseBonus` | townHall html | none | medium | confirmed |
| `happinessResearchBonus` | townHall html | none | medium | confirmed |
| `happinessTavernBonus` | townHall html | none | medium | confirmed |
| `happinessServedWineBonus` | townHall html | none | medium | confirmed |
| `woodPerHourCity` | townHall html | model-derived `resourceProduction*3600` | high | confirmed |
| `tradegoodPerHourCity` | townHall html | model-derived `tradegoodProduction*3600` | high | confirmed |
| `scientistsGoldCostPerHour` | townHall html | none | medium | confirmed |
| `researchPointsPerHour` | townHall html | model `research.pointsPerHour` | medium | confirmed |
| `priestsGoldPerHour` | townHall html | none | medium | confirmed |
| `citizensGoldPerHour` | townHall html | none | medium | confirmed |
| `woodWorkersCity` | townHall html | model workers wood | high | confirmed |
| `tradegoodWorkersCity` | townHall html | model workers tradegood | high | confirmed |
| `scientistsCity` | townHall html | model workers scientists | high | confirmed |
| `priestsCity` | townHall html | model workers priests | high | confirmed |
| `citizensCity` | townHall html | model citizens | high | confirmed |
| `wineSpendings` | model | none | high | confirmed |
| `freeTransporters` | model | none | high | confirmed |
| `maxTransporters` | html | model | medium | confirmed |
| `buyTransporterCostGold` | html | none | medium | confirmed |
| `islandResourceWorkers` | html_request | none | medium | confirmed |
| `islandTradegoodWorkers` | html_request | none | medium | confirmed |
| `resourcePerHourIslandPreview` | html | none | medium | confirmed |
| `workCostIslandPreview` | html | none | medium | confirmed |
| `overpopulationMalusRaw` | html | none | low | partial |

## Partial field handling

- `overpopulationMalusRaw` is explicitly **partial** and must not drive readiness/growth semantics yet.
- It can be persisted for observability and future disambiguation only.

