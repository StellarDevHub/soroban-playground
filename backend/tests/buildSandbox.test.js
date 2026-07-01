import path from 'path';
import {
  assertSandboxedOutputPath,
  createBuildSandboxPaths,
  createSandboxEnv,
} from '../src/services/buildSandbox.js';

describe('buildSandbox', () => {
  it('creates fully isolated build paths per workspace', () => {
    const sandbox = createBuildSandboxPaths('/tmp/soroban-compile-a1');

    expect(sandbox.workspaceDir).toBe('/tmp/soroban-compile-a1');
    expect(sandbox.crateRoot).toBe(path.join('/tmp/soroban-compile-a1', 'crate'));
    expect(sandbox.cargoHome).toBe(
      path.join('/tmp/soroban-compile-a1', 'cargo-home')
    );
    expect(sandbox.cargoTargetDir).toBe(path.join('/tmp/soroban-compile-a1', 'target'));
    expect(sandbox.wasmOutPath).toContain(
      path.join('wasm32-unknown-unknown', 'release', 'soroban_contract.wasm')
    );
  });

  it('builds a sanitized environment and strips dangerous overrides', () => {
    const sandbox = createBuildSandboxPaths('/tmp/soroban-compile-a2');
    const env = createSandboxEnv(
      {
        PATH: '/usr/bin',
        HOME: '/home/test',
        SECRET_KEY: 'do-not-leak',
        RUSTFLAGS: '-C target-cpu=native',
        LD_PRELOAD: '/tmp/payload.so',
      },
      sandbox
    );

    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/test');
    expect(env.CARGO_HOME).toBe(sandbox.cargoHome);
    expect(env.CARGO_TARGET_DIR).toBe(sandbox.cargoTargetDir);
    expect(env.RUST_MIN_STACK).toBe('268435456');
    expect(env.SECRET_KEY).toBeUndefined();
    expect(env.RUSTFLAGS).toBeUndefined();
    expect(env.LD_PRELOAD).toBeUndefined();
  });

  it('accepts outputs inside sandbox and rejects escaped paths', () => {
    const sandbox = createBuildSandboxPaths('/tmp/soroban-compile-a3');

    expect(() => assertSandboxedOutputPath(sandbox, sandbox.wasmOutPath)).not.toThrow();
    expect(() =>
      assertSandboxedOutputPath(sandbox, '/tmp/soroban-compile-a3-escape/out.wasm')
    ).toThrow('Build output path escaped compile sandbox');
  });
});
