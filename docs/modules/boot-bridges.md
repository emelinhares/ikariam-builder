# Módulo: Boot e Bridges da Extensão

## Objetivo

Subir o ERP no page context e conectar APIs da extensão (storage/notificação) ao código injetado.

## Arquivos envolvidos

- [content/content.js](../../content/content.js)
- [inject/inject.js](../../inject/inject.js)
- [background/background.js](../../background/background.js)
- [manifest.json](../../manifest.json)

## Ponto de entrada

- `content_scripts` em [manifest.json](../../manifest.json), com `run_at=document_start`.

## Inputs

- Mensagens `window.postMessage` (`__erpBridge`, `__erpNotify`).
- Permissões de extensão (`storage`, `notifications`).

## Outputs

- Injeção de [inject/inject.js](../../inject/inject.js) no contexto da página.
- Bridge de operações de storage (`get/set/remove/getAll`).
- Encaminhamento de notificações para o service worker.

## Dependências diretas

- API `chrome.runtime` e `chrome.storage.local`.

## Efeitos colaterais

- Qualquer mudança de protocolo de mensagem impacta [modules/Storage.js](../../modules/Storage.js) indiretamente.

## Erros comuns

- Mudar `dataset.extUrl` e quebrar carga de [ui/panel.js](../../ui/panel.js).
- Alterar filtro de mensagens e bloquear storage bridge.

## Riscos

- Alto: sem bridge funcional, configuração e persistência deixam de funcionar.

## Caminhos típicos de alteração

- Ajustar protocolo bridge: [content/content.js](../../content/content.js) + validação em [inject/inject.js](../../inject/inject.js).
- Ajustar permissões: [manifest.json](../../manifest.json) + smoke de notificações em [background/background.js](../../background/background.js).

## O que NÃO pertence a este módulo

- Lógica de decisão de negócios.
- Execução de tasks da fila.

