# EXECUTION_PRECONDITIONS

Preconditions for safe execution, derived from capture evidence and validated against runtime contracts in [`modules/GameClient.js`](modules/GameClient.js) and [`modules/TaskQueue.js`](modules/TaskQueue.js).

## 1) Global preconditions (all critical actions)

1. **Session/token ready**
   - `actionRequest` must be present for POST actions.
   - Token refresh should be consumed from `updateGlobalData.actionRequest` whenever available.

2. **Context lock (city correctness)**
   - `currentCityId` in request must match the intended origin city for the action.
   - If not locked, perform explicit navigation before action dispatch.

3. **Expected view context**
   - Request must include coherent `view` + `backgroundView` (+ `templateView` where flow requires).
   - `ajax=1` required in captured operational requests.

4. **Do not branch on pending/null-only fields**
   - Any `pendingAndNullOnly` field must not be used as sole gate for critical automation.

---

## 2) Action-specific preconditions

## 2.1 City switch (navigate)

- Target city exists in known city catalog.
- Port slot can be resolved (fallback accepted when absent).
- Use city lock strategy: `view=port`, `cityId=target`, `currentCityId=target`.

## 2.2 Open townHall

- City context already aligned.
- Required URL shape includes `view=townHall`, `cityId`, `position=0`, `currentCityId`, `backgroundView=city`, `actionRequest`, `ajax=1`.

## 2.3 Open port

- City context aligned.
- Required URL shape includes `view=port`, `cityId`, `position=<portSlot>`, `currentCityId`, `backgroundView=city`, `templateView=townHall`, `actionRequest`, `ajax=1`.

## 2.4 Open transport

- Origin city context is active.
- Destination city id known and different from origin.
- Required URL shape includes `view=transport`, `destinationCityId`, `position=<portSlot>`, `activeTab=tabSendTransporter`, `currentCityId=<origin>`, `templateView=port`, `actionRequest`, `ajax=1`.

## 2.5 Build / upgrade building

- City context locked to target city.
- Slot not already occupied by another active construction.
- Slot not blocked by research/guard.
- Resource affordability guard passes (when financial guard is active).
- Request payload coherence:
  - `action=UpgradeExistingBuilding`
  - `cityId`, `position`, `level=currentLevel`, `activeTab=tab<BuildingView>`, `currentCityId`

## 2.6 Cancel building

- **Not contractually executable from this dataset**.
- Minimum requirement for future enablement: dedicated captured request shape + response semantics.

## 2.7 Validate transport

- Baseline transport movements captured before dispatch.
- Post-dispatch refresh capability available (military advisor probe).

## 2.8 Validate build

- Baseline slot/build state captured before dispatch.
- Post-dispatch city probe available to compare under-construction / slot-level deltas.

---

## 3) Guard rules that must remain strict

1. Reject transport when:
   - origin == destination
   - cargo is empty
   - boats are insufficient for largest cargo column
2. Cancel/requeue build when:
   - city already has active construction
   - slot is locked
   - resources unavailable
3. Always navigate before POST when active city mismatches action city.

---

## 4) Preconditions by confidence

- **Hard required (Reliable)**
  - token presence for POST
  - city context lock
  - coherent request shape (`view/currentCityId/backgroundView/...`)
  - post-validation by state delta for build/transport

- **Soft required (Partial / fallback)**
  - selected city fallback fields in response
  - auxiliary action-state fields (`stateChanged`, partial eta/capacity)

- **Not allowed as hard gates**
  - pending/null-only fields (`research.*`, `popupType`, `protectedResources`, etc.)

