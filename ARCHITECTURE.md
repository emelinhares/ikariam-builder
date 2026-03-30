# Arquitetura Técnica — ERP Foundation (Ikariam)

> Documento de implementação. Define o que construir, em que ordem, como cada módulo
> se conecta, e as regras que não podem ser violadas.
> Baseado em: ERP_FOUNDATION.md, UI_SPEC_ERP_REVISED.md, IKARIAM_MODEL_MAP.md.

---

## 1. Visão Geral

```
┌─────────────────────────────────────────────────────────────┐
│  UI Layer (Shadow DOM, page context)                         │
│  panel.html (template) / panel.js / panel.css               │
│  Consome: UIState via Events  |  Emite: ui:command          │
└──────────────────────┬──────────────────────────────────────┘
                       │ Events (mesmo contexto)
┌──────────────────────▼──────────────────────────────────────┐
│  UIBridge.js                                                 │
│  StateManager + TaskQueue + Audit → UIState                 │
└──────────────────────┬──────────────────────────────────────┘
                       │ lê
┌──────────────────────▼──────────────────────────────────────┐
│  Business Logic Layer                                        │
│  CFO / COO / HR / CTO / CSO / MnA                           │
│  Lê: StateManager  |  Escreve: TaskQueue                    │
└──────────┬───────────────────────┬──────────────────────────┘
           │ lê                    │ add tasks
┌──────────▼──────────┐  ┌────────▼──────────────────────────┐
│  StateManager        │  │  TaskQueue                        │
│  Fonte única         │  │  Fila JIT + OperationMode         │
│  de verdade          │  │  Executor sequencial              │
└──────────┬──────────┘  └────────┬──────────────────────────┘
           │ eventos               │ executa via
┌──────────▼──────────────────────▼──────────────────────────┐
│  DataCollector.js          GameClient.js                     │
│  Intercepta XHR/fetch      Request queue interna            │
│  Emite eventos de estado   Único ponto de saída             │
└──────────────────────────────────────────────────────────────┘
           ↑ tudo roda em
┌──────────────────────────────────────────────────────────────┐
│  inject.js — page context                                    │
│  Acesso a window.ikariam, XHR nativo, fetch nativo          │
└──────────┬───────────────────────────────────────────────────┘
           │ postMessage bridge
┌──────────▼───────────────────────────────────────────────────┐
│  content.js — content script                                  │
│  Injeta inject.js  |  Bridge chrome.storage ↔ page context  │
└──────────────────────────────────────────────────────────────┘
```

### 1.1 Orquestração canônica de decisão (estado atual do código)

No estado atual da implementação, o orquestrador central é o [`Planner`](modules/Planner.js), que é o **único listener** de `state:allCitiesFresh`.

Ordem canônica de fase no ciclo:
1. SUSTENTO (`HR`)
2. CAPACIDADE (`COO`)
3. INFRAESTRUTURA (`CFO`)
4. PESQUISA (`CTO`)
5. SEGURANÇA/DETECÇÃO (`CSO` + `MnA`)

Consequência arquitetural:
- Módulos de negócio não devem disputar `state:allCitiesFresh` de forma autônoma.
- Novos gatilhos de replanejamento devem preferir o contrato do planner (wake-up adaptativo + reativo) para preservar prioridade de regra de negócio.

### 1.2 Contrato HTTP canônico (documento + fluxo real)

Fonte funcional de endpoints e parâmetros: [`ENDPOINTS.md`](ENDPOINTS.md).

Fonte executável de fluxo real: [`modules/GameClient.js`](modules/GameClient.js).

Regra de manutenção:
- Em divergência entre doc e execução, considerar comportamento real do `GameClient` como referência operacional imediata.
- Atualizar o documento de endpoint no mesmo ciclo de mudança para evitar drift documental.

### Decisão de arquitetura: UI em shadow DOM, mesmo contexto

O painel **não** é um iframe nem uma página separada. É um container injetado na página com shadow DOM, cujo HTML é carregado via `fetch(chrome.runtime.getURL('ui/panel.html'))`. `panel.js` é importado como módulo em `inject.js`. Ambos compartilham o mesmo objeto `Events` e o mesmo contexto de execução.

Isso elimina qualquer problema de comunicação cross-context entre UI e motor.

---

## 2. Estrutura de Arquivos

```
ikariam-erp/
├── manifest.json
├── content/
│   └── content.js
├── inject/
│   └── inject.js
├── background/
│   └── background.js
├── modules/
│   ├── Events.js
│   ├── Storage.js
│   ├── Config.js          ← novo: configurações persistidas
│   ├── Audit.js
│   ├── DataCollector.js
│   ├── StateManager.js
│   ├── GameClient.js
│   ├── TaskQueue.js
│   ├── UIBridge.js
│   ├── CFO.js
│   ├── COO.js
│   ├── HR.js
│   ├── CTO.js
│   ├── CSO.js
│   ├── MnA.js
│   └── utils.js
├── data/
│   ├── const.js
│   ├── buildings.js
│   ├── effects.js
│   ├── wine.js
│   └── research.js
└── ui/
    ├── panel.html         ← template HTML puro (sem <script>)
    ├── panel.js           ← importado em inject.js
    └── panel.css
```

---

## 3. Ordem de Implementação

Nenhum módulo é escrito antes de suas dependências estarem prontas.

```
Camada 0 — Infraestrutura
  1.  manifest.json
  2.  content.js
  3.  inject.js (esqueleto — só imports e interceptor XHR/fetch)
  4.  Events.js
  5.  Storage.js
  6.  Config.js
  7.  utils.js
  8.  Audit.js

Camada 1 — Dados estáticos
  9.  data/const.js        (já existe — revisar)
  10. data/buildings.js    (já existe — adicionar getCost/getCumulativeCost)
  11. data/effects.js      (já existe — revisar cobertura)
  12. data/wine.js         (criar)
  13. data/research.js     (criar)

Camada 2 — Aquisição e Estado
  14. DataCollector.js
  15. StateManager.js

Camada 3 — Execução
  16. GameClient.js
  17. TaskQueue.js

Camada 4 — Módulos de Negócio
  18. CFO.js
  19. COO.js
  20. HR.js
  21. CTO.js
  22. CSO.js
  23. MnA.js

Camada 5 — UI
  24. UIBridge.js
  25. panel.css
  26. panel.html
  27. panel.js

Camada 6 — Wiring final
  28. inject.js (completo)
```

---

## 4. Camada 0 — Infraestrutura

### 4.1 manifest.json

```json
{
  "manifest_version": 3,
  "name": "Ikariam ERP",
  "version": "1.0.0",
  "content_scripts": [{
    "matches": ["*://*.ikariam.com.br/*", "*://*.ikariam.com/*"],
    "js": ["content/content.js"],
    "run_at": "document_start"
  }],
  "web_accessible_resources": [{
    "resources": ["inject/inject.js", "ui/panel.html", "ui/panel.css"],
    "matches": ["*://*.ikariam.com.br/*", "*://*.ikariam.com/*"]
  }],
  "background": { "service_worker": "background/background.js" },
  "permissions": ["storage", "notifications"]
}
```

`panel.js` **não** entra em `web_accessible_resources` porque é importado como módulo em `inject.js`, não carregado como página separada.

### 4.2 content.js

Três responsabilidades, estritamente separadas:

**1. Injetar inject.js em page context:**
```javascript
// Executado em document_start — antes de qualquer script da página
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject/inject.js');
script.type = 'module';
// Injetar no <html> (não no <head> — pode não existir ainda em document_start)
(document.head ?? document.documentElement).appendChild(script);
```

**2. Bridge chrome.storage ↔ page context:**
```javascript
window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.__erpBridge !== true) return;
    const { id, op, key, value } = e.data;
    let response;

    try {
        if (op === 'set') {
            await chrome.storage.local.set({ [key]: value });
            response = { ok: true };
        } else if (op === 'get') {
            const result = await chrome.storage.local.get(key);
            response = { value: result[key] ?? null };
        } else if (op === 'remove') {
            await chrome.storage.local.remove(key);
            response = { ok: true };
        } else if (op === 'getAll') {
            const result = await chrome.storage.local.get(null);
            response = { value: result };
        }
    } catch (err) {
        response = { error: err.message };
    }

    window.postMessage({ __erpBridge: true, __response: true, id, ...response }, '*');
});
```

**3. Bridge para background (notificações):**
```javascript
window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.__erpNotify !== true) return;
    chrome.runtime.sendMessage(e.data.payload);
});
```

### 4.3 inject.js (esqueleto — Camada 0)

O interceptor XHR/fetch **deve ser instalado aqui, de forma síncrona e imediata**, antes de qualquer import. Isso porque imports de módulos ES são assíncronos — se o interceptor ficar dentro de DataCollector.js, chegará tarde e perderá os primeiros requests do jogo.

```javascript
// ═══ INTERCEPTOR — deve ser a primeira coisa executada ═══
// Instalado aqui, em page context, antes de qualquer módulo carregar.
// DataCollector registra o callback depois.
window.__erpInterceptCallback = null;

const _OrigXHR = window.XMLHttpRequest;
window.XMLHttpRequest = function () {
    const xhr = new _OrigXHR();
    const _open = xhr.open.bind(xhr);
    const _send = xhr.send.bind(xhr);

    xhr.open = function (method, url, ...rest) {
        this.__erpUrl = url;
        return _open(method, url, ...rest);
    };

    xhr.send = function (body) {
        const url = this.__erpUrl; // capturar em closure — this no listener é o XHR
        this.addEventListener('load', function () {
            window.__erpInterceptCallback?.(url, this.responseText);
        });
        return _send(body);
    };

    return xhr;
};

const _origFetch = window.fetch;
window.fetch = async function (...args) {
    const response = await _origFetch(...args);
    response.clone().text().then(text => {
        window.__erpInterceptCallback?.(args[0]?.toString?.() ?? '', text);
    }).catch(() => {});
    return response;
};
// ═══ fim do interceptor ═══

// Imports assíncronos depois
import { Events }        from '../modules/Events.js';
import { Storage }       from '../modules/Storage.js';
import { Config }        from '../modules/Config.js';
// ... demais imports na Camada 6
```

### 4.4 Events.js

Pub/sub. Singleton exportado. Zero dependências.

```javascript
// Interface pública
Events.on(event, handler)       // → unsubscribe function
Events.once(event, handler)     // → unsubscribe function
Events.off(event, handler)
Events.emit(event, payload)
Events.clear(event?)
```

