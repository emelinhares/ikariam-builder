// resourceContracts.js — contratos compartilhados para recursos e transporte

import { TradeGoodOrdinals } from '../data/const.js';

export const RESOURCE_KEYS = Object.freeze(['wood', 'wine', 'marble', 'glass', 'sulfur']);

export const SERVER_RESOURCE_TO_KEY = Object.freeze({
    resource: 'wood',
    '1': 'wine',
    '2': 'marble',
    '3': 'glass',
    '4': 'sulfur',
});

export const RESOURCE_TO_CARGO_FIELD = Object.freeze({
    wood: 'cargo_resource',
    wine: 'cargo_tradegood1',
    marble: 'cargo_tradegood2',
    glass: 'cargo_tradegood3',
    sulfur: 'cargo_tradegood4',
});

export const TRADEGOOD_ORDINAL_TO_RESOURCE = Object.freeze(
    Object.entries(TradeGoodOrdinals).reduce((acc, [name, ordinal]) => {
        if (!(ordinal in acc)) {
            acc[ordinal] = name.toLowerCase();
        }
        return acc;
    }, {})
);

export function createEmptyResources() {
    return { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 };
}

export function createCargoPayload(resource, amount) {
    const field = RESOURCE_TO_CARGO_FIELD[resource];
    if (!field) return null;

    return {
        cargo_resource: field === 'cargo_resource' ? amount : 0,
        cargo_tradegood1: field === 'cargo_tradegood1' ? amount : 0,
        cargo_tradegood2: field === 'cargo_tradegood2' ? amount : 0,
        cargo_tradegood3: field === 'cargo_tradegood3' ? amount : 0,
        cargo_tradegood4: field === 'cargo_tradegood4' ? amount : 0,
    };
}

export function createCargoPayloadFromResources(cargo = {}) {
    const payload = {
        cargo_resource: 0,
        cargo_tradegood1: 0,
        cargo_tradegood2: 0,
        cargo_tradegood3: 0,
        cargo_tradegood4: 0,
    };

    for (const [resource, amount] of Object.entries(cargo)) {
        const field = RESOURCE_TO_CARGO_FIELD[resource];
        if (!field) continue;
        payload[field] = Number(amount) || 0;
    }

    return payload;
}

