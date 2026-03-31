# FIELD_CONFIDENCE_MATRIX

Source basis: [`docs/ikariam-capture/extraction-catalog-status.json`](docs/ikariam-capture/extraction-catalog-status.json), [`docs/ikariam-capture/semantic-erp.json`](docs/ikariam-capture/semantic-erp.json), [`docs/ikariam-capture/semantic-raw.json`](docs/ikariam-capture/semantic-raw.json).

## Global snapshot

- Selected fields: **62**
- Catalog status:
  - `implemented`: **39**
  - `partial`: **8**
  - `pending`: **15**
- Entities with only null values in current capture: **research**

## Classification model used here

- **Reliable / Decision-driving**: can be used for critical automation decisions.
- **Partial / Guarded-decision**: usable only with fallback or post-validation.
- **Audit-only**: useful for observability, not for critical branching.
- **Do-not-drive-critical**: pending/null-only or ambiguous signals.

---

## A) Reliable / Decision-driving fields

### City / context
- `city.cityId` (implemented)
- `city.name` (implemented)
- `city.coords` (implemented)
- `city.resourceType` (implemented)

### Economy (core)
- `economy.wood`, `economy.wine`, `economy.marble`, `economy.glass`, `economy.sulfur` (implemented)
- `economy.gold` (implemented)
- `economy.storageCapacity` (implemented)
- `economy.population`, `economy.freePopulation` (implemented)
- `economy.wineConsumption` (implemented)

### Buildings / construction
- `buildings.buildingType`, `buildings.position`, `buildings.level`, `buildings.isEmptySlot` (implemented)
- `buildings.upgradeCost`, `buildings.upgradeTime`, `buildings.requirements` (implemented)
- `buildings.blockedReason`, `buildings.upgradeEnabled` (implemented)
- `construction.currentConstruction`, `construction.constructionRemainingTime`, `construction.queueBusy` (implemented)

### Logistics
- `logistics.availableFreighters`, `logistics.occupiedFreighters` (implemented)
- `logistics.activeRoutes` (implemented)
- `logistics.transportValidation` (implemented)
- `logistics.portBlocked` (implemented)

### Action validation and audit baseline
- `actionValidation.actionSuccess` (implemented; non-null in all 14 records)
- `actionValidation.stateChanged` (partial in catalog, but non-null in all 14 records; use with context)
- `audit.currentView`, `audit.currentCityId`, `audit.requestCommands`, `audit.modelHash`, `audit.serverTime` (implemented)

---

## B) Partial / Guarded-decision fields

- `city.islandId` (partial; null-only in current capture)
- `economy.productionPerHour` (partial, calculated)
- `logistics.cargoCapacity` (partial approximation)
- `logistics.eta` (partial; non-null but often `0` in sample)
- `military.maintenance` (partial)
- `actionValidation.actionBlockReason` (partial but null-only in current capture)
- `actionValidation.stateChanged` (partial in catalog despite current non-null)
- `audit.pageHash` (partial, null-only currently)

**Rule**: these fields must be coupled with stronger primary signals before triggering critical action.

---

## C) Audit-only fields

These are useful to explain what happened, but should not alone drive high-impact decisions:

- `audit.currentView`
- `audit.currentCityId`
- `audit.requestCommands`
- `audit.modelHash`
- `audit.serverTime`
- `actionValidation.stateChanged` (when used only as trace signal)

---

## D) Do-not-drive-critical fields (pending / null-only / ambiguous)

### Explicit pending + null-only in current capture (`pendingAndNullOnly`)
- `economy.protectedResources`
- `economy.satisfaction`
- `economy.workersByResource`
- `buildings.buildingEffect`
- `military.unitsByType`
- `military.fleetByType`
- `military.trainingQueue`
- `military.unitTrainingCost`
- `military.unitTrainingTime`
- `research.researchPoints`
- `research.activeResearch`
- `research.researchProgress`
- `research.unlockedResearch`
- `research.blockedResearch`
- `actionValidation.popupType`

### Implemented but null-only in this dataset (still not reliable as primary driver)
- `actionValidation.actionError` (implemented extractor, no non-null evidence in current 14-record capture)

### Partial and null-only (do not promote to known)
- `city.islandId`
- `actionValidation.actionBlockReason`
- `audit.pageHash`

---

## Decision policy derived from matrix

1. Critical actions must be gated by **Reliable / Decision-driving** signals.
2. **Partial** fields can only refine decisions, never be sole gate.
3. **Pending/null-only** fields stay explicitly non-contractual.
4. Audit fields explain outcomes but do not replace state confirmation.

