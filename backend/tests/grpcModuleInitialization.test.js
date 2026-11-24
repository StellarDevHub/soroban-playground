import { EventEmitter } from 'node:events';

// Isolate application services while exercising real gRPC proto initialization.
jest.mock('../src/grpc/sorobanService.js', () => ({
  authenticateGrpcCall: jest.fn(),
  createSorobanServiceHandlers: jest.fn(),
  sorobanServiceDefinition: {},
  toGrpcError: jest.fn(),
}));

import { grpcEventBus, startGrpcServer } from '../src/grpc/server.js';
import { GrpcClient } from '../src/grpc/client.js';

describe('gRPC module initialization through Babel/CommonJS', () => {
  it('loads the server and client proto definitions without filename shadowing', () => {
    expect(grpcEventBus).toBeInstanceOf(EventEmitter);
    expect(startGrpcServer).toEqual(expect.any(Function));
    expect(GrpcClient).toEqual(expect.any(Function));
  });
});
