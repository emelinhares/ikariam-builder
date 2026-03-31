# HARVEST_COVERAGE

Coverage map derived from [`docs/ikariam-capture/navigation-flow.json`](docs/ikariam-capture/navigation-flow.json), [`docs/ikariam-capture/session-reconstruction.json`](docs/ikariam-capture/session-reconstruction.json), [`docs/ikariam-capture/endpoint-map-by-action.json`](docs/ikariam-capture/endpoint-map-by-action.json), and field availability from [`docs/ikariam-capture/semantic-raw.json`](docs/ikariam-capture/semantic-raw.json).

## 1) Harvest flow coverage

- Total steps: **14**
- Sequence covered:
  1. `harvest.bootstrap`
  2. `harvest.init`
  3. For each city (19251, 19252, 19253, 19254):
     - `harvest.city.switch`
     - `harvest.city.views`
     - `harvest.city.buildings`

## 2) City coverage

- Cities covered in operational flow: **4**
  - 19251
  - 19252
  - 19253
  - 19254

## 3) Endpoint/action coverage observed

### Fully observed in this capture
- Open townHall (`view=townHall` POST)
- Open port (`view=port` POST)
- Open transport (`view=transport` POST)
- City page GET (`view=city` with and without `cityId`)

### Not directly observed as explicit action contract in this capture
- Explicit build-upgrade POST transaction payload trace tied to user step in these specific records
- Explicit cancel-build request contract

## 4) Data-domain coverage quality

### Strongly covered
- City identity (except island id)
- Economy core resources and population
- Building slot topology and most upgrade-panel fields
- Construction status (including queue status and remaining time when available)
- Basic logistics state and transport validation indicators
- Action success/state-changed high-level traces

### Weak / missing in this capture
- Research domain values (entity appears null-only)
- Military detailed structures (`unitsByType`, `fleetByType`, training details)
- Economy protected/satisfaction/workers-by-resource
- Popup/action block typed details as structured fields

## 5) Contract confidence impact

- Coverage is sufficient to harden **navigation + transport-screen + context-lock** contracts.
- Coverage is sufficient to define **guarded build/transport post-validation strategy**.
- Coverage is **insufficient** to elevate cancel-build or research/military decision automations to strict-contract status.

## 6) Gaps requiring dedicated capture sessions

1. Build lifecycle with explicit upgrade request + acceptance + completion transitions.
2. Cancel-building request/response shape and failure branches.
3. Transport rejection branches (capacity/resource/context errors) with explicit structured feedback.
4. Research and military screens with non-null extractor outputs.

