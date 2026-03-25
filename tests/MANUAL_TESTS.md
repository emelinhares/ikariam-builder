# Checklist de Testes Manuais — Ikariam Builder v5.0

Execute estes testes no Chrome com a extensão carregada em modo desenvolvedor.

---

## SETUP

```
chrome://extensions → Modo desenvolvedor → Carregar sem compactação → selecionar pasta ikariam-builder
```

---

## 1. CARGA DA EXTENSÃO

| # | Teste | Esperado | Status |
|---|-------|----------|--------|
| 1.1 | Abrir `chrome://extensions` | Extensão aparece sem erros | ☐ |
| 1.2 | Clicar em "Erros" (se visível) | Nenhum erro de sintaxe/import | ☐ |
| 1.3 | Acessar jogo (ikariam.gameforge.com) | `content.js` injeta `inject.js` | ☐ |
| 1.4 | Console do DevTools (F12) | Sem erros de módulo ESM | ☐ |
| 1.5 | Botão "IB" aparece na página | Canto superior direito, z-index alto | ☐ |

---

## 2. BOOT SEQUENCE (inject.js)

| # | Teste | Esperado | Status |
|---|-------|----------|--------|
| 2.1 | Console após carga | `[Builder] Pronto.` ou similar | ☐ |
| 2.2 | `window.__IA_BUILDER_INIT__` | `true` no console | ☐ |
| 2.3 | Recarregar página duas vezes | Guard evita dupla inicialização | ☐ |
| 2.4 | Game.isReady() | Retorna `true` após boot | ☐ |

---

## 3. STORAGE (Storage.js)

| # | Teste | Esperado | Status |
|---|-------|----------|--------|
| 3.1 | `await Storage.set('test', 42)` no console | Sem erros | ☐ |
| 3.2 | `await Storage.get('test')` | Retorna `42` | ☐ |
| 3.3 | Recarregar página → `await Storage.get('test')` | Ainda retorna `42` (persistência) | ☐ |
| 3.4 | `Storage.remove('test')` → `Storage.get('test')` | Retorna `null` | ☐ |
| 3.5 | Verificar prefixo: `chrome://extensions` → Service Worker | Chave começa com `IA_` | ☐ |

---

## 4. REDE (Builder.js — interceptor XHR/fetch)

| # | Teste | Esperado | Status |
|---|-------|----------|--------|
| 4.1 | Navegar entre cidades no jogo | Console: `[Builder] city:changed` ou evento emitido | ☐ |
| 4.2 | Qualquer ação no jogo (clicar edifício) | `Events.emit('network:response', ...)` disparado | ☐ |
| 4.3 | `ResourceCache.getAll()` após navegar | Array com dados da cidade atual | ☐ |
| 4.4 | Token CSRF atualizado: `Game.getToken()` | Token não-vazio após resposta XHR | ☐ |

---

## 5. DADOS DO JOGO (Game.js)

| # | Teste | Esperado | Status |
|---|-------|----------|--------|
| 5.1 | `Game.getCityId()` no console | ID da cidade atual (número) | ☐ |
| 5.2 | `Game.getCities()` | Array de cidades próprias | ☐ |
| 5.3 | `Game.getResources(Game.getCityId())` | Objeto `{wood, wine, marble, glass, sulfur}` | ☐ |
| 5.4 | `Game.getBuildingLevel(Game.getCityId(), 'townHall')` | Nível atual da prefeitura | ☐ |
| 5.5 | `Game.getServerTime()` | Timestamp Unix próximo a `Date.now()/1000` | ☐ |
| 5.6 | `Game.fetchCosts(cityId, position)` | Objeto de custos sem NaN (`.accesshint` removido) | ☐ |

---

## 6. RESOURCE CACHE (ResourceCache.js)

| # | Teste | Esperado | Status |
|---|-------|----------|--------|
| 6.1 | `ResourceCache.get(Game.getCityId())` | Objeto com resources, production, updatedAt | ☐ |
| 6.2 | `ResourceCache.getFreeTransporters(cityId)` | Número ≥ 0 (vem do headerData, não model) | ☐ |
| 6.3 | `ResourceCache.projectResources(cityId, Date.now()/1000 + 3600)` | Recursos +1h de produção | ☐ |
| 6.4 | `ResourceCache.hoursUntilResources(cityId, {wood: 10000})` | Número de horas ou Infinity | ☐ |
| 6.5 | `ResourceCache.fetchAll()` | Popula todas as cidades sem crash (400ms delay) | ☐ |

---

## 7. PAINEL UI (panel.js)

| # | Teste | Esperado | Status |
|---|-------|----------|--------|
| 7.1 | Clicar botão "IB" | Painel abre com 5 abas | ☐ |
| 7.2 | Aba Dashboard | Cards das cidades com recursos visíveis | ☐ |
| 7.3 | Aba Metas | Lista de metas (vazia inicialmente) | ☐ |
| 7.4 | Aba Porto | Fila vazia inicialmente | ☐ |
| 7.5 | Aba Config | Toggles e campos de configuração | ☐ |
| 7.6 | Aba Log | Log vazio inicialmente | ☐ |
| 7.7 | Fechar e reabrir painel | Estado da aba ativa é preservado | ☐ |
| 7.8 | Clicar "IB" novamente | Painel fecha | ☐ |

