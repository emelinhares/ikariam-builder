# ADR 0001 — Interceptor síncrono antes dos imports

## Contexto

O projeto depende de captura precoce de XHR/fetch para alimentar estado e decisões.

Base observada em [inject/inject.js](../../inject/inject.js):2 e [content/content.js](../../content/content.js):1.

## Decisão

Instalar interceptor no topo de [inject/inject.js](../../inject/inject.js):29, antes de imports ESM.

## Consequência

- Menor chance de perder responses iniciais.
- [modules/DataCollector.js](../../modules/DataCollector.js):40 recebe mais sinais no início da sessão.

## Risco se for alterado

Mover interceptor para depois dos imports pode degradar captura e gerar estado incompleto em [modules/StateManager.js](../../modules/StateManager.js):19.

