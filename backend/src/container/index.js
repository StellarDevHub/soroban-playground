// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

export const Lifecycle = Object.freeze({
  SINGLETON: 'singleton',
  TRANSIENT: 'transient',
  SCOPED: 'scoped',
});

export class Container {
  #registrations = new Map();
  #singletons = new Map();

  // Register a named dependency with a factory function and lifecycle.
  register(name, factory, { lifecycle = Lifecycle.SINGLETON } = {}) {
    if (typeof factory !== 'function') {
      throw new TypeError(`Factory for "${name}" must be a function`);
    }
    if (this.#registrations.has(name)) {
      throw new Error(`"${name}" is already registered in the container`);
    }
    this.#registrations.set(name, { factory, lifecycle });
    return this;
  }

  // Resolve a named dependency, honouring the registered lifecycle.
  resolve(name, scopeInstances = null) {
    const reg = this.#registrations.get(name);
    if (!reg) {
      throw new Error(`"${name}" is not registered in the container`);
    }

    const { factory, lifecycle } = reg;

    if (lifecycle === Lifecycle.SINGLETON) {
      if (!this.#singletons.has(name)) {
        this.#singletons.set(name, factory(this));
      }
      return this.#singletons.get(name);
    }

    if (lifecycle === Lifecycle.SCOPED) {
      if (!scopeInstances) {
        throw new Error(
          `"${name}" is scoped but resolve() was called outside an active scope`
        );
      }
      if (!scopeInstances.has(name)) {
        scopeInstances.set(name, factory(this));
      }
      return scopeInstances.get(name);
    }

    // TRANSIENT — fresh instance every time
    return factory(this);
  }

  // Create a child scope. Scoped registrations produce one instance per scope.
  createScope() {
    const scopeInstances = new Map();
    return {
      resolve: (name) => this.resolve(name, scopeInstances),
      dispose: () => scopeInstances.clear(),
    };
  }

  // Express middleware that attaches a per-request scope to req.scope.
  requestScopeMiddleware() {
    return (req, _res, next) => {
      req.scope = this.createScope();
      next();
    };
  }

  has(name) {
    return this.#registrations.has(name);
  }

  names() {
    return [...this.#registrations.keys()];
  }

  // Override an existing registration — useful in tests to inject mocks.
  override(name, factory, options = {}) {
    this.#registrations.delete(name);
    this.#singletons.delete(name);
    return this.register(name, factory, options);
  }
}

// Application-level singleton container instance
export const container = new Container();
