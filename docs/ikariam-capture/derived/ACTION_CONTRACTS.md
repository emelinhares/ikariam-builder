# ACTION_CONTRACTS

Operational contracts derived from capture evidence in [`docs/ikariam-capture/endpoint-map-by-action.json`](docs/ikariam-capture/endpoint-map-by-action.json), [`docs/ikariam-capture/session-reconstruction.json`](docs/ikariam-capture/session-reconstruction.json), [`docs/ikariam-capture/semantic-raw.json`](docs/ikariam-capture/semantic-raw.json), and [`docs/ikariam-capture/semantic-erp.json`](docs/ikariam-capture/semantic-erp.json).

## Status legend

- **Reliable**: observed with concrete request/response evidence in current capture.
- **Partial**: observed but not fully disambiguated for all failure branches.
- **Pending**: no direct capture evidence for a production-safe contract.

---

## 1) City switch

- **Action**: Open target city context using port request (`view=port`) with `cityId == currentCityId`.
- **Confidence**: **Reliable**
- **Observed in capture**: yes

### Preconditions
- Valid target city id exists in known city catalog.
- Session is authenticated.

### Required parameters
- `view=port`
- `cityId=<targetCityId>`
- `currentCityId=<targetCityId>`
- `position=<portSlot>`
- `backgroundView=city`
- `ajax=1`

### actionRequest dependency
- Present in recorded POST URLs for the human-like flow.
- Token refresh is observed through `updateGlobalData.actionRequest`.

### Context dependency
- Uses city context fields (`view/backgroundView/currentCityId`).
- `templateView` may appear in some transitions, but switch itself is confirmed via port view response and city identity in global data.

### Success signals
- `updateGlobalData.backgroundData.id == targetCityId` (strong).
- Fallback: `headerData.selectedCityId == targetCityId` (weaker fallback).

### Failure signals
- Server returns different city id than expected.
- Missing city confirmation fields in response.

### Ambiguity risks
- Missing selected-city field in response can create inconclusive state.

### Recommended post-validation
- Confirm active city in state after response.
- If mismatch/inconclusive, retry bounded and re-check context lock.

---

## 2) Open townHall

- **Action**: POST `view=townHall` for active city.
- **Confidence**: **Reliable**
- **Observed in capture**: yes

### Preconditions
- Active/expected city context aligned.

### Required parameters
- `view=townHall`
- `cityId`
- `position=0`
- `backgroundView=city`
- `currentCityId`
- `actionRequest`
- `ajax=1`

### actionRequest dependency
- Present in captured URLs.

### Context dependency
- Depends on city context (`currentCityId`, background/template transition).

### Success signals
- Commands include `updateGlobalData`, `changeView`, `updateTemplateData`.

### Failure signals
- Missing expected command chain.
- Error commands/feedback indicating invalid action.

### Ambiguity risks
- `popupData` can appear as null in successful responses, so null alone is not success.

### Recommended post-validation
- Confirm resulting view/state transition through command sequence and current city continuity.

---

## 3) Open port

- **Action**: POST `view=port` for active city.
- **Confidence**: **Reliable**
- **Observed in capture**: yes

### Preconditions
- Correct city context (`currentCityId` aligned with intended city).

### Required parameters
- `view=port`
- `cityId`
- `position=<portSlot>`
- `backgroundView=city`
- `currentCityId`
- `templateView=townHall` (observed in flow)
- `actionRequest`
- `ajax=1`

### actionRequest dependency
- Present in captured URLs.

### Context dependency
- Depends on `templateView`/`backgroundView` transition from previous screen.

### Success signals
- Command chain includes `changeView` + `updateTemplateData`.

### Failure signals
- Error feedback, redirect, or command mismatch.

### Ambiguity risks
- Some command lists remain syntactically valid even when business intent failed elsewhere.

### Recommended post-validation
- Validate city lock and next expected action (e.g., transport open) from same context.

---

## 4) Open transport

- **Action**: POST `view=transport` from port context.
- **Confidence**: **Reliable**
- **Observed in capture**: yes

### Preconditions
- Origin city context is active.
- Destination city id known.

### Required parameters
- `view=transport`
- `destinationCityId`
- `position=<portSlot>`
- `activeTab=tabSendTransporter`
- `backgroundView=city`
- `currentCityId=<originCityId>`
- `templateView=port`
- `actionRequest`
- `ajax=1`

