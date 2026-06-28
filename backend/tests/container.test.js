import { Container, Lifecycle } from '../src/container/index.js';

describe('Container – registration', () => {
  it('registers and resolves a singleton', () => {
    const c = new Container();
    c.register('greeter', () => ({ greet: () => 'hello' }));

    const a = c.resolve('greeter');
    const b = c.resolve('greeter');

    expect(a).toBe(b); // same instance
    expect(a.greet()).toBe('hello');
  });

  it('throws when resolving an unregistered name', () => {
    const c = new Container();
    expect(() => c.resolve('missing')).toThrow(/"missing" is not registered/);
  });

  it('throws on duplicate registration', () => {
    const c = new Container();
    c.register('svc', () => ({}));
    expect(() => c.register('svc', () => ({}))).toThrow(
      /"svc" is already registered/
    );
  });

  it('throws when factory is not a function', () => {
    const c = new Container();
    expect(() => c.register('bad', 'not-a-function')).toThrow(TypeError);
  });
});

describe('Container – lifecycles', () => {
  it('SINGLETON returns the same instance across resolves', () => {
    const c = new Container();
    let calls = 0;
    c.register('db', () => ({ id: ++calls }), { lifecycle: Lifecycle.SINGLETON });

    expect(c.resolve('db').id).toBe(1);
    expect(c.resolve('db').id).toBe(1); // still 1
  });

  it('TRANSIENT returns a new instance on each resolve', () => {
    const c = new Container();
    let calls = 0;
    c.register('logger', () => ({ id: ++calls }), {
      lifecycle: Lifecycle.TRANSIENT,
    });

    expect(c.resolve('logger').id).toBe(1);
    expect(c.resolve('logger').id).toBe(2);
    expect(c.resolve('logger').id).toBe(3);
  });

  it('SCOPED returns the same instance within a scope', () => {
    const c = new Container();
    let calls = 0;
    c.register('repo', () => ({ id: ++calls }), {
      lifecycle: Lifecycle.SCOPED,
    });

    const scope = c.createScope();
    const a = scope.resolve('repo');
    const b = scope.resolve('repo');
    expect(a).toBe(b); // same within scope
    expect(a.id).toBe(1);
  });

  it('SCOPED creates distinct instances across different scopes', () => {
    const c = new Container();
    let calls = 0;
    c.register('repo', () => ({ id: ++calls }), {
      lifecycle: Lifecycle.SCOPED,
    });

    const scope1 = c.createScope();
    const scope2 = c.createScope();
    expect(scope1.resolve('repo').id).toBe(1);
    expect(scope2.resolve('repo').id).toBe(2);
  });

  it('SCOPED throws when resolved outside a scope', () => {
    const c = new Container();
    c.register('scoped', () => ({}), { lifecycle: Lifecycle.SCOPED });
    expect(() => c.resolve('scoped')).toThrow(/scoped but resolve\(\) was called outside/);
  });
});

describe('Container – dependency graph', () => {
  it('injects dependencies via the container argument to the factory', () => {
    const c = new Container();
    c.register('config', () => ({ dsn: 'sqlite://test.db' }));
    c.register('db', (ctr) => ({ dsn: ctr.resolve('config').dsn }));

    expect(c.resolve('db').dsn).toBe('sqlite://test.db');
  });

  it('supports multi-level dependency chains', () => {
    const c = new Container();
    c.register('a', () => 'A');
    c.register('b', (ctr) => `B(${ctr.resolve('a')})`);
    c.register('c', (ctr) => `C(${ctr.resolve('b')})`);

    expect(c.resolve('c')).toBe('C(B(A))');
  });
});

describe('Container – utilities', () => {
  it('has() reports registration status', () => {
    const c = new Container();
    c.register('x', () => ({}));
    expect(c.has('x')).toBe(true);
    expect(c.has('y')).toBe(false);
  });

  it('names() lists all registered names', () => {
    const c = new Container();
    c.register('a', () => ({}));
    c.register('b', () => ({}));
    expect(c.names()).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('override() replaces an existing registration (useful for mocking)', () => {
    const c = new Container();
    c.register('mailer', () => ({ send: () => 'real' }));

    c.override('mailer', () => ({ send: () => 'mock' }));

    expect(c.resolve('mailer').send()).toBe('mock');
  });
});

describe('Container – scope disposal', () => {
  it('dispose() clears scoped instances', () => {
    const c = new Container();
    let calls = 0;
    c.register('conn', () => ({ id: ++calls }), { lifecycle: Lifecycle.SCOPED });

    const scope = c.createScope();
    expect(scope.resolve('conn').id).toBe(1);
    scope.dispose();
    expect(scope.resolve('conn').id).toBe(2); // new instance after dispose
  });
});