`on()` retorna a função de unsubscribe para facilitar cleanup em módulos que precisam se descadastrar.

**Catálogo de eventos** (definir como `Events.E` para evitar strings soltas no código):

```javascript
Events.E = Object.freeze({
    // DataCollector
    DC_HEADER_DATA:      'dc:headerData',       // { headerData, token, url }
    DC_SCREEN_DATA:      'dc:screenData',       // { screenData, cityId }
    DC_MODEL_REFRESH:    'dc:modelRefresh',     // { model }
    DC_FLEET_MOVEMENTS:  'dc:fleetMovements',   // { movements[] }

    // StateManager
    STATE_CITY_UPDATED:  'state:cityUpdated',   // { cityId }
    STATE_ALL_FRESH:     'state:allCitiesFresh',// { ts }
    STATE_RESEARCH:      'state:researchUpdated', // { research }
    STATE_READY:         'state:ready',         // emitido após 1º model refresh

    // TaskQueue
    QUEUE_TASK_ADDED:    'queue:taskAdded',     // { task }
    QUEUE_TASK_STARTED:  'queue:taskStarted',   // { task }
    QUEUE_TASK_DONE:     'queue:taskCompleted', // { task, result }
    QUEUE_TASK_FAILED:   'queue:taskFailed',    // { task, error, fatal }
    QUEUE_TASK_CANCELLED:'queue:taskCancelled', // { taskId }
    QUEUE_BLOCKED:       'queue:blocked',       // { reason }
    QUEUE_MODE_CHANGED:  'queue:modeChanged',   // { mode }

    // Módulos de negócio
    CFO_BUILD_APPROVED:  'cfo:buildApproved',   // { cityId, building, position, reason }
    CFO_BUILD_BLOCKED:   'cfo:buildBlocked',    // { cityId, building, reason }
    COO_TRANSPORT_SCHED: 'coo:transportScheduled', // { task }
    HR_WINE_EMERGENCY:   'hr:wineEmergency',    // { cityId, hoursRemaining }
    HR_WINE_ADJUSTED:    'hr:wineAdjusted',     // { cityId, oldLevel, newLevel }
    HR_WORKER_REALLOC:   'hr:workerReallocated',// { cityId }
    CTO_RESEARCH_START:  'cto:researchStarted', // { researchId }
    CSO_CAPITAL_RISK:    'cso:capitalAtRisk',   // { cityId, atRisk }
    CSO_ESCROW_CREATED:  'cso:escrowCreated',   // { cityId, offerId, goldHidden }

    // UI
    UI_STATE_UPDATED:    'ui:state:updated',    // UIState completo
    UI_ALERT_ADDED:      'ui:alert:added',      // Alert
    UI_ALERT_RESOLVED:   'ui:alert:resolved',   // { alertId }
    UI_COMMAND:          'ui:command',          // { type, ...args }
});
```

### 4.5 Storage.js

Wrapper sobre chrome.storage via postMessage bridge. Prefixo de chave automático.

```javascript
class Storage {
    constructor() {
        this._pending = new Map(); // id → { resolve, reject }
        this._prefix  = null;     // calculado na init()
        window.addEventListener('message', this._onMessage.bind(this));
    }

    async init() {
        // Aguardar ikariam.model estar disponível para montar o prefixo
        await this._waitForModel();
        const host    = location.host.match(/(s\d+)-?([a-z]+)?\.ikariam/i);
        const world   = host?.[1] ?? 's0';
        const server  = host?.[2] ?? 'xx';
        const avatar  = window.ikariam?.model?.avatarId ?? '0';
        this._prefix  = `IA_ERP_${server}_${world}_${avatar}_`;
    }

    _key(name)  { return this._prefix + name; }

    get(name)            { return this._send('get',    this._key(name)); }
    set(name, value)     { return this._send('set',    this._key(name), value); }
    remove(name)         { return this._send('remove', this._key(name)); }

    _send(op, key, value) {
        return new Promise((resolve, reject) => {
            const id = Math.random().toString(36).slice(2);
            this._pending.set(id, { resolve, reject });
            window.postMessage({ __erpBridge: true, id, op, key, value }, '*');
            // Timeout de segurança: 5s
            setTimeout(() => {
                if (this._pending.has(id)) {
                    this._pending.delete(id);
                    reject(new Error(`Storage timeout: ${op} ${key}`));
                }
            }, 5000);
        });
    }

    _onMessage(e) {
        if (e.source !== window || !e.data?.__erpBridge || !e.data.__response) return;
        const { id, value, ok, error } = e.data;
        const p = this._pending.get(id);
        if (!p) return;
        this._pending.delete(id);
        if (error) p.reject(new Error(error));
        else p.resolve(value ?? ok ?? null);
    }

    _waitForModel(timeout = 10_000) {
        return new Promise((resolve, reject) => {
            const check = () => { if (window.ikariam?.model?.avatarId) resolve(); };
            const iv = setInterval(check, 100);
            check();
            setTimeout(() => { clearInterval(iv); reject(new Error('model timeout')); }, timeout);
        });
    }
}
```

### 4.6 Config.js

Centraliza todas as configurações do sistema. Persistido no Storage. Carregado na init.

```javascript
const DEFAULTS = {
    // Modos de operação
    operationMode: 'FULL-AUTO', // 'FULL-AUTO' | 'SEMI' | 'MANUAL' | 'SAFE'

    // CFO
    roiThreshold:              2.0,
    goldProjectionHours:       12,
    workerOptimizationEnabled: false,  // desabilitado até endpoint de mercado confirmado

    // COO
    transportMinLoadFactor:    0.9,    // 90% de carga mínima
    transportSafetyBufferS:    300,    // 5min de margem no JIT
    hubRefreshIntervalMs:      900_000, // recalcular hub a cada 15min

    // HR
    wineEmergencyHours:        4,      // alerta P0 abaixo deste valor
    wineTargetSatisfaction:    1,      // satisfação alvo (+1)

    // CSO
    capitalRiskThreshold:      40_000, // ~1 navio de guerra
    noiseFrequencyMin:         8,      // 1 noise a cada 8–15 ações reais
    noiseFrequencyMax:         15,

    // Timing
    heartbeatFocusMs:          60_000,
    heartbeatBackgroundMs:     300_000,
    humanDelayMinMs:           800,
    humanDelayMaxMs:           2500,

    // Mercado
    maxBuyPrice: { wood: Infinity, wine: Infinity, marble: Infinity, glass: Infinity, sulfur: Infinity },
    maxMarketDistanceIslands:  10,

    // Logística
    worldSpeedConst:           null,    // calibrar em jogo
    sameIslandTravelS:         900,
    departureFixedS:           1200,
};

class Config {
    constructor(storage) {
        this._storage = storage;
        this._data    = { ...DEFAULTS };
    }

    async init() {
        const saved = await this._storage.get('config');
        if (saved) this._data = { ...DEFAULTS, ...saved };
    }

    get(key)          { return this._data[key]; }

    async set(key, value) {
        this._data[key] = value;
        await this._storage.set('config', this._data);
    }

    async setMany(updates) {
        Object.assign(this._data, updates);
        await this._storage.set('config', this._data);
    }
}
```

### 4.7 utils.js

```javascript
// Box-Muller — retorna valor com distribuição gaussiana
export function gaussianRandom(mean, sigma) {
    const u1 = Math.random(), u2 = Math.random();
    const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * sigma;
}

// Delay humano com distribuição gaussiana, clampado em [min, max]
export function humanDelay(min, max, multiplier = 1.0) {
    const mean  = (min + max) / 2;
    const sigma = (max - min) / 6;
    const raw   = gaussianRandom(mean, sigma);
    const delay = Math.max(min, Math.min(max, raw)) * multiplier;
    return new Promise(resolve => setTimeout(resolve, delay));
}

// deepClone leve (sem funções, sem Map/Set) — para snapshot do estado
export function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// nanoid-lite: IDs únicos sem dependência externa
export function nanoid(size = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < size; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
}
```

### 4.8 Audit.js

Circular buffer de 200 entradas. Persiste batched a cada 10 entradas. Sem dependência de módulos de negócio.

```javascript
// Interface
Audit.log(level, module, message, data?, cityId?)
Audit.info(module, message, data?, cityId?)
Audit.warn(module, message, data?, cityId?)
Audit.error(module, message, data?, cityId?)
Audit.getEntries(filter?)   // { module?, level?, cityId?, since? }
Audit.clear()
```

Estrutura de entrada:
```javascript
{
    id:      String,   // nanoid(6)
    ts:      Number,   // Date.now()
    level:   'info' | 'warn' | 'error' | 'debug',
    module:  String,
    message: String,
    cityId:  Number | null,
    data:    any | null,
}
```

Regras:
- Buffer circular: ao atingir 200, sobrescreve mais antigas
- Persiste no Storage a cada 10 novas entradas (não a cada entrada)
- Restaura entradas do Storage na `init()`
- `Audit.error()` emite `Events.E.UI_ALERT_ADDED` automaticamente como P1

---

## 5. Camada 1 — Dados Estáticos

Arquivos puramente declarativos. Sem lógica de negócio. Sem dependências entre si.

### 5.1 data/const.js — revisar

Já existe. Verificar que contém:
- `Resources` (WOOD, WINE, MARBLE, GLASS/CRYSTAL, SULFUR)
- `Buildings` com todos os nomes de view exatos
- `BuildingsId` com IDs numéricos
- `PORT_LOADING_SPEED[1..60]`
- `TRAVEL` (DEPARTURE_FIXED_S, SAME_ISLAND_S, WORLD_SPEED_CONST: null)
- `BuildingsMultiple` (warehouse, port, shipyard)

### 5.2 data/buildings.js — adicionar funções

Já existe com `BUILDING_COSTS[building][level]`.

Adicionar:
```javascript
export function getCost(building, level) {
    return BUILDING_COSTS[building]?.[level] ?? null;
}

export function getCumulativeCost(building, toLevel) {
    let total = { wood: 0, marble: 0, glass: 0, sulfur: 0, wine: 0 };
    for (let l = 1; l <= toLevel; l++) {
        const cost = BUILDING_COSTS[building]?.[l];
        if (!cost) continue;
        for (const [res, val] of Object.entries(cost)) total[res] = (total[res] ?? 0) + val;
    }
    return total;
}
```

