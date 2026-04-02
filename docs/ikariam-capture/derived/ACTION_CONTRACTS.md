# ACTION_CONTRACTS

Action contracts confirmed from scrape evidence and approved for incremental ERP integration.

## Contract validation policy

- Request shape must match observed `action`/`function`/context keys.
- Success confirmation must include post-action state change **plus** `actionRequest` rotation when applicable.
- `provideFeedback` is supporting evidence and may be absent.

---

## 1) `city_worker_plan`

- **View**: `townHall`
- **Status**: confirmed

### Request

- **Method**: `POST`
- **Endpoint**: `IslandScreen`
- **Params**:
  - `action=IslandScreen`
  - `function=workerPlan`
  - `screen=TownHall`
  - `cityId=<cityId>`
  - `wood=<int>`
  - `luxury=<int>`
  - `scientists=<int>`
  - `priests=<int>`
  - `currentCityId=<cityId>`

### Success signals

- `currentResources.citizens` and/or `currentResources.population` changes
- `actionRequest` rotates
- `provideFeedback` may exist

---

## 2) `assign_wine_per_tick`

- **View**: `tavern`
- **Status**: confirmed

### Request

- **Method**: `POST`
- **Endpoint**: `CityScreen`
- **Params**:
  - `action=CityScreen`
  - `function=assignWinePerTick`
  - `cityId=<cityId>`
  - `position=10`
  - `amount=<int>`
  - `currentCityId=<cityId>`

### Success signals

- `wineSpendings` changes
- `actionRequest` rotates
- `provideFeedback` may exist

---

## 3) `island_resource_worker_plan`

- **View**: `resource`
- **Status**: confirmed

### Request

- **Method**: `POST`
- **Endpoint**: `IslandScreen`
- **Params**:
  - `action=IslandScreen`
  - `function=workerPlan`
  - `type=resource`
  - `islandId=<islandId>`
  - `cityId=<cityId>`
  - `screen=resource`
  - `rw=<int>`
  - `currentIslandId=<islandId>`

### Success signals

- `currentResources.citizens` changes
- `actionRequest` rotates
- `provideFeedback` may exist

---

## 4) `island_tradegood_worker_plan`

- **View**: `tradegood`
- **Status**: confirmed

### Request

- **Method**: `POST`
- **Endpoint**: `IslandScreen`
- **Params**:
  - `action=IslandScreen`
  - `function=workerPlan`
  - `type=tradegood`
  - `islandId=<islandId>`
  - `cityId=<cityId>`
  - `screen=tradegood`
  - `tw=<int>`
  - `currentIslandId=<islandId>`

### Success signals

- `currentResources.citizens` changes
- `actionRequest` rotates
- `provideFeedback` may exist

---

## 5) `resource_donation`

- **View**: `resource`
- **Status**: confirmed

### Request

- **Method**: `POST`
- **Endpoint**: `IslandScreen`
- **Params**:
  - `action=IslandScreen`
  - `function=donate`
  - `type=resource`
  - `islandId=<islandId>`
  - `donation=<int>`
  - `currentIslandId=<islandId>`

### Success signals

- `provideFeedback = order carried out`
- `actionRequest` rotates later

---

## 6) `tradegood_donation`

- **View**: `tradegood`
- **Status**: confirmed

### Request

- **Method**: `POST`
- **Endpoint**: `IslandScreen`
- **Params**:
  - `action=IslandScreen`
  - `function=donate`
  - `type=tradegood`
  - `islandId=<islandId>`
  - `donation=<int>`
  - `currentIslandId=<islandId>`

### Success signals

- `provideFeedback = order carried out`
- `actionRequest` rotates later

---

## 7) `increase_transporter`

- **View**: `port`
- **Status**: confirmed

### Request

- **Method**: `POST`
- **Endpoint**: `CityScreen`
- **Params**:
  - `action=CityScreen`
  - `function=increaseTransporter`
  - `cityId=<cityId>`
  - `position=2`
  - `activeTab=tabBuyTransporter`
  - `currentCityId=<cityId>`

### Success signals

- `freeTransporters` increases
- `actionRequest` rotates
- `provideFeedback = order carried out`

---

## 8) `start_colonization`

- **View**: `colonize`
- **Status**: confirmed

### Request

- **Method**: `POST`
- **Endpoint**: `transportOperations`
- **Params**:
  - `action=transportOperations`
  - `function=startColonization`
  - `islandId=<islandId>`
  - `cargo_people=<int>`
  - `cargo_gold=<int>`
  - `desiredPosition=<int>`
  - `cargo_resource=<int>`
  - `cargo_tradegood1=<int>`
  - `cargo_tradegood2=<int>`
  - `cargo_tradegood3=<int>`
  - `cargo_tradegood4=<int>`
  - `capacity=<int>`
  - `max_capacity=<int>`
  - `transporters=<int>`
  - `currentIslandId=<islandId>`

### Success signals

- `provideFeedback = order carried out`

---

## 9) `abort_fleet_operation`

- **View**: `militaryAdvisor`
- **Status**: confirmed

### Request

- **Method**: `POST`
- **Endpoint**: `transportOperations`
- **Params**:
  - `action=transportOperations`
  - `function=abortFleetOperation`
  - `eventId=<eventId>`
  - `oldView=militaryAdvisor`
  - `activeTab=militaryMovements`
  - `currentIslandId=<islandId>`

### Success signals

- `freeTransporters` increases
- `currentResources/citizens` recover accordingly
- `actionRequest` rotates
- `provideFeedback = order carried out`

