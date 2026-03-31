# Contratos de Recursos e Payload de Transporte

## Fonte

- [modules/resourceContracts.js](../../modules/resourceContracts.js)
- Uso operacional em [modules/GameClient.js](../../modules/GameClient.js)

## Recursos canônicos (CONFIRMADO)

- `wood`
- `wine`
- `marble`
- `glass`
- `sulfur`

## Mapeamento servidor -> chave interna (CONFIRMADO)

- `resource` -> `wood`
- `'1'` -> `wine`
- `'2'` -> `marble`
- `'3'` -> `glass`
- `'4'` -> `sulfur`

## Mapeamento recurso -> campo de payload de carga (CONFIRMADO)

- `wood` -> `cargo_resource`
- `wine` -> `cargo_tradegood1`
- `marble` -> `cargo_tradegood2`
- `glass` -> `cargo_tradegood3`
- `sulfur` -> `cargo_tradegood4`

## Shape base de recursos (CONFIRMADO)

Gerado por `createEmptyResources()` em [modules/resourceContracts.js](../../modules/resourceContracts.js):

```js
{ wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 }
```

## Payload de transporte (SINAL FORTE)

`createCargoPayloadFromResources(cargo)` produz:

```js
{
  cargo_resource: number,
  cargo_tradegood1: number,
  cargo_tradegood2: number,
  cargo_tradegood3: number,
  cargo_tradegood4: number
}
```

Este shape é consumido em [modules/GameClient.js](../../modules/GameClient.js), método `sendTransport()`.

## Evidência de validação

- Testes em [tests/unit/resourcecontracts.test.js](../../tests/unit/resourcecontracts.test.js).

## LACUNA

- Não há contrato formal para limites de payload (ex.: máximo por recurso) além da lógica de barcos/capacidade no fluxo de transporte.

