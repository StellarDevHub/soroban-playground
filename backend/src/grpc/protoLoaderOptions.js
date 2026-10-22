import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
const protoLoaderDirectory = dirname(require.resolve('@grpc/proto-loader'));
const protobufDirectory = dirname(
  require.resolve('protobufjs', { paths: [protoLoaderDirectory] })
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