### 5.3 data/effects.js — verificar cobertura

Já existe. Confirmar que cobre os edifícios necessários para CFO/COO/HR/CTO:
`warehouse`, `dump`, `port`, `carpentering`, `architect`, `vineyard`, `optician`,
`palaceColony`, `tavern`, `academy`, `townHall`, `forester`.

### 5.4 data/wine.js — criar

```javascript
// Consumo de vinho por nível de taverna (índices 0–48, total 49 valores)
// Fonte: IKAEASY_FULL/js/const.js
export const WINE_USE = [
    0, 4, 8, 13, 18, 24, 30, 37, 44, 51, 60, 68, 78, 88, 99,
    110, 122, 136, 150, 165, 180, 197, 216, 235, 255, 277, 300, 325, 351, 378, 408,
    439, 472, 507, 544, 584, 626, 670, 717, 766, 818, 874, 933, 995, 1060, 1129,
    1202, 1280, 1362
];

// Retorna o índice mínimo cujo consumo >= wineSpendings
// Retorna -1 se wineSpendings > WINE_USE[48] = 1362 (incobrível pela taverna)
export function getMinWineLevel(wineSpendings) {
    if (wineSpendings <= 0) return 0;
    const idx = WINE_USE.findIndex(v => v >= wineSpendings);
    return idx; // -1 é válido — chamador deve tratar
}
```

### 5.5 data/research.js — criar

```javascript
// Fonte: IKAEASY_FULL/js/const.js
export const Research = Object.freeze({
    Seafaring: {
        CARPENTRY: 2150, DECK_WEAPONS: 1010, PIRACY: 1170,
        SHIP_MAINTENANCE: 1020, DRAFT: 1130, EXPANSION: 1030,
        FOREIGN_CULTURES: 1040, PITCH: 1050, MARKET: 2070,
        GREEK_FIRE: 1060, COUNTERWEIGHT: 1070, DIPLOMACY: 1080,
        SEA_MAPS: 1090, PADDLE_WHEEL_ENGINE: 1100, CAULKING: 1140,
        MORTAR_ATTACHMENT: 1110, MASSIVE_RAM: 1150, OFFSHORE_BASE: 1160,
        SEAFARING_FUTURE: 1999,
    },
    Economy: {
        CONSERVATION: 2010, PULLEY: 2020, WEALTH: 2030,
        WINE_CULTURE: 2040, IMPROVED_RESOURCE_GATHERING: 2130,
        GEOMETRY: 2060, ARCHITECTURE: 1120, HOLIDAY: 2080,
        LEGISLATION: 2170, CULINARY_SPECIALITIES: 2050, HELPING_HANDS: 2090,
        SPIRIT_LEVEL: 2100, WINE_PRESS: 2140, DEPOT: 2160,
        BUREACRACY: 2110, UTOPIA: 2120, ECONOMIC_FUTURE: 2999,
    },
    Science: {
        WELL_CONSTRUCTION: 3010, PAPER: 3020, ESPIONAGE: 3030,
        POLYTHEISM: 3040, INK: 3050, GOVERNMENT_FORMATION: 3150,
        INVENTION: 3140, CULTURAL_EXCHANGE: 3060, ANATOMY: 3070,
        OPTICS: 3080, EXPERIMENTS: 3081, MECHANICAL_PEN: 3090,
        BIRDS_FLIGHT: 3100, LETTER_CHUTE: 3110, STATE_RELIGION: 3160,
        PRESSURE_CHAMBER: 3120, ARCHIMEDEAN_PRINCIPLE: 3130,
        SCIENTIFIC_FUTURE: 3999,
    },
    Military: {
        DRY_DOCKS: 4010, MAPS: 4020, PROFESSIONAL_ARMY: 4030,
        SEIGE: 4040, CODE_OF_HONOR: 4050, BALLISTICS: 4060,
        LAW_OF_THE_LEVEL: 4070, GOVERNOR: 4080, PYROTECHNICS: 4130,
        LOGISTICS: 4090, GUNPOWDER: 4100, ROBOTICS: 4110,
        CANNON_CASTING: 4120, MILITARISTIC_FUTURE: 4999,
    },
});

// Pesquisas que reduzem custo de construção — prioridade do CTO
export const COST_REDUCERS = [
    Research.Economy.PULLEY,          // -5% madeira em construção
    Research.Economy.GEOMETRY,        // -5% mármore em construção
    Research.Economy.ARCHITECTURE,    // -3% todos os recursos
    Research.Economy.CONSERVATION,    // -5% madeira
    Research.Science.PAPER,           // +2% research/h
    Research.Science.INK,             // +4% research/h
    Research.Science.MECHANICAL_PEN,  // +8% research/h
];
```

---

## 6. Camada 2 — Aquisição e Estado

### 6.1 DataCollector.js

Roda em page context. Recebe callbacks do interceptor instalado em inject.js.
Não faz requests próprios — quem faz requests é o GameClient.

```javascript
class DataCollector {
    constructor({ events, audit }) {
        this._events    = events;
        this._audit     = audit;
        this._lastToken = null;
    }

    init() {
        // Registrar o callback do interceptor instalado em inject.js
        window.__erpInterceptCallback = this._onResponse.bind(this);
        this._startModelMonitor();
    }

    _onResponse(url, text) {
        // Parsing robusto: ignorar não-JSON e não-array
        let data;
        try {
            const trimmed = text.trim();
            if (!trimmed.startsWith('[')) return;
            data = JSON.parse(trimmed);
            if (!Array.isArray(data)) return;
        } catch {
            return;
        }

        // Extrair headerData e token
        const globalCmd = data.find(c => Array.isArray(c) && c[0] === 'updateGlobalData')?.[1];
        if (globalCmd?.headerData) {
            this._lastToken = globalCmd.actionRequest ?? this._lastToken;
            this._events.emit(this._events.E.DC_HEADER_DATA, {
                headerData: globalCmd.headerData,
                token:      this._lastToken,
                url,
            });
        }

        // Extrair screen.data da view atual
        const screenCmd = data.find(c => Array.isArray(c) && c[0] === 'updateBackgroundData')?.[1];
        if (screenCmd?.backgroundView) {
            this._events.emit(this._events.E.DC_SCREEN_DATA, {
                screenData: screenCmd.backgroundView,
                url,
            });
        }
    }

    _startModelMonitor() {
        const tick = () => {
            const model = window.ikariam?.model;
            if (model) {
                this._events.emit(this._events.E.DC_MODEL_REFRESH, { model });
            }
            const delay = document.visibilityState === 'hidden' ? 300_000 : 15_000;
            setTimeout(tick, delay);
        };
        // Aguardar 1s para o jogo inicializar antes do primeiro check
        setTimeout(tick, 1_000);
    }

    getToken()          { return this._lastToken; }
    setToken(token)     { this._lastToken = token; }
}
```

**`fetchAllCities` — não está aqui.** Está no StateManager (que coordena), executado via GameClient (que navega). Ver seção 6.2.

### 6.2 StateManager.js

Fonte única de verdade. Não faz requests. Mantém o estado de todas as cidades.

