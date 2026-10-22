// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
//
// gRPC module index — re-exports the public API.

export { startGrpcServer, shutdownGrpcServer, grpcEventBus } from './server.js';
export { GrpcClient } from './client.js';
export { ServiceRegistry, serviceRegistry } from './serviceRegistry.js';
export {
  buildGrpcOpenApiSpec,
  createSorobanGrpcClient,
  mountGrpcGateway,
} from './gateway.ts';
