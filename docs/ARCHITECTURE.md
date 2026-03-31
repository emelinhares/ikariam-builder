# Arquitetura Operacional (baseada no código atual)

## Escopo

Este documento descreve somente comportamento observado em código.

## 1) Entrada de sinais

### CONFIRMADO
- O content script injeta [inject/inject.js](../inject/inject.js) em `document_start` via [content/content.js](../content/content.js).
- O interceptor de XHR/fetch é instalado de forma síncrona no topo de [inject/inject.js](../inject/inject.js).
- O barramento de eventos é singleton em [modules/Events.js](../modules/Events.js).

### SINAL FORTE
- A instalação precoce do interceptor evita perda de requests iniciais do jogo.

### LACUNA
- Não há medição formal no repositório de taxa de perda de eventos quando a ordem é alterada.

## 2) Parsing / normalização

### CONFIRMADO
- [modules/DataCollector.js](../modules/DataCollector.js) recebe responses via `window.__erpInterceptCallback` e emite eventos (`DC_HEADER_DATA`, `DC_SCREEN_DATA`, `DC_MODEL_REFRESH`, etc.).
- [modules/StateManager.js](../modules/StateManager.js) é fonte única de estado e não faz request direto.
- [modules/StateManager.js](../modules/StateManager.js) unifica shape de recursos em `{ wood, wine, marble, glass, sulfur }`.

### SINAL FORTE
- O par DataCollector + StateManager é o ponto de mudança de formato entre payload do jogo e estado interno.

### LACUNA
- Schema formal de `CityState` não está centralizado em arquivo de tipo/interface.

## 3) Resolução / extração (decisão)

### CONFIRMADO
- [modules/Planner.js](../modules/Planner.js) é o único listener de `STATE_ALL_FRESH`.
- Ordem do ciclo observada: HR → COO → marca `buildBlocked` → CFO → CTO → CSO + MnA.
- Módulos de negócio enfileiram tasks; execução real não ocorre nesses módulos.

### SINAL FORTE
- `PlannerContext` é o contrato transitório entre módulos de negócio no ciclo.

### LACUNA
- Contrato estável versionado do `PlannerContext` não existe em arquivo dedicado.

## 4) Exportação / saída

### CONFIRMADO
- [modules/UIBridge.js](../modules/UIBridge.js) projeta estado interno para `UIState`.
- [ui/panel.js](../ui/panel.js) consome apenas evento `UI_STATE_UPDATED`, sem acesso direto a [modules/StateManager.js](../modules/StateManager.js).
- `UI_COMMAND` retorna ao core via [modules/UIBridge.js](../modules/UIBridge.js).

### SINAL FORTE
- O painel depende de shape estável de `UIState`; mudanças quebram render facilmente.

### LACUNA
- Não há validação runtime do schema de `UIState`.

## 5) Execução / ação

### CONFIRMADO
- [modules/TaskQueue.js](../modules/TaskQueue.js) controla fila, fase, prioridade, deduplicação, retry, guards e pós-validação.
- [modules/GameClient.js](../modules/GameClient.js) é único ponto de saída de requests para o jogo.
- `TaskQueue` usa `acquireSession()` de [modules/GameClient.js](../modules/GameClient.js) para exclusividade de sessão.
- Tasks críticas têm outcome registrado (`lastOutcome`, `outcomeHistory`) e evento `QUEUE_TASK_OUTCOME`.

### SINAL FORTE
- Estratégia real é endpoint-first com confirmação por sinais de response e/ou pós-estado.

### LACUNA
- Não há timeout global único documentado por tipo de task fora do código.

## 6) Persistência / suporte

### CONFIRMADO
- [modules/Storage.js](../modules/Storage.js) abstrai persistência em `chrome.storage.local` (bridge via [content/content.js](../content/content.js)).
- [modules/Config.js](../modules/Config.js) mantém defaults e persistência de configuração.
- [modules/TaskQueue.js](../modules/TaskQueue.js) persiste fila e histórico parcial de tasks.
- [modules/HealthCheckRunner.js](../modules/HealthCheckRunner.js) persiste relatórios de health check.

### SINAL FORTE
- Persistência é usada para continuidade entre reloads, especialmente fila e REC mode.

### LACUNA
- Política de migração/versionamento de chaves de storage não está consolidada em um doc único.

## 7) Fluxo mínimo fim a fim

1. `content` injeta `inject`.
2. `inject` instala interceptor, instancia módulos e executa boot.
3. `DataCollector` captura responses e emite eventos.
4. `StateManager` atualiza estado e emite `STATE_ALL_FRESH`.
5. `Planner` orquestra módulos de negócio e enfileira tasks.
6. `TaskQueue` executa task com `GameClient` + pós-validação.
7. `UIBridge` reconstrói `UIState` e painel renderiza.

Arquivos-chave do fluxo: [inject/inject.js](../inject/inject.js), [modules/DataCollector.js](../modules/DataCollector.js), [modules/StateManager.js](../modules/StateManager.js), [modules/Planner.js](../modules/Planner.js), [modules/TaskQueue.js](../modules/TaskQueue.js), [modules/GameClient.js](../modules/GameClient.js), [modules/UIBridge.js](../modules/UIBridge.js), [ui/panel.js](../ui/panel.js).