### actionRequest dependency
- Present in captured URLs.

### Context dependency
- Strong dependency on origin city (`currentCityId`) and `templateView=port`.

### Success signals
- Command chain with `changeView` to transport context.

### Failure signals
- Context mismatch (origin/expected city divergence).

### Ambiguity risks
- Capture shows scenarios where expected step city and observed request context can diverge; this is critical for automation safety.

### Recommended post-validation
- Validate origin lock before sending freight.
- Re-check selected city id after transport screen open.

---

## 5) Build / upgrade building

- **Action**: POST `action=UpgradeExistingBuilding` after opening building view context.
- **Confidence**: **Partial-to-Reliable** (request/response shape is reliable; multi-branch failure semantics still partial)
- **Observed in capture/code path**: yes in operational contract implementation

### Preconditions
- Target city is active.
- Correct building slot and view.
- Slot not blocked and no active construction conflict.

### Required parameters
- Context GET/POST with `view=<buildingView>&cityId&position&currentCityId&backgroundView=city&ajax=1`
- Action payload:
  - `action=UpgradeExistingBuilding`
  - `cityId`
  - `position`
  - `level=<currentLevel>`
  - `activeTab=tab<BuildingView>`
  - `currentCityId`

### actionRequest dependency
- Required for POST acceptance in operational path.

### Context dependency
- Strongly tied to `currentCityId`, `view`, and slot position.

### Success signals
- `updateGlobalData.backgroundData.endUpgradeTime > 0` (strong).
- Post-state: under-construction slot or upgrading evidence.

### Failure signals
- Missing/invalid `endUpgradeTime`.
- Error feedback/popup/redirect.

### Ambiguity risks
- Some responses can be syntactically valid but operationally inconclusive.

### Recommended post-validation
- Probe city after dispatch.
- Confirm state delta: underConstruction / slot level / upgrading flag.

---

## 6) Cancel building

- **Action**: cancel active construction.
- **Confidence**: **Pending**
- **Observed in capture**: **no direct request contract captured**

### Preconditions
- Explicit cancel capability signal present (`construction.canCancel=true`).

### Required parameters
- **Not declared** (insufficient capture evidence).

### actionRequest dependency
- Unknown for this specific action in current dataset.

### Context dependency
- Unknown exact request shape; likely city/building context dependent.

### Success signals
- Not contractually established in current capture.

### Failure signals
- Not contractually established in current capture.

### Ambiguity risks
- High risk of false contract if inferred from assumptions.

### Recommended post-validation
- Keep as non-automated critical action until dedicated capture evidence exists.

---

## 7) Validate transport

- **Action**: confirm that transport dispatch actually produced movement.
- **Confidence**: **Reliable** (for current observed signals)
- **Observed in capture/code path**: yes

### Preconditions
- Transport request attempted with valid origin/destination/cargo.

### Required parameters
- Validation reads response commands and/or follow-up military movement state.

### actionRequest dependency
- Required during dispatch; validation itself reads state/response.

### Context dependency
- Must preserve origin city correctness to avoid false positives.

### Success signals
- `fleetMoveList` present (strong).
- `provideFeedback` with success type (supporting signal).
- Post-validation: movement count increase for matching origin/destination.

### Failure signals
- Error feedback locakey (`ERROR*`, `SOURCEPORT_EQUAL*`).
- No new relevant movement after refresh.

### Ambiguity risks
- Feedback without movement can be inconclusive.

### Recommended post-validation
- Refresh military advisor and compare movement baseline vs post-state.

---

## 8) Validate build

- **Action**: confirm build was accepted and reflected in city state.
- **Confidence**: **Reliable** (state-based), with partial ambiguity on edge failures.
- **Observed in capture/code path**: yes

### Preconditions
- Build attempt performed with accepted request shape.

### Required parameters
- Validation relies on city probe + baseline snapshot, not only immediate POST status.

### actionRequest dependency
- Required in dispatch; validation reads resulting state.

### Context dependency
- Same city/slot scope used for baseline and post-check.

### Success signals
- Under-construction equals expected slot **or** slot upgrading **or** level increase.

### Failure signals
- No measurable state change after validation probe.

### Ambiguity risks
- Timing windows can delay state propagation.

### Recommended post-validation
- Retry with bounded delay when outcome is inconclusive.