```javascript
class StateManager {
    constructor({ events, audit, config }) {
        this._events  = events;
        this._audit   = audit;
        this._config  = config;
        this.cities   = new Map();          // cityId → CityState
        this.research = null;               // ResearchState
        this.fleetMovements = [];
        this.serverTimeOffset = 0;          // (Date.now()/1000) - serverTs
        this.lastFullRefresh  = 0;
        this._activeCityId    = null;
        this._probing         = false;      // true durante fetchAllCities
        this._ready           = false;
        this._readyPromise    = new Promise(r => { this._resolveReady = r; });
        // Inferência de underConstruction para cidades não-ativas
        // Map<cityId, { position, startedAt }>
        this._inferredBuilding = new Map();
    }

    init() {
        this._events.on(this._events.E.DC_HEADER_DATA,     this._onHeaderData.bind(this));
        this._events.on(this._events.E.DC_MODEL_REFRESH,   this._onModelRefresh.bind(this));
        this._events.on(this._events.E.DC_SCREEN_DATA,     this._onScreenData.bind(this));
        this._events.on(this._events.E.DC_FLEET_MOVEMENTS, this._onFleetMovements.bind(this));
        // Inferência: marcar como construindo quando BUILD task inicia
        this._events.on(this._events.E.QUEUE_TASK_STARTED, this._onTaskStarted.bind(this));
        // Limpar inferência quando BUILD task termina
        this._events.on(this._events.E.QUEUE_TASK_DONE,    this._onTaskDone.bind(this));
        this._events.on(this._events.E.QUEUE_TASK_FAILED,  this._onTaskDone.bind(this));
    }

    // Aguardar 1º model refresh antes de qualquer operação
    waitReady() { return this._readyPromise; }

    _onModelRefresh({ model }) {
        // Atualizar offset de tempo do servidor a cada refresh (corrige drift)
        const serverTs = Number(model.serverTime ?? 0);
        if (serverTs > 0) {
            this.serverTimeOffset = Date.now() / 1000 - serverTs;
        }

        // Atualizar cityId ativo
        const relatedData = model.relatedCityData;
        if (relatedData) {
            this._activeCityId = Number(relatedData.selectedCityId ?? 0);

            for (const [cityId, cityData] of Object.entries(relatedData)) {
                if (isNaN(Number(cityId))) continue;
                const id = Number(cityId);
                if (!this.cities.has(id)) {
                    this.cities.set(id, this._createEmptyCityState(id, cityData));
                }
                const city = this.cities.get(id);
                city.coords = cityData.coords ? [cityData.coords.x, cityData.coords.y] : city.coords;
                city.islandId = Number(cityData.islandId ?? city.islandId);
            }
        }

        // Atualizar pesquisa
        if (model.research) {
            this.research = {
                investigated: new Set(model.research.investigated ?? []),
                inProgress:   model.research.inProgress ?? null,
                pointsPerHour: Number(model.research.pointsPerHour ?? 0),
                fetchedAt:    Date.now(),
            };
            this._events.emit(this._events.E.STATE_RESEARCH, { research: this.research });
        }

        // lockedPositions por cidade
        if (model.backgroundView?.lockedPosition) {
            const cityId = this._activeCityId;
            if (cityId && this.cities.has(cityId)) {
                const locked = model.backgroundView.lockedPosition;
                this.cities.get(cityId).lockedPositions =
                    new Set(Object.keys(locked).map(Number));
            }
        }

        if (!this._ready) {
            this._ready = true;
            this._resolveReady();
            this._events.emit(this._events.E.STATE_READY, {});
        }
    }

    _onHeaderData({ headerData, token }) {
        const cityId = this._activeCityId;
        if (!cityId) return;
        const city = this.cities.get(cityId) ?? this._createEmptyCityState(cityId, {});
        this.cities.set(cityId, city);

        // Type-safe — sempre Number()
        city.resources.wood   = Number(headerData.currentResources?.resource ?? city.resources.wood);
        city.resources.wine   = Number(headerData.currentResources?.['1']    ?? city.resources.wine);
        city.resources.marble = Number(headerData.currentResources?.['2']    ?? city.resources.marble);
        city.resources.glass  = Number(headerData.currentResources?.['3']    ?? city.resources.glass);
        city.resources.sulfur = Number(headerData.currentResources?.['4']    ?? city.resources.sulfur);
        city.maxResources     = Number(headerData.maxStorage ?? city.maxResources);
        city.freeTransporters = Number(headerData.freeTransporters ?? city.freeTransporters);
        city.maxTransporters  = Number(headerData.maxTransporters  ?? city.maxTransporters);
        city.production.wineSpendings = Number(headerData.wineSpendings ?? city.production.wineSpendings);
        city.fetchedAt        = Date.now();

        this._events.emit(this._events.E.STATE_CITY_UPDATED, { cityId });
    }

    _onScreenData({ screenData }) {
        const cityId = this._activeCityId;
        if (!cityId || !this.cities.has(cityId)) return;
        const city = this.cities.get(cityId);

        if (screenData.position) city.buildings   = screenData.position;
        if (screenData.underConstruction !== undefined)
            city.underConstruction = screenData.underConstruction;
        if (screenData.islandId)  city.islandId   = Number(screenData.islandId);
        if (screenData.citizens !== undefined)
            city.economy.citizens = Number(screenData.citizens);

        this._events.emit(this._events.E.STATE_CITY_UPDATED, { cityId });
    }

    _onFleetMovements({ movements }) {
        this.fleetMovements = movements;
    }

    // Inferência de underConstruction para cidades não-ativas
    _onTaskStarted({ task }) {
        if (task.type !== 'BUILD') return;
        this._inferredBuilding.set(task.cityId, {
            position:  task.payload.position,
            startedAt: Date.now(),
        });
    }

    _onTaskDone({ task }) {
        if (task.type !== 'BUILD') return;
        this._inferredBuilding.delete(task.cityId);
        // Se a cidade acabou de ser atualizada, limpar também no CityState
        if (this.cities.has(task.cityId)) {
            // underConstruction será atualizado pelo próximo headerData/screenData
        }
    }

    // API pública
    getCity(cityId)       { return this.cities.get(cityId) ?? null; }
    getAllCities()         { return [...this.cities.values()]; }
    getAllCityIds()        { return [...this.cities.keys()]; }
    getActiveCityId()     { return this._activeCityId; }
    isProbing()           { return this._probing; }

    getServerNow() {
        return Math.floor(Date.now() / 1000) - this.serverTimeOffset;
    }

    needsRefresh(cityId) {
        const city = this.cities.get(cityId);
        if (!city) return true;
        return (Date.now() - city.fetchedAt) > 300_000;
    }

    getConfidence(cityId) {
        const city = this.cities.get(cityId);
        if (!city) return 'UNKNOWN';
        const age = Date.now() - city.fetchedAt;
        if (age < 60_000)  return 'HIGH';
        if (age < 300_000) return 'MEDIUM';
        return 'LOW';
    }

    getUnderConstruction(cityId) {
        if (cityId === this._activeCityId) {
            return this.cities.get(cityId)?.underConstruction ?? -1;
        }
        // Para cidades não-ativas: usar inferência
        return this._inferredBuilding.has(cityId)
            ? this._inferredBuilding.get(cityId).position
            : -1;
    }

    // Snapshot imutável do estado completo (para Optimizer — Fase B/C)
    snapshot() {
        return deepClone({
            cities:         Object.fromEntries(
                [...this.cities.entries()].map(([k, v]) => [k, {
                    ...v,
                    lockedPositions: [...v.lockedPositions],
                }])
            ),
            research:       { ...this.research, investigated: [...this.research?.investigated ?? []] },
            fleetMovements: this.fleetMovements,
            serverNow:      this.getServerNow(),
        });
    }

    // Coordenar fetchAllCities — pausa builds durante a navegação
    async fetchAllCities(gameClient, cityIds) {
        this._probing = true;
        const originalCity = this._activeCityId;
        this._events.emit(this._events.E.QUEUE_BLOCKED, { reason: 'fetchAllCities em progresso' });

        try {
            for (const cityId of cityIds) {
                await gameClient.navigate(cityId);
                await humanDelay(1200, 2000);
                // headerData e screenData chegam via interceptor automaticamente
            }
        } finally {
            // Retornar à cidade original
            if (originalCity && originalCity !== this._activeCityId) {
                await gameClient.navigate(originalCity);
            }
            this._probing = false;
            this.lastFullRefresh = Date.now();
            this._events.emit(this._events.E.STATE_ALL_FRESH, { ts: this.lastFullRefresh });
        }
    }

    _createEmptyCityState(id, data) {
        return {
            id,
            name:              data.name ?? `City ${id}`,
            isCapital:         data.isCapital ?? false,
            islandId:          Number(data.islandId ?? 0),
            tradegood:         Number(data.tradegood ?? 0),
            coords:            data.coords ? [data.coords.x, data.coords.y] : [0, 0],
            resources:         { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 },
            maxResources:      0,
            freeTransporters:  0,
            maxTransporters:   0,
            production:        { wood: 0, tradegood: 0, wineSpendings: 0 },
            buildings:         [],
            underConstruction: -1,
            lockedPositions:   new Set(),
            economy: {
                population: 0, maxInhabitants: 0, growthPerHour: 0,
                citizens: 0, goldPerHour: 0, corruption: 0,
                satisfaction: 0, actionPoints: 0,
            },
            workers:           { wood: 0, tradegood: 0, scientists: 0, priests: 0 },
            tavern:            { wineLevel: 0, winePerHour: 0 },
            fetchedAt:         0,
        };
    }
}
```

**Frequência de `fetchAllCities`:**
```javascript
// Agendado pelo heartbeat em inject.js:
// - Tab em foco:      a cada 15min (900_000ms)
// - Tab em background: a cada 60min (3_600_000ms)
// - Trigger manual:   via ui:command { type: 'refresh' }
```

---

## 7. Camada 3 — Execução

### 7.1 GameClient.js

Único ponto de saída. Tem fila interna de requests para garantir execução sequencial com delay entre cada um.

```javascript
class GameClient {
    constructor({ collector, config, audit }) {
        this._collector  = collector;
        this._config     = config;
        this._audit      = audit;
        this._queue      = Promise.resolve(); // fila sequencial interna
    }

    // Toda chamada passa pela fila interna — serialização garantida
    _enqueue(fn) {
        this._queue = this._queue
            .then(() => humanDelay(
                this._config.get('humanDelayMinMs'),
                this._config.get('humanDelayMaxMs')
            ))
            .then(fn);
        return this._queue;
    }

    navigate(cityId) {
        return this._enqueue(() => this._get(
            `/index.php?view=city&cityId=${cityId}&backgroundView=city&currentCityId=${cityId}&ajax=1`
        ));
    }

    upgradeBuilding(cityId, position, buildingView, templateView) {
        return this._enqueue(async () => {
            await this._guardBuild(cityId, position);
            return this._post({
                action:         'UpgradeExistingBuilding',
                function:       'upgradeBuilding',
                view:           buildingView,
                cityId:         String(cityId),
                position:       String(position),
                backgroundView: 'city',
                currentCityId:  String(cityId),
                templateView,
                actionRequest:  this._token(),
                ajax:           1,
            });
        });
    }

    sendTransport(fromCityId, toCityId, toIslandId, cargo, boats) {
        return this._enqueue(() => this._post({
            action:                'transportOperations',
            function:              'loadTransportersWithFreight',
            destinationCityId:     toCityId,
            islandId:              toIslandId,       // DESTINO, não origem
            normalTransportersMax: boats,
            cargo_resource:        cargo.wood    ?? 0,
            cargo_tradegood1:      cargo.wine    ?? 0,
            cargo_tradegood2:      cargo.marble  ?? 0,
            cargo_tradegood3:      cargo.glass   ?? 0,
            cargo_tradegood4:      cargo.sulfur  ?? 0,
            capacity:              5,               // SEMPRE 5
            max_capacity:          5,               // SEMPRE 5
            transporters:          boats,
            backgroundView:        'city',
            currentCityId:         String(fromCityId),
            templateView:          'transport',
            currentTab:            'tabSendTransporter',
            actionRequest:         this._token(),
            ajax:                  1,
        }));
    }

    startResearch(researchId) {
        return this._enqueue(() => this._post({
            action:        'CityScreen',
            function:      'startResearch',
            researchId:    String(researchId),
            actionRequest: this._token(),
            ajax:          1,
        }));
    }

    setTavernWine(cityId, wineLevel) {
        return this._enqueue(() => this._post({
            action:        'CityScreen',
            function:      'setWineLevel',
            position:      String(wineLevel),
            cityId:        String(cityId),
            currentCityId: String(cityId),
            actionRequest: this._token(),
            ajax:          1,
        }));
    }

    async fetchBuildingCosts(cityId, position, buildingView) {
        const html = await this._enqueue(() => this._get(
            `/index.php?view=${buildingView}&cityId=${cityId}&position=${position}` +
            `&backgroundView=city&currentCityId=${cityId}&ajax=1`
        ));
        return this._parseCosts(html);
    }

    fetchMilitaryAdvisor() {
        return this._enqueue(() => this._get(
            '/index.php?view=militaryAdvisor&oldView=city&ajax=1'
        ));
    }

    fetchTownHall(cityId) {
        return this._enqueue(() => this._get(
            `/index.php?view=townHall&cityId=${cityId}&backgroundView=city&currentCityId=${cityId}&ajax=1`
        ));
    }

    // Probe para journeyTime de uma rota (COO)
    async probeJourneyTime(fromCityId, toCityId) {
        const html = await this._enqueue(() => this._get(
            `/index.php?view=transport&cityId=${fromCityId}&destinationCityId=${toCityId}` +
            `&backgroundView=city&currentCityId=${fromCityId}&ajax=1`
        ));
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const el  = doc.getElementById('journeyTime');
        return el ? parseInt(el.innerText, 10) : null;
    }

    // ── privados ──

    _token() {
        const token = this._collector.getToken();
        if (!token) this._audit.warn('GameClient', 'Token nulo — request pode falhar');
        return token ?? '';
    }

    async _guardBuild(cityId, position) {
        // Verificar via StateManager (injetado se necessário)
        // Guard é responsabilidade do TaskQueue._execute — ver seção 7.2
    }

    async _get(url) {
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) throw new GameError('HTTP_ERROR', `GET ${url} → ${resp.status}`);
        return resp.text();
    }

    async _post(payload) {
        const body = new URLSearchParams(payload).toString();
        const resp = await fetch('/index.php', {
            method:      'POST',
            credentials: 'include',
            headers:     { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });
        if (!resp.ok) throw new GameError('HTTP_ERROR', `POST → ${resp.status}`);
        const text = await resp.text();
        // Verificar erro de jogo na resposta (ex: token inválido)
        let data;
        try { data = JSON.parse(text); } catch { throw new GameError('PARSE_ERROR', text.slice(0, 100)); }
        const errorCmd = data.find?.(c => c[0] === 'errorWindow');
        if (errorCmd) throw new GameError('GAME_ERROR', errorCmd[1]?.message ?? 'Unknown game error');
        return text;
    }

    _parseCosts(html) {
        const doc  = new DOMParser().parseFromString(html, 'text/html');
        const lis  = [...doc.querySelectorAll('ul.costs li, ul.resources li')];
        const cost = {};
        for (const li of lis) {
            li.querySelector('.accesshint')?.remove(); // OBRIGATÓRIO
            const val = parseInt(li.textContent.trim().replace(/[.\s]/g, ''), 10);
            const cls = [...li.classList].find(c => c !== 'costs');
            if (cls && !isNaN(val)) cost[cls] = val;
        }
        return cost;
    }
}

// Taxonomia de erros — TaskQueue trata diferente por tipo
class GameError extends Error {
    constructor(type, message) {
        super(message);
        this.type = type;
        // RETRY    → erro transiente, tentar novamente (HTTP_ERROR, GAME_ERROR temporário)
        // FATAL    → não tentar novamente (PARSE_ERROR, erro de lógica)
        // GUARD    → pré-condição não atendida (não é erro de rede)
        this.fatal = type === 'PARSE_ERROR';
    }
}
```

