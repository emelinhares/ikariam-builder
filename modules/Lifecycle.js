// Lifecycle.js — shutdown coordenado de módulos
// Executa cleanup em ordem reversa de registro (LIFO),
// para desmontar dependências na ordem segura.

export class Lifecycle {
    constructor({ audit } = {}) {
        this._audit = audit ?? null;
        this._components = [];
        this._stopped = false;
    }

    register(name, component) {
        if (!name || !component) return;
        this._components.push({ name, component });
    }

    shutdown(reason = 'shutdown') {
        if (this._stopped) return;
        this._stopped = true;

        const stack = [...this._components].reverse();
        for (const { name, component } of stack) {
            if (typeof component?.shutdown !== 'function') continue;
            try {
                component.shutdown(reason);
                this._audit?.debug?.('Lifecycle', `shutdown ok: ${name}`);
            } catch (err) {
                this._audit?.warn?.('Lifecycle', `shutdown fail: ${name} (${err?.message ?? err})`);
            }
        }
        this._components = [];
    }
}

