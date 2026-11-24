import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as protoLoader from '@grpc/proto-loader';
import { createProtoLoaderOptions } from '../src/grpc/protoLoaderOptions.js';

const grpcDirectory = fileURLToPath(new URL('../src/grpc/', import.meta.url));
const protoPath = join(grpcDirectory, 'soroban.proto');

function expectServiceDefinition(definition) {
  expect(definition['soroban_playground.SorobanService']).toBeDefined();
  expect(
    definition['soroban_playground.SorobanService'].Simulate
  ).toBeDefined();
}

describe('gRPC proto loader module interoperability', () => {
  it('loads the Soroban proto and its imports through Babel/CommonJS', () => {
    const options = createProtoLoaderOptions(grpcDirectory);

    expect(options).toEqual({
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [grpcDirectory, expect.any(String)],
    });
    expectServiceDefinition(protoLoader.loadSync(protoPath, options));
  });

  it('loads the Soroban proto in native ESM without a CommonJS require', () => {
    const moduleUrl = pathToFileURL(
      join(grpcDirectory, 'protoLoaderOptions.js')
    ).href;
    const loaderUrl = pathToFileURL(require.resolve('@grpc/proto-loader')).href;
    const script = `
      const { createProtoLoaderOptions } = await import(process.argv[1]);
      const { default: protoLoader } = await import(process.argv[2]);
      if (typeof require !== 'undefined') throw new Error('Expected native ESM');
      const definition = protoLoader.loadSync(
        process.argv[3],
        createProtoLoaderOptions(process.argv[4])
      );
      const service = definition['soroban_playground.SorobanService'];
      if (!service?.Simulate) throw new Error('Soroban service was not loaded');
      process.stdout.write('loaded');
    `;
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        script,
        moduleUrl,
        loaderUrl,
        protoPath,
        grpcDirectory,
      ],
      {
        cwd: dirname(protoPath),
        encoding: 'utf8',
        timeout: 15000,
      }
    );

    expect(output).toBe('loaded');
  });
});