### 7.2 TaskQueue.js

Fila JIT persistida. Executor sequencial. Respeita OperationMode.

**Estrutura de Task:**
```javascript
Task = {
    id:           String,        // nanoid(8)
    type:         'BUILD' | 'TRANSPORT' | 'RESEARCH' | 'NAVIGATE'
                | 'NOISE' | 'WORKER_REALLOC' | 'WINE_ADJUST',
    status:       'planned' | 'pending' | 'in-flight' | 'blocked' | 'failed' | 'done',
    priority:     Number,        // 0 = urgente, 100 = baixíssima
    cityId:       Number,
    payload:      Object,
    scheduledFor: Number,        // ms timestamp — JIT
    createdAt:    Number,
    attempts:     Number,
    maxAttempts:  Number,        // default 3
    reason:       String,        // "Por que esta task existe"
    module:       String,        // módulo que criou
    confidence:   'HIGH' | 'MEDIUM' | 'LOW',
}
```

**`_execute(task)` — fluxo completo:**
```javascript
async _execute(task) {
    this._executing = true;
    task.status = 'in-flight';
    this._persist();
    this._events.emit(Events.E.QUEUE_TASK_STARTED, { task });

    try {
        // 1. Verificar OperationMode
        const mode = this._config.get('operationMode');
        if (mode === 'MANUAL') {
            // Suspender: aguardar aprovação manual via ui:command { type: 'approveTask' }
            task.status = 'blocked';
            this._persist();
            return;
        }
        if (mode === 'SAFE' && task.confidence !== 'HIGH') {
            task.status = 'blocked';
            this._audit.warn('TaskQueue', `SAFE MODE: task ${task.id} suspensa por confiança ${task.confidence}`);
            this._persist();
            return;
        }

        // 2. Verificar se StateManager está em probe (fetchAllCities)
        if (this._state.isProbing() && task.type === 'BUILD') {
            this._reschedule(task, 30_000);
            return;
        }

        // 3. Guards específicos por tipo de task
        await this._runGuards(task);

        // 4. Executar via GameClient
        await this._dispatch(task);

        // 5. Sucesso
        task.status = 'done';
        this._persist();
        this._events.emit(Events.E.QUEUE_TASK_DONE, { task });
        this._noiseCounter++;

        // Inserir NOISE se necessário (CSO delega ao TaskQueue)
        if (this._noiseCounter >= this._nextNoisAt) {
            this._scheduleNoise();
        }

    } catch (err) {
        task.attempts++;

        if (err instanceof GameError && err.fatal) {
            task.status = 'failed';
            this._audit.error('TaskQueue', `Task ${task.id} FATAL: ${err.message}`, { task, err: err.type });
            this._events.emit(Events.E.QUEUE_TASK_FAILED, { task, error: err.message, fatal: true });
        } else if (task.attempts >= task.maxAttempts) {
            task.status = 'failed';
            this._audit.error('TaskQueue', `Task ${task.id} falhou ${task.maxAttempts}×: ${err.message}`);
            this._events.emit(Events.E.QUEUE_TASK_FAILED, { task, error: err.message, fatal: false });
        } else {
            // Retry em 30s
            this._reschedule(task, 30_000);
            this._audit.warn('TaskQueue', `Task ${task.id} retry ${task.attempts}/${task.maxAttempts}: ${err.message}`);
        }
        this._persist();
    } finally {
        this._executing = false;
    }
}
```

**Guards por tipo de task:**
```javascript
async _runGuards(task) {
    if (task.type === 'BUILD') {
        const city = this._state.getCity(task.cityId);

        const uc = this._state.getUnderConstruction(task.cityId);
        if (uc !== -1 && uc !== false)
            throw new GameError('GUARD', `Cidade ${task.cityId} já está construindo (pos ${uc})`);

        if (city.lockedPositions.has(task.payload.position))
            throw new GameError('GUARD', `Slot ${task.payload.position} bloqueado por pesquisa`);

        // Navegar para a cidade se necessário
        if (this._state.getActiveCityId() !== task.cityId) {
            await this._client.navigate(task.cityId);
        }

        // Verificar ouro projetado
        if (!this._cfo.canAfford(task.cityId, task.payload.cost)) {
            this._reschedule(task, 3_600_000); // adiar 1h
            throw new GameError('GUARD', `Ouro insuficiente para build em ${task.cityId}`);
        }
    }

    if (task.type === 'TRANSPORT') {
        const origin = this._state.getCity(task.payload.fromCityId);
        const loadFactor = task.payload.totalCargo /
            (origin.freeTransporters * 500 * 5);

        if (!task.payload.wineEmergency && loadFactor < this._config.get('transportMinLoadFactor')) {
            // Aguardar retorno de barcos
            const waitMs = (task.payload.estimatedReturnS ?? 3600) * 1000;
            this._reschedule(task, waitMs);
            throw new GameError('GUARD', `Carga insuficiente (${(loadFactor*100).toFixed(0)}%) — aguardando barcos`);
        }
    }
}
```

**`_dispatch(task)` — roteamento para GameClient:**
```javascript
async _dispatch(task) {
    switch (task.type) {
        case 'BUILD':
            return this._client.upgradeBuilding(
                task.cityId, task.payload.position,
                task.payload.buildingView, task.payload.templateView
            );
        case 'TRANSPORT':
            return this._client.sendTransport(
                task.payload.fromCityId, task.payload.toCityId,
                task.payload.toIslandId, task.payload.cargo, task.payload.boats
            );
        case 'RESEARCH':
            return this._client.startResearch(task.payload.researchId);
        case 'WINE_ADJUST':
            return this._client.setTavernWine(task.cityId, task.payload.wineLevel);
        case 'NAVIGATE':
            return this._client.navigate(task.cityId);
        case 'NOISE':
            return this._client.navigate(task.cityId); // visita uma view aleatória
        case 'WORKER_REALLOC':
            // implementar endpoint quando confirmado
            this._audit.info('TaskQueue', 'WORKER_REALLOC: endpoint não confirmado ainda');
            return;
    }
}
```

**`_tick()` — loop principal:**
```javascript
_tick() {
    const now  = Date.now();
    const mode = this._config.get('operationMode');

    const ready = this._queue
        .filter(t => t.status === 'pending' && t.scheduledFor <= now)
        .sort((a, b) => a.priority - b.priority || a.scheduledFor - b.scheduledFor);

    if (ready.length > 0 && !this._executing && mode !== 'MANUAL') {
        this._execute(ready[0]).catch(e => {
            this._audit.error('TaskQueue', `_execute uncaught: ${e.message}`);
        });
    }

    const delay = document.visibilityState === 'hidden'
        ? this._config.get('heartbeatBackgroundMs')
        : this._config.get('heartbeatFocusMs');

    setTimeout(() => this._tick(), delay);
}
```

**NOISE schedule — responsabilidade do CSO, executada aqui:**
```javascript
_scheduleNoise() {
    const min  = this._config.get('noiseFrequencyMin');
    const max  = this._config.get('noiseFrequencyMax');
    this._nextNoisAt  = this._noiseCounter + Math.floor(min + Math.random() * (max - min));
    const views  = ['embassy', 'barracks', 'museum', 'academy', 'temple'];
    const view   = views[Math.floor(Math.random() * views.length)];
    const cities = this._state.getAllCities();
    const city   = cities[Math.floor(Math.random() * cities.length)];
    this.add({
        type:         'NOISE',
        priority:     50,
        cityId:       city.id,
        payload:      { view },
        scheduledFor: Date.now() + humanDelay(5000, 30000),
        reason:       `Mimetismo: visita a ${view}`,
        module:       'CSO',
        confidence:   'HIGH',
    });
}
```

**Persistência:**
- `_persist()` salva `this._queue.filter(t => t.status !== 'done')` no Storage
- Chave: `storageKey('taskQueue')`
- Tasks `done` são mantidas apenas em memória (últimas 50) para o histórico da UI

---

## 8. Camada 4 — Módulos de Negócio

