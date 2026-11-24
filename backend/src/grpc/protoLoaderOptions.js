import { createRequire } from 'node:module';
import { dirname } from 'node:path';

// Preserve CommonJS require when Babel transforms this module for Jest.
const resolveRequire =
  typeof require !== 'undefined' ? require : createRequire(import.meta.url);
const protoLoaderDirectory = dirname(
  resolveRequire.resolve('@grpc/proto-loader')
);
const protobufDirectory = dirname(
  resolveRequire.resolve('protobufjs', { paths: [protoLoaderDirectory] })
);

export function createProtoLoaderOptions(localDirectory) {
  return {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [localDirectory, protobufDirectory],
  };
}
