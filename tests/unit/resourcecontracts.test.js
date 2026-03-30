import {
    RESOURCE_KEYS,
    SERVER_RESOURCE_TO_KEY,
    RESOURCE_TO_CARGO_FIELD,
    TRADEGOOD_ORDINAL_TO_RESOURCE,
    createEmptyResources,
    createCargoPayload,
    createCargoPayloadFromResources,
} from '../../modules/resourceContracts.js';

describe('resourceContracts mappings', () => {
    test('RESOURCE_KEYS mantém ordem e conteúdo esperado', () => {
        expect(RESOURCE_KEYS).toEqual(['wood', 'wine', 'marble', 'glass', 'sulfur']);
    });

    test('SERVER_RESOURCE_TO_KEY mapeia headerData para chaves internas', () => {
        expect(SERVER_RESOURCE_TO_KEY).toEqual({
            resource: 'wood',
            '1': 'wine',
            '2': 'marble',
            '3': 'glass',
            '4': 'sulfur',
        });
    });

    test('TRADEGOOD_ORDINAL_TO_RESOURCE mapeia ordinais para recursos', () => {
        expect(TRADEGOOD_ORDINAL_TO_RESOURCE[1]).toBe('wine');
        expect(TRADEGOOD_ORDINAL_TO_RESOURCE[2]).toBe('marble');
        expect(TRADEGOOD_ORDINAL_TO_RESOURCE[3]).toBe('glass');
        expect(TRADEGOOD_ORDINAL_TO_RESOURCE[4]).toBe('sulfur');
    });

    test('RESOURCE_TO_CARGO_FIELD mapeia recursos para campos de payload', () => {
        expect(RESOURCE_TO_CARGO_FIELD).toEqual({
            wood: 'cargo_resource',
            wine: 'cargo_tradegood1',
            marble: 'cargo_tradegood2',
            glass: 'cargo_tradegood3',
            sulfur: 'cargo_tradegood4',
        });
    });
});

describe('resourceContracts factories', () => {
    test('createEmptyResources cria shape padrão zerado', () => {
        expect(createEmptyResources()).toEqual({
            wood: 0,
            wine: 0,
            marble: 0,
            glass: 0,
            sulfur: 0,
        });
    });

    test('createCargoPayload cria payload com um único recurso', () => {
        expect(createCargoPayload('marble', 750)).toEqual({
            cargo_resource: 0,
            cargo_tradegood1: 0,
            cargo_tradegood2: 750,
            cargo_tradegood3: 0,
            cargo_tradegood4: 0,
        });
    });

    test('createCargoPayload retorna null para recurso inválido', () => {
        expect(createCargoPayload('invalid', 100)).toBeNull();
    });

    test('createCargoPayloadFromResources converte objeto cargo completo', () => {
        expect(createCargoPayloadFromResources({ wood: 100, sulfur: 250 })).toEqual({
            cargo_resource: 100,
            cargo_tradegood1: 0,
            cargo_tradegood2: 0,
            cargo_tradegood3: 0,
            cargo_tradegood4: 250,
        });
    });
});