**Padrão de todos os módulos:**
- Construtor recebe dependências por injeção
- `init()` registra listeners em Events
- `replan()` re-executa a avaliação principal (equivalente a receber `STATE_ALL_FRESH`)
- Toda decisão documentada via `Audit`
- Nunca faz requests diretos — sempre via `TaskQueue.add()`

### 8.1 CFO.js

**Triggers:**
- `Events.E.STATE_ALL_FRESH` — avaliação completa após refresh
- `Events.E.QUEUE_TASK_DONE` com type=BUILD — reavaliar próximo build

**`evaluateCity(cityId)`:**
```javascript
evaluateCity(cityId) {
    const city     = this._state.getCity(cityId);
    const research = this._state.research;
    if (!city || this._state.getConfidence(cityId) === 'LOW') return;

    // 1. Encontrar o melhor próximo build por score dinâmico
    const candidates = this._getBuildCandidates(city, research);
    if (!candidates.length) return;

    const best = candidates[0];

    // 2. Verificar ROI
    const roi = this._calcROI(best.building, best.level, city);
    if (roi < this._config.get('roiThreshold')) {
        this._audit.info('CFO', `ROI insuficiente para ${best.building} lv${best.level}: ${roi.toFixed(2)}`, { cityId });
        return;
    }

    // 3. Verificar ouro projetado
    if (!this.canAfford(cityId, best.cost)) {
        this._audit.info('CFO', `Sem ouro projetado para ${best.building} em ${city.name}`, { cityId });
        return;
    }

    // 4. Verificar se já há build pendente na fila para esta cidade
    if (this._queue.hasPendingBuild(cityId)) return;

    // 5. Aprovar
    this._audit.info('CFO', `Build aprovado: ${best.building} lv${best.level} em ${city.name} (ROI=${roi.toFixed(2)})`, { cityId });
    this._events.emit(Events.E.CFO_BUILD_APPROVED, {
        cityId, building: best.building, position: best.position,
        level: best.level, cost: best.cost, reason: best.reason,
    });

    this._queue.add({
        type:         'BUILD',
        priority:     Math.max(0, 100 - best.score),
        cityId,
        payload: {
            building:     best.building,
            position:     best.position,
            buildingView: best.buildingView,
            templateView: best.templateView,
            cost:         best.cost,
            level:        best.level,
        },
        scheduledFor: Date.now(),
        reason:       `CFO: ${best.reason}`,
        module:       'CFO',
        confidence:   this._state.getConfidence(cityId),
    });
}
```

**`_buildingScore(building, cityState, researchState)`:**
```javascript
_buildingScore(building, city, research) {
    const BASE = {
        carpentering:  90, architect: 85,    palaceColony: 10,
        academy:       60, port:       50,    warehouse:    45,
        tavern:        40, townHall:   35,    forester:     30,
    };
    let score = BASE[building] ?? 20;

    // Corrupção: palaceColony tem prioridade absoluta
    if (city.economy.corruption > 0.01) {
        if (building === 'palaceColony') score = 100;
        else score = Math.max(0, score - 20);
    }

    // Fila de madeira futura
    if (building === 'carpentering') {
        const woodQueue = this._calcWoodQueue(city);
        if (woodQueue > 500_000) score = Math.min(90, score + 10 * (woodQueue / 500_000 - 1));
    }

    // Porto lento
    if (building === 'port') {
        const loadTime = this._calcLoadTime(city);
        if (loadTime > 1800) score = Math.min(80, score + 30);
    }

    // Pesquisa redutora próxima
    if (building === 'academy' && this._researchProximityBonus(research) > 0) {
        score = Math.min(95, score + 35);
    }

    return score;
}
```

**`canAfford(cityId, cost)`:**
```javascript
canAfford(cityId, cost) {
    const city = this._state.getCity(cityId);
    if (!city) return false;
    const hours = this._config.get('goldProjectionHours');
    const goldProjected = city.economy.goldPerHour * hours;
    // Verificar apenas ouro — recursos são gerenciados pelo COO
    return goldProjected >= 0; // simplificado; expandir quando upkeep estiver modelado
}
```

**`replan()`:**
```javascript
replan() {
    for (const city of this._state.getAllCities()) {
        this.evaluateCity(city.id);
    }
}
```

### 8.2 COO.js

**Triggers:**
- `Events.E.QUEUE_TASK_ADDED` com type=BUILD — agendar JIT transport
- `Events.E.STATE_ALL_FRESH` — verificar overflow, recalcular hub
- `Events.E.DC_HEADER_DATA` — detectar overflow imediato

**Nota sobre o trigger de JIT:** COO escuta `QUEUE_TASK_ADDED` (não `CFO_BUILD_APPROVED`). Isso desacopla CFO e COO — ambos dependem apenas da TaskQueue.

```javascript
init() {
    this._events.on(Events.E.QUEUE_TASK_ADDED, ({ task }) => {
        if (task.type === 'BUILD') this._scheduleJITForBuild(task);
    });
    this._events.on(Events.E.STATE_ALL_FRESH, () => {
        this._hub = this._identifyHub();
        this._checkOverflow();
    });
    this._events.on(Events.E.DC_HEADER_DATA, () => {
        this._checkOverflow();
    });
}
```

**`_scheduleJITForBuild(buildTask)`:**
```javascript
async _scheduleJITForBuild(buildTask) {
    const destCity = this._state.getCity(buildTask.cityId);
    if (!destCity) return;

    const cost = buildTask.payload.cost;

    for (const [res, needed] of Object.entries(cost)) {
        if (!needed || needed <= 0) continue;

        const current  = destCity.resources[res] ?? 0;
        const deficit  = Math.max(0, needed - current);
        if (deficit <= 0) continue;

        const source   = this._findSource(res, deficit);
        if (!source) {
            this._audit.warn('COO', `Sem fonte para ${res} (deficit ${deficit}) para build em ${destCity.name}`);
            continue;
        }

        const eta = await this._calculateEta(source, destCity, deficit);
        if (!eta) continue; // WORLD_SPEED_CONST não calibrado

        // buildFinishTs: usa underConstruction se existir, senão agora
        const buildStart = buildTask.scheduledFor ?? Date.now();
        const dispatchTs = buildStart - (eta.totalEta * 1000) - (this._config.get('transportSafetyBufferS') * 1000);
        const sendAt     = Math.max(dispatchTs, Date.now());

        this._queue.add({
            type:         'TRANSPORT',
            priority:     10,
            cityId:       source.id,
            payload: {
                fromCityId:        source.id,
                toCityId:          destCity.id,
                toIslandId:        destCity.islandId,
                cargo:             { [res]: deficit },
                boats:             Math.ceil(deficit / (500 * 5)),
                totalCargo:        deficit,
                estimatedReturnS:  eta.travelTime * 2,
            },
            scheduledFor: sendAt,
            reason:       `JIT para ${buildTask.payload.building} em ${destCity.name}: ${res}+${deficit}`,
            module:       'COO',
            confidence:   this._state.getConfidence(source.id),
        });
    }
}
```

**`_calculateEta(originCity, destCity, cargo)`:**
```javascript
async _calculateEta(originCity, destCity, cargo) {
    const V           = this._getCityLoadingSpeed(originCity);
    const loadingTime = Math.ceil((cargo / V) * 60);

    let travelTime;

    if (originCity.islandId === destCity.islandId) {
        travelTime = this._config.get('sameIslandTravelS');
    } else {
        const worldConst = this._config.get('worldSpeedConst');
        if (worldConst) {
            const D = Math.hypot(
                destCity.coords[0] - originCity.coords[0],
                destCity.coords[1] - originCity.coords[1]
            );
            travelTime = Math.ceil(D * worldConst + this._config.get('departureFixedS'));
        } else {
            // Tentar obter via probe
            const cacheKey = `journeyTime_${originCity.id}_${destCity.id}`;
            let journeyTime = await this._storage.get(cacheKey);
            if (!journeyTime) {
                journeyTime = await this._client.probeJourneyTime(originCity.id, destCity.id);
                if (journeyTime) await this._storage.set(cacheKey, journeyTime);
            }
            if (journeyTime) {
                travelTime = journeyTime;
            } else {
                this._audit.warn('COO', 'journeyTime não disponível — JIT desabilitado para esta rota');
                return null;
            }
        }
    }

    return { loadingTime, travelTime, totalEta: loadingTime + travelTime };
}
```

**`replan()`:**
```javascript
replan() {
    this._hub = this._identifyHub();
    this._checkOverflow();
}
```

### 8.3 HR.js

**Trigger principal: `Events.E.DC_HEADER_DATA`** — a cada resposta AJAX do jogo. Esta é a detecção mais rápida de emergência de vinho.

```javascript
init() {
    this._events.on(Events.E.DC_HEADER_DATA, () => {
        const active = this._state.getCity(this._state.getActiveCityId());
        if (active) this._checkWineRisk(active);
    });
    this._events.on(Events.E.STATE_ALL_FRESH, () => {
        for (const city of this._state.getAllCities()) {
            this._checkWineRisk(city);
            this._checkWineLevel(city);
        }
    });
}

_checkWineRisk(city) {
    const wine        = city.resources.wine;
    const spendings   = city.production.wineSpendings;
    if (!spendings || spendings <= 0) return;

    const hoursLeft   = wine / spendings;
    const threshold   = this._config.get('wineEmergencyHours');

    if (hoursLeft < threshold) {
        this._events.emit(Events.E.HR_WINE_EMERGENCY, { cityId: city.id, hoursLeft });
        this._audit.warn('HR', `EMERGÊNCIA DE VINHO em ${city.name}: ${hoursLeft.toFixed(1)}h restantes`, { cityId: city.id });

        // Task de ajuste com prioridade 0 (urgente)
        if (!this._queue.hasPendingType('WINE_ADJUST', city.id)) {
            this._queue.add({
                type:         'WINE_ADJUST',
                priority:     0,
                cityId:       city.id,
                payload: {
                    wineLevel:     getMinWineLevel(spendings),
                    wineEmergency: true,
                },
                scheduledFor: Date.now(),
                reason:       `HR: Emergência — vinho esgota em ${hoursLeft.toFixed(1)}h`,
                module:       'HR',
                confidence:   'HIGH',
            });
        }

        // Se estoque crítico: disparar transporte de vinho (COO via evento)
        // O COO escuta HR_WINE_EMERGENCY e pode agendar transporte de vinho do hub
    }
}

_checkWineLevel(city) {
    const needed    = city.production.wineSpendings;
    const minLevel  = getMinWineLevel(needed);
    if (minLevel < 0) {
        this._audit.warn('HR', `Consumo de vinho (${needed}) supera capacidade máxima da taverna`, { cityId: city.id });
        return;
    }
    const current = city.tavern.wineLevel;
    if (current !== minLevel) {
        this._queue.add({
            type:         'WINE_ADJUST',
            priority:     20,
            cityId:       city.id,
            payload:      { wineLevel: minLevel },
            scheduledFor: Date.now(),
            reason:       `HR: Ajuste de vinho de nível ${current} → ${minLevel}`,
            module:       'HR',
            confidence:   this._state.getConfidence(city.id),
        });
    }
}

replan() {
    for (const city of this._state.getAllCities()) {
        this._checkWineRisk(city);
        this._checkWineLevel(city);
    }
}
```

