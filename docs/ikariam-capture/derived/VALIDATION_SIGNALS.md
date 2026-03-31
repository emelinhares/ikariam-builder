# VALIDATION_SIGNALS

Validation signal catalog for operational automation, derived from [`docs/ikariam-capture/session-reconstruction.json`](docs/ikariam-capture/session-reconstruction.json), [`docs/ikariam-capture/semantic-raw.json`](docs/ikariam-capture/semantic-raw.json), and runtime handling in [`modules/GameClient.js`](modules/GameClient.js) + [`modules/TaskQueue.js`](modules/TaskQueue.js).

## 1) Signal tiers

## Tier A — Strong (can confirm action outcome)

- `updateGlobalData.backgroundData.id == expectedCityId` (navigation city lock)
- `fleetMoveList` present (transport dispatch confirmed)
- `updateGlobalData.backgroundData.endUpgradeTime > 0` (build accepted)
- Post-state delta:
  - build: underConstruction/slot upgrading/slot level changed
  - transport: relevant fleet movement count increased

## Tier B — Supporting (needs corroboration)

- `provideFeedback` success entry (e.g., type 10)
- `changeView` + `updateTemplateData` sequence
- `actionValidation.stateChanged` (non-null but broad)
- `logistics.transportValidation.success=true`

## Tier C — Audit / weak

- `audit.currentView`
- `audit.currentCityId`
- `audit.requestCommands`
- `audit.modelHash` / `audit.serverTime`

## Tier D — Non-contractual for critical branching

- `actionValidation.popupType` (pending / null-only)
- `actionValidation.actionBlockReason` (partial / null-only)
- `actionValidation.actionError` (implemented extractor but null-only in current dataset)
- Any pending/null-only field from matrix

---

## 2) Signal interpretation by action

## 2.1 City switch / navigate

**Primary success**
- Tier A city-id confirmation from `updateGlobalData.backgroundData.id`.

**Primary failure/inconclusive**
- confirmed city differs from expected target.
- no city confirmation field returned.

**Post-validation**
- Update/verify active city state lock.

## 2.2 Open townHall / port / transport screens

**Primary success**
- command chain contains `updateGlobalData`, `changeView`, `updateTemplateData`.

**Failure indicators**
- explicit error commands (`errorWindow`, redirect).
- provideFeedback with error locakey.

**Post-validation**
- ensure city context remains locked to intended origin.

## 2.3 Build / upgrade

**Primary success**
- `endUpgradeTime > 0` in global data.

**Secondary success (post-state)**
- expected slot under construction or upgrading.
- level increase from baseline.

**Failure indicators**
- missing `endUpgradeTime`.
- error feedback/popup/redirect.

**Inconclusive handling**
- treat as guarded/inconclusive and retry with bounded delay + probe.

## 2.4 Transport dispatch

**Primary success**
- `fleetMoveList` command present.

**Secondary success**
- success feedback entry and/or transportValidation success.

**Primary failure**
- feedback locakey indicates error (e.g., validation/resource/source-port conflict).

**Post-validation**
- refresh advisor/movements and compare movement count before/after.

---

## 3) False-positive and false-negative controls

1. Do not treat command presence alone as final success for critical actions.
2. Require at least one Tier A signal for completion of build/transport.
3. Use baseline-vs-post checks to avoid transient UI/response ambiguities.
4. Keep pending/null-only fields out of hard decision trees.

---

## 4) Recommended decision policy

- **Success**: Tier A signal present, or Tier B corroborated by post-state delta.
- **Guard-reschedule**: precondition failed (city lock/resources/boats/slot conditions).
- **Inconclusive-retry**: no explicit failure, but no strong success confirmation.
- **Hard-fail**: explicit server/game/http failure signal.