---

## 8. WINE BALANCE (WineBalance.js)

| # | Teste | Esperado | Status |
|---|-------|----------|--------|
| 8.1 | Ativar WineBalance na config | Toggle fica ativo | ☐ |
| 8.2 | `WineBalance.statusOf(cityId)` | `{hoursLeft, critical, low, needed}` correto | ☐ |
| 8.3 | `WineBalance.allStatuses()` | Array com status de todas as cidades (exceto fonte) | ☐ |
| 8.4 | Cidade com vinho < 6h → `WineBalance.check()` | Port recebe tarefa `wine_critical` | ☐ |
| 8.5 | `WineBalance.getSourceCity()` | Cidade com maior produção de vinho | ☐ |

---

## 9. PORT (Port.js)

| # | Teste | Esperado | Status |
|---|-------|----------|--------|
| 9.1 | `Port.enqueue([{type:'wine', ...}])` | Tarefa na fila | ☐ |
| 9.2 | Inspecionar request real com DevTools Network | `capacity=5`, `max_capacity=5` no body | ☐ |
| 9.3 | `islandId` no request | ID da ilha DESTINO (não origem) | ☐ |
| 9.4 | `currentCityId` no request | ID da cidade ORIGEM (após navegação) | ☐ |
| 9.5 | Fila com goal + wine → `Port.getQueue()[0].type` | `'goal'` (maior prioridade) | ☐ |
| 9.6 | Envio real (monitorar Network) | Request para `/index.php` com action=transportOperations | ☐ |
| 9.7 | Delay entre envios | 4-7 segundos entre shipments (observar no console) | ☐ |

---

## 10. GOALS / PATROL (Goals.js + Patrol.js)

| # | Teste | Esperado | Status |
|---|-------|----------|--------|
| 10.1 | Adicionar meta via UI (Aba Metas) | Meta aparece na lista | ☐ |
| 10.2 | Ativar meta + iniciar Patrol | Console: `[Patrol] Visitando cidade X` | ☐ |
| 10.3 | Meta com recursos locais disponíveis | Construção iniciada via AJAX | ☐ |
| 10.4 | Meta com recursos insuficientes (< 4h local) | Patrol agendado para exato momento | ☐ |
| 10.5 | Meta com recursos > 4h de produção | Transporte solicitado ao Port | ☐ |
| 10.6 | `Patrol.getSchedule()` | Map com próximos checks por cidade | ☐ |
| 10.7 | Parar Patrol → `Patrol.isActive()` | `false` | ☐ |

---

## 11. AUDIT / LOG (Audit.js)

| # | Teste | Esperado | Status |
|---|-------|----------|--------|
| 11.1 | Aba Log após algumas ações | Entradas com timestamp, tipo e mensagem | ☐ |
| 11.2 | `Audit.getStats()` | `{transportsAvoided, goldSaved, xhrSyncs, heartbeats}` | ☐ |
| 11.3 | 200+ ações → `Audit.getLog()` | Máximo 200 entradas (circular) | ☐ |
| 11.4 | Clicar "Limpar Log" na UI | Log vazio, stats preservados | ☐ |

---

## 12. ARMADILHAS CRÍTICAS (Spec — revisão obrigatória)

| # | Armadilha | Como verificar | Status |
|---|-----------|----------------|--------|
| A1 | `capacity: 5` (nunca 500) | DevTools Network → inspecionar body do POST | ☐ |
| A2 | `islandId` = ilha destino | Comparar ID da ilha destino com valor no request | ☐ |
| A3 | `freeTransporters` vem do `headerData` | `ResourceCache.get(id).freeTransporters` bate com UI do jogo | ☐ |
| A4 | `fetchCosts` sem `.accesshint` | `Game.fetchCosts(...)` retorna números, não NaN | ☐ |
| A5 | `currentCityId` = cidade atual da sessão | Navegar manualmente e verificar no request | ☐ |
| A6 | `getServerTime` offset correto | `Game.getServerTime()` bate com horário do servidor | ☐ |
| A7 | Loop 250ms (não 50ms) | `Builder.DETECTION_INTERVAL_MS` = 250 | ☐ |
| A8 | setTimeout recursivo (não setInterval) | Revisar código: sem `setInterval` em Builder.js | ☐ |

---

## 13. PERSISTÊNCIA APÓS RELOAD

| # | Teste | Esperado | Status |
|---|-------|----------|--------|
| 13.1 | Adicionar metas → recarregar página | Metas preservadas | ☐ |
| 13.2 | Port com fila ativa → recarregar | `port_running=true` → Builder retoma runPort() | ☐ |
| 13.3 | Patrol ativo → recarregar | Patrol retoma com schedule correto | ☐ |
| 13.4 | Configurações de WineBalance → recarregar | Configurações preservadas | ☐ |

---

## RESULTADO FINAL

- Total de testes: __
- Aprovados: __
- Reprovados: __
- Pendentes: __

Bugs encontrados:
- [ ] _nenhum_