### 8.4 CTO.js

**Triggers:**
- `Events.E.STATE_RESEARCH` — pesquisa atualizada
- `Events.E.STATE_ALL_FRESH` — verificar se academia precisa de científicos

```javascript
_getNextResearch() {
    const investigated = this._state.research?.investigated ?? new Set();
    // Prioridade: COST_REDUCERS não pesquisados, em ordem
    for (const id of COST_REDUCERS) {
        if (!investigated.has(id)) return id;
    }
    return null;
}

_checkAndQueue() {
    const research = this._state.research;
    if (!research) return;

    // Já tem pesquisa em progresso?
    if (research.inProgress) {
        const eta = research.inProgress.finishTs - this._state.getServerNow();
        this._audit.info('CTO', `Pesquisa em progresso — ETA: ${Math.round(eta/3600)}h`);
        return;
    }

    const next = this._getNextResearch();
    if (!next) {
        this._audit.info('CTO', 'Todos os redutores de custo pesquisados.');
        return;
    }

    this._queue.add({
        type:         'RESEARCH',
        priority:     30,
        cityId:       this._state.getAllCities().find(c => c.workers.scientists > 0)?.id ?? 0,
        payload:      { researchId: next },
        scheduledFor: Date.now(),
        reason:       `CTO: Iniciar pesquisa #${next} (redutor de custo)`,
        module:       'CTO',
        confidence:   'HIGH',
    });
}

replan() { this._checkAndQueue(); }
```

### 8.5 CSO.js

Mimetismo e proteção de capital. Não tem lógica de negócio própria — coordena CFO, COO e o TaskQueue.

**Responsabilidades:**
1. Monitorar capital em risco e acionar protocolo
2. NOISE: o scheduling está em TaskQueue (`_scheduleNoise`) — CSO apenas configura os parâmetros

```javascript
init() {
    this._events.on(Events.E.STATE_ALL_FRESH, () => {
        for (const city of this._state.getAllCities()) {
            this._checkCapitalRisk(city);
        }
    });
}

_checkCapitalRisk(city) {
    const warehouseLevel = city.buildings.find(b => b.buildingId === Buildings.WAREHOUSE)?.level ?? 0;
    const safe           = getWarehouseSafe(warehouseLevel);
    const atRisk         = Object.values(city.resources).reduce((sum, val) =>
        sum + Math.max(0, val - safe), 0);

    if (atRisk <= this._config.get('capitalRiskThreshold')) return;

    this._events.emit(Events.E.CSO_CAPITAL_RISK, { cityId: city.id, atRisk });
    this._audit.warn('CSO', `Capital em risco em ${city.name}: ${atRisk} unidades acima do safe`, { cityId: city.id });

    // Protocolo 1: antecipar upgrade que consome o recurso em risco
    // (via CFO.evaluateCity com boost de urgência — emitir evento para CFO)

    // Protocolo 2: push para hub (via COO)
    // O hub tem mais armazém e muralha — enviar excedente imediatamente
    // (implementar quando COO tiver método pushExcess)
}
```

### 8.6 MnA.js

```javascript
init() {
    this._events.on(Events.E.STATE_ALL_FRESH, () => this._detectNewCities());
}

async _detectNewCities() {
    const currentIds = new Set(this._state.getAllCityIds());
    const knownIds   = new Set(await this._storage.get('knownCityIds') ?? []);

    for (const id of currentIds) {
        if (!knownIds.has(id)) {
            this._audit.info('MnA', `Nova cidade detectada: ${id}`);
            this._handleNewCity(id);
        }
    }

    await this._storage.set('knownCityIds', [...currentIds]);
}

_handleNewCity(cityId) {
    // Prioridade absoluta: palaceColony até corruption = 0
    // CFO.evaluateCity já trata isso via buildingScore
    // Aqui: garantir que não há builds grandes na fila desta cidade
    this._audit.info('MnA', `Nova cidade ${cityId}: bloqueando builds grandes até corrupção = 0`);
}
```

---

## 9. Camada 5 — UI

### 9.1 UIBridge.js

```javascript
class UIBridge {
    constructor({ state, queue, audit, events, config }) {
        this._state  = state;
        this._queue  = queue;
        this._audit  = audit;
        this._events = events;
        this._config = config;
        this._alerts = [];
        this._rebuildTimer = null;
    }

    init() {
        // Rebuild no estado — com debounce para evitar cascata
        const schedRebuild = () => {
            clearTimeout(this._rebuildTimer);
            this._rebuildTimer = setTimeout(() => this._rebuild(), 100);
        };

        this._events.on(Events.E.STATE_CITY_UPDATED,  schedRebuild);
        this._events.on(Events.E.STATE_ALL_FRESH,     schedRebuild);
        this._events.on(Events.E.QUEUE_TASK_ADDED,    schedRebuild);
        this._events.on(Events.E.QUEUE_TASK_DONE,     schedRebuild);
        this._events.on(Events.E.QUEUE_TASK_FAILED,   schedRebuild);
        this._events.on(Events.E.QUEUE_MODE_CHANGED,  schedRebuild);

        // Alertas — imediatos, sem debounce
        this._events.on(Events.E.HR_WINE_EMERGENCY,  d  => this._addAlert('P0', 'HR', `Vinho crítico em cidade ${d.cityId}: ${d.hoursLeft?.toFixed(1)}h`, d.cityId));
        this._events.on(Events.E.CSO_CAPITAL_RISK,   d  => this._addAlert('P1', 'CSO', `Capital em risco em cidade ${d.cityId}`, d.cityId));
        this._events.on(Events.E.QUEUE_BLOCKED,      d  => this._addAlert('P1', 'Queue', d.reason, null));
        this._events.on(Events.E.QUEUE_TASK_FAILED,  d  => {
            if (d.fatal) this._addAlert('P1', 'Queue', `Task falhou (fatal): ${d.error}`, d.task?.cityId);
        });
    }

    _rebuild() {
        const uiState = this._buildUIState();
        this._events.emit(Events.E.UI_STATE_UPDATED, uiState);
    }

    _buildUIState() {
        // Construir UIState conforme contrato em UI_SPEC_ERP_REVISED.md seção 5
        const mode       = this._config.get('operationMode');
        const cities     = this._state.getAllCities();
        const allTasks   = this._queue.getAll();
        const nextAction = this._buildNextAction(allTasks);

        return {
            bot: {
                status:     this._calcBotStatus(),
                mode,
                confidence: this._calcGlobalConfidence(cities),
                lastSync:   this._state.lastFullRefresh,
                alertCount: this._alerts.filter(a => !a.resolved).length,
                activeCity: this._state.getActiveCityId(),
            },
            alerts:     [...this._alerts],
            nextAction,
            queue: {
                planned:   allTasks.filter(t => t.status === 'planned'),
                pending:   allTasks.filter(t => t.status === 'pending'),
                inFlight:  allTasks.filter(t => t.status === 'in-flight'),
                completed: allTasks.filter(t => t.status === 'done').slice(-20),
            },
            cities: cities.map(c => ({
                id:               c.id,
                name:             c.name,
                tradegood:        c.tradegood,
                health:           this._cityHealth(c),
                confidence:       this._state.getConfidence(c.id),
                dataAge:          Date.now() - c.fetchedAt,
                isActive:         c.id === this._state.getActiveCityId(),
                isCapital:        c.isCapital,
                goldPerHour:      c.economy.goldPerHour,
                underConstruction: this._state.getUnderConstruction(c.id) !== -1
                    ? { building: 'unknown', eta: null } // completar quando ETA disponível
                    : null,
            })),
            cityDetail: {}, // carregado sob demanda
            logs: this._audit.getEntries({ limit: 200 }),
        };
    }

    _addAlert(level, module, message, cityId) {
        const alert = {
            id:       nanoid(6),
            level,
            module,
            message,
            cityId:   cityId ?? null,
            ts:       Date.now(),
            resolved: false,
        };
        this._alerts.unshift(alert);
        if (this._alerts.length > 50) this._alerts.pop();
        this._events.emit(Events.E.UI_ALERT_ADDED, alert);
    }

    resolveAlert(alertId) {
        const a = this._alerts.find(a => a.id === alertId);
        if (a) { a.resolved = true; this._events.emit(Events.E.UI_ALERT_RESOLVED, { alertId }); }
    }

    _calcBotStatus() {
        if (this._queue.isPaused())        return 'PAUSED';
        if (this._alerts.some(a => !a.resolved && a.level === 'P0')) return 'DEGRADED';
        if (!this._state._ready)           return 'BLOCKED';
        return 'RUNNING';
    }

    _calcGlobalConfidence(cities) {
        const levels = cities.map(c => this._state.getConfidence(c.id));
        if (levels.every(l => l === 'HIGH'))   return 'HIGH';
        if (levels.some(l => l === 'LOW'))     return 'LOW';
        return 'MEDIUM';
    }

    _cityHealth(city) {
        if (this._state.getConfidence(city.id) === 'LOW') return 'red';
        if (city.economy.corruption > 0)                  return 'yellow';
        return 'green';
    }

