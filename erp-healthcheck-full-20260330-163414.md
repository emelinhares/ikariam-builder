# ERP Health Check Report

- Run ID: hc_IBM4MxRn
- Suite: full
- Status: failed
- Started: 2026-03-30T19:29:45.226Z
- Ended: 2026-03-30T19:34:14.371Z
- Cities: 6

## Metrics

- Passed: 5
- Failed: 2
- Blocked: 0
- Skipped: 0
- Pass rate: 71.4%
- Duration: 269s

## Scenario Matrix

| ID | Title | Status | Duration(ms) | Error |
|---|---|---|---:|---|
| state_snapshot | Leitura e consistência de estado multi-cidade | passed | 0 |  |
| transport_dispatch | Envio real de recursos via TaskQueue | failed | 120151 | Timeout aguardando conclusão da task RqPHkbHr |
| build_upgrade | Upgrade real de construção via TaskQueue | failed | 120993 | Timeout aguardando conclusão da task dsdMkRA0 |
| donation_flow | Doação de recurso da ilha | passed | 7132 |  |
| wine_adjust | Ajuste operacional de vinho | passed | 13988 |  |
| workers_science | Ajuste operacional de workers (ciência) | passed | 6880 |  |
| queue_guardrails | Saúde da fila e guard rails | passed | 0 |  |

## Evidences

### state_snapshot — Leitura e consistência de estado multi-cidade
- cities=5
- activeCity=6582
- firstCity=BAD C

### transport_dispatch — Envio real de recursos via TaskQueue
- taskId=RqPHkbHr
- from=BAD E to=BAD C
- resource=sulfur qty=500
- taskAdded=RqPHkbHr

### build_upgrade — Upgrade real de construção via TaskQueue
- taskId=dsdMkRA0
- city=BAD C
- building=warehouse pos=8
- taskAdded=dsdMkRA0
- taskStarted=dsdMkRA0

### donation_flow — Doação de recurso da ilha
- city=BAD C
- islandId=1030
- amount=500
- donateIslandResource executado sem erro

### wine_adjust — Ajuste operacional de vinho
- city=BAD C
- wineLevel=14
- taskAdded=ZuFxbVS9
- taskStarted=ZuFxbVS9
- taskDone=ZuFxbVS9

### workers_science — Ajuste operacional de workers (ciência)
- city=BAD C
- academyPos=10
- scientists=0
- taskAdded=fWiBrkqn
- taskStarted=fWiBrkqn
- taskDone=fWiBrkqn

### queue_guardrails — Saúde da fila e guard rails
- pending=5
- history=50
- recentFailed=5