    _buildNextAction(tasks) {
        const pending = tasks
            .filter(t => t.status === 'pending' && t.scheduledFor <= Date.now() + 300_000)
            .sort((a, b) => a.priority - b.priority)[0];
        if (!pending) return null;
        return {
            type:       pending.type,
            cityId:     pending.cityId,
            summary:    `${pending.type} — ${this._state.getCity(pending.cityId)?.name ?? pending.cityId}`,
            reason:     pending.reason,
            module:     pending.module,
            confidence: pending.confidence,
            eta:        pending.scheduledFor,
            blocker:    pending.status === 'blocked' ? pending.blockerReason ?? 'Bloqueado' : null,
        };
    }
}
```

### 9.2 Injeção do Painel (Shadow DOM)

O painel é injetado em `inject.js` como shadow DOM. `panel.js` é um módulo ES importado no mesmo contexto — compartilha `Events` diretamente.

```javascript
// Em inject.js (Camada 6)
async function createERPPanel() {
    // Criar container com shadow root
    const host = document.createElement('div');
    host.id    = 'ikariam-erp-panel';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    // Carregar HTML template (sem scripts — apenas estrutura)
    const htmlUrl = chrome.runtime.getURL('ui/panel.html');
    const cssUrl  = chrome.runtime.getURL('ui/panel.css');
    const html    = await fetch(htmlUrl).then(r => r.text());

    // Injetar CSS no shadow root
    const style   = document.createElement('link');
    style.rel     = 'stylesheet';
    style.href    = cssUrl;
    shadow.appendChild(style);

    // Injetar HTML
    const container = document.createElement('div');
    container.innerHTML = html;
    shadow.appendChild(container);

    return shadow;
}
```

`panel.js` recebe a referência ao shadow root e ao `Events` — opera diretamente:

```javascript
// panel.js — módulo ES, importado em inject.js
export function initPanel(shadowRoot, events, config) {
    // Escutar atualizações de estado
    events.on(Events.E.UI_STATE_UPDATED, (state) => render(shadowRoot, state));

    // Emitir comandos
    shadowRoot.querySelector('#btn-pause').addEventListener('click', () =>
        events.emit(Events.E.UI_COMMAND, { type: 'pause' })
    );
    // ... etc
}
```

### 9.3 Regras de panel.js

- Escuta apenas `Events.E.UI_STATE_UPDATED` — nunca acessa StateManager ou TaskQueue diretamente
- Render incremental: comparar valor antigo × novo antes de atualizar DOM
- Log virtualizado: renderizar apenas linhas visíveis (scroll virtual simples)
- `cityDetail` é carregado sob demanda ao abrir drawer — emite `ui:command { type: 'loadCityDetail', cityId }`

---

## 10. Camada 6 — Wiring Final (inject.js completo)

```javascript
// ═══ INTERCEPTOR — instalado antes de qualquer import (ver seção 4.3) ═══

import { Events }        from '../modules/Events.js';
import { Storage }       from '../modules/Storage.js';
import { Config }        from '../modules/Config.js';
import { Audit }         from '../modules/Audit.js';
import { DataCollector } from '../modules/DataCollector.js';
import { StateManager }  from '../modules/StateManager.js';
import { GameClient }    from '../modules/GameClient.js';
import { TaskQueue }     from '../modules/TaskQueue.js';
import { UIBridge }      from '../modules/UIBridge.js';
import { CFO }           from '../modules/CFO.js';
import { COO }           from '../modules/COO.js';
import { HR }            from '../modules/HR.js';
import { CTO }           from '../modules/CTO.js';
import { CSO }           from '../modules/CSO.js';
import { MnA }           from '../modules/MnA.js';
import { initPanel }     from '../ui/panel.js';

(async () => {
    // ── 1. Infraestrutura base ──────────────────────────────────
    const storage = new Storage();
    await storage.init();

    const config  = new Config(storage);
    await config.init();

    const audit   = new Audit({ storage, events: Events });
    await audit.init();

    // ── 2. Aquisição de dados ───────────────────────────────────
    const collector = new DataCollector({ events: Events, audit });
    collector.init(); // registra callback no interceptor + inicia model monitor

    const state = new StateManager({ events: Events, audit, config });
    state.init();

    // Aguardar primeiro model refresh antes de continuar
    await state.waitReady();
    audit.info('SYSTEM', 'StateManager ready — model carregado.');

    // ── 3. Execução ─────────────────────────────────────────────
    const client = new GameClient({ collector, config, audit });

    const queue  = new TaskQueue({ storage, client, state, config, audit, events: Events });
    await queue.init(); // restaura fila do Storage

    // ── 4. Módulos de negócio ───────────────────────────────────
    const cfo = new CFO({ state, queue, config, audit, events: Events });
    const coo = new COO({ state, queue, client, storage, config, audit, events: Events });
    const hr  = new HR({ state, queue, config, audit, events: Events });
    const cto = new CTO({ state, queue, config, audit, events: Events });
    const cso = new CSO({ state, queue, config, audit, events: Events });
    const mna = new MnA({ state, queue, storage, config, audit, events: Events });

    // Passar referência do CFO ao TaskQueue (para canAfford no guard)
    queue.setCFO(cfo);

    cfo.init(); coo.init(); hr.init(); cto.init(); cso.init(); mna.init();

    // ── 5. UI ───────────────────────────────────────────────────
    const bridge = new UIBridge({ state, queue, audit, events: Events, config });
    bridge.init();

    const shadow = await createERPPanel();
    initPanel(shadow, Events, config);

    // ── 6. Comandos da UI ───────────────────────────────────────
    Events.on(Events.E.UI_COMMAND, async (cmd) => {
        switch (cmd.type) {
            case 'pause':         queue.pause();                                     break;
            case 'resume':        queue.resume();                                    break;
            case 'refresh':       await state.fetchAllCities(client, state.getAllCityIds()); break;
            case 'replan':        cfo.replan(); coo.replan(); hr.replan(); cto.replan(); break;
            case 'safeMode':      await config.set('operationMode', cmd.enabled ? 'SAFE' : 'FULL-AUTO'); break;
            case 'setMode':       await config.set('operationMode', cmd.mode);       break;
            case 'cancelTask':    queue.cancel(cmd.taskId);                          break;
            case 'executeNow':    queue.executeNow(cmd.taskId);                      break;
            case 'approveTask':   queue.approve(cmd.taskId);                         break;
            case 'resolveAlert':  bridge.resolveAlert(cmd.alertId);                  break;
            case 'loadCityDetail': {
                // Carregar detalhe de cidade sob demanda e emitir
                const city = state.getCity(cmd.cityId);
                if (city) Events.emit('ui:cityDetail:loaded', { cityId: cmd.cityId, city });
                break;
            }
        }
    });

    // ── 7. Heartbeat de refresh de todas as cidades ─────────────
    const scheduleFullRefresh = () => {
        const interval = document.visibilityState === 'hidden'
            ? 3_600_000   // 1h em background
            : 900_000;    // 15min em foco
        setTimeout(async () => {
            await state.fetchAllCities(client, state.getAllCityIds());
            scheduleFullRefresh();
        }, interval);
    };
    scheduleFullRefresh();

    // ── 8. Iniciar executor da fila ─────────────────────────────
    queue.start();

    // ── 9. Avaliação inicial ────────────────────────────────────
    // Aguardar primeiro refresh completo para avaliar estado real
    Events.once(Events.E.STATE_ALL_FRESH, () => {
        cfo.replan();
        coo.replan();
        hr.replan();
        cto.replan();
    });

    // Disparar primeiro fetchAllCities
    state.fetchAllCities(client, state.getAllCityIds());

    audit.info('SYSTEM', 'ERP iniciado com sucesso.');
})();
```

---

## 11. Regras Transversais

### Timing
- Recursive `setTimeout` sempre. Nunca `setInterval`.
- Heartbeat em foco: 60s (TaskQueue tick). Refresh de cidades: 15min.
- Em background: tick 300s. Refresh de cidades: 60min.
- Entre requests no GameClient: `humanDelay(800, 2500)` via fila interna.

### Type safety — sempre ao ler do model/headerData
```javascript
const tradegood  = Number(headerData?.producedTradegood ?? 0);
const freeBoats  = Number(headerData?.freeTransporters  ?? 0);
const wineCost   = Number(headerData?.wineSpendings     ?? 0);
const cityId     = Number(relatedData?.selectedCityId   ?? 0);
```

### Guards obrigatórios antes de BUILD (em ordem)
1. `StateManager.getUnderConstruction(cityId) === -1`
2. `!city.lockedPositions.has(position)`
3. `StateManager.getActiveCityId() === cityId` — navegar se diferente
4. `CFO.canAfford(cityId, cost)`

### Payloads críticos
- `capacity: 5` e `max_capacity: 5` em transporte (nunca 500)
- `islandId` = ilha **destino** em transporte (não origem)
- `action: 'UpgradeExistingBuilding'` exato em build
- `currentCityId` deve ser a cidade ativa da sessão no momento do request

### Parsing de custos HTML
```javascript
li.querySelector('.accesshint')?.remove(); // OBRIGATÓRIO antes de textContent
const val = parseInt(li.textContent.trim().replace(/[.\s]/g, ''), 10);
```

### Erros do GameClient
| Tipo | Tratamento no TaskQueue |
|------|------------------------|
| `HTTP_ERROR` | Retry (transiente) |
| `GAME_ERROR` | Retry se < maxAttempts |
| `PARSE_ERROR` | Fatal — não retry |
| `GUARD` | Re-avaliar pré-condições — não conta como attempt |

---

## 12. Critérios de Prontidão por Camada

| Camada | Pronto quando |
|--------|--------------|
| 0 — Infra | Events, Storage, Config, Audit com testes unitários passando; Storage bridge confirmado via console em page context |
| 1 — Dados | Todas as funções de lookup retornam valores corretos contra dados conhecidos do jogo real |
| 2 — Aquisição | DataCollector captura `dc:headerData` com token correto a cada ação manual no jogo; StateManager mantém `resources` e `freeTransporters` atualizados; `waitReady()` resolve dentro de 3s após carregamento |
| 3 — Execução | GameClient envia payloads corretos verificados via Network tab; TaskQueue persiste, restaura após reload, executa em ordem, respeita guards, respeita OperationMode |
| 4 — Negócio | CFO aprova build com ROI correto e não duplica task; COO agenda JIT com ETA dentro de ±60s; HR detecta emergência de vinho em < 1 ciclo de headerData; CTO prioriza redutor de custo correto |
| 5 — UI | Painel abre sem erros, exibe estado real, alertas P0 persistem, pause/resume funciona, drawer de task mostra módulo + regra + bloqueador |
| 6 — Wiring | Sistema opera 30min sem: erro no console, ação duplicada, token expirado sem renovação, task stuck em in-flight |
