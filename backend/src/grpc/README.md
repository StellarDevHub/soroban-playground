# gRPC Inter-Service Communication Layer

## Issue #1294 — Microservice Service Discovery & gRPC Inter-Service Communication

This document describes the gRPC communication layer in `backend/src/grpc/`.

---

## Architecture

```
┌─────────────────────────────┐        gRPC (port 50051)        ┌──────────────────────────────┐
│   Express Backend (Node.js) │ ◄──────────────────────────────► │   Rust Indexer               │
│   backend/src/grpc/         │                                   │   indexer/src/               │
│   • server.js               │                                   │   • main.rs                  │
│   • client.js               │                                   │   • graphql/                 │
│   • serviceRegistry.js      │                                   │   • db/                      │
└─────────────────────────────┘                                   └──────────────────────────────┘
```

---

## Files

| File                    | Purpose                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `soroban_indexer.proto` | Protocol Buffer definitions for the `IndexerService`                                                                   |
| `soroban.proto`         | Canonical Soroban compile, simulate, deploy, and compile-stream contracts with HTTP annotations                       |
| `server.js`             | gRPC server — implements `IndexerService` handlers and exposes `grpcEventBus`                                           |
| `sorobanService.js`     | Authenticated compile, simulate, deploy, and bidirectional compile-stream handlers                                       |
| `gateway.ts`            | REST-to-gRPC proxy and OpenAPI 3.1 generator driven by `soroban.proto` HTTP annotations                                  |
| `client.js`             | `GrpcClient` — promise-wrapped stub with exponential-backoff retry                                                      |
| `serviceRegistry.js`    | `ServiceRegistry` — health-polling, round-robin load balancing, TTL eviction                                            |
| `index.js`              | Re-exports the gRPC server, Soroban client, REST gateway, and service registry APIs |

---

## Proto Service Definition

```protobuf
service IndexerService {
  rpc StreamEvents(EventStreamRequest)   returns (stream EventStreamResponse);
  rpc GetCompileStatus(CompileStatusRequest) returns (CompileStatusResponse);
  rpc Deploy(DeployRequest)              returns (DeployResponse);
  rpc HealthCheck(HealthRequest)         returns (HealthResponse);
}
```

---

## Integration

### Starting the gRPC server alongside Express

```js
// backend/src/server.js
import { startGrpcServer } from './grpc/index.js';

const compileJobStore = new Map();
const deployJobStore = new Map();

await startGrpcServer(compileJobStore, deployJobStore, {
  host: '127.0.0.1',
  port: Number(process.env.GRPC_PORT ?? 50051),
});
```

### Publishing a contract event to connected gRPC clients

```js
import { grpcEventBus } from './grpc/index.js';

grpcEventBus.emit('contract_event', {
  contract_id: 'C...',
  event_type: 'transfer',
  ledger_seq: '1234567',
  timestamp: Math.floor(Date.now() / 1000),
  payload_json: JSON.stringify({ from, to, amount }),
});
```

### Consuming the event stream from a client

```js
import { GrpcClient } from './grpc/index.js';

const client = new GrpcClient({ host: 'localhost', port: 50051 });
const stream = client.streamEvents({ contractId: 'C...' });

stream.on('data', ({ event }) => console.log('event:', event));
stream.on('error', (err) => console.error('stream error:', err));
```

---

## Service Discovery

```js
import { serviceRegistry } from './grpc/index.js';

// Register the indexer at startup
serviceRegistry.register('indexer', { host: 'indexer', port: 50051 });
serviceRegistry.start(); // begin health polling

// Resolve a healthy endpoint (round-robin)
const endpoint = serviceRegistry.resolve('indexer');
// → { host: 'indexer', port: 50051 }
```

---

## Environment Variables

| Variable            | Default     | Description                     |
| ------------------- | ----------- | ------------------------------- |
| `GRPC_PORT`         | `50051`     | Port the gRPC server binds to   |
| `GRPC_HOST`         | `127.0.0.1` | gRPC bind address; use TLS before binding to a public interface |
| `GRPC_ENABLED`      | `true`      | Set to `false` to disable gRPC and its REST gateway |
| `GRPC_TLS`          | `false`     | Enable gRPC TLS using `SSL_KEY_PATH` and `SSL_CERT_PATH` |
| `GRPC_GATEWAY_HOST` | `127.0.0.1` | gRPC address used by the local REST proxy |
| `GRPC_GATEWAY_DEADLINE_MS` | `120000` | Gateway gRPC deadline |
| `GRPC_AUTH_TOKEN` | unset | Access token for `GrpcClient` inter-service calls |
| `GRPC_INDEXER_HOST` | `localhost` | Indexer host used by GrpcClient |
| `GRPC_INDEXER_PORT` | `50051` | Indexer port used by GrpcClient |

## Soroban dual-protocol API

`SorobanService` uses the same compile, simulation, and deployment services as
the existing REST routes. Its gRPC methods are `Compile`, `Simulate`, and
`Deploy`; `CompileStream` is bidirectional and returns one compilation result
for each request received on the stream. Every RPC requires the same bearer
access token used by the REST gateway.

The `SorobanServiceClient` interface and `createSorobanGrpcClient` factory are
defined in `gateway.ts`; the factory is exported from `grpc/index.js`. The
legacy IndexerService also requires bearer auth for every RPC except its
health-check method. Configure `GRPC_AUTH_TOKEN` for backend-to-backend use of
`GrpcClient`.

```js
import { createSorobanGrpcClient } from './grpc/index.js';
import * as grpc from '@grpc/grpc-js';

const client = createSorobanGrpcClient(
  '127.0.0.1:50051',
  grpc.credentials.createInsecure()
);
const metadata = new grpc.Metadata();
metadata.set('authorization', ['Bearer', process.env.ACCESS_TOKEN].join(' '));
client.compile(
  { code: '...' },
  metadata,
  { deadline: new Date(Date.now() + 30_000) },
  (error, result) => {
    if (error) console.error(error);
    else console.log(result);
  }
);
```

The HTTP annotations in `soroban.proto` expose JSON endpoints under
`/api/gateway/v1/compile`, `/api/gateway/v1/simulate`, and
`/api/gateway/v1/deploy`. OpenAPI 3.1 JSON and Swagger UI are available at
`/api/gateway/openapi.json` and `/api/gateway/docs`. Gateway errors use RFC 7807
Problem Details; `x-request-id`, `traceparent`, and `tracestate` are forwarded
to the gRPC service.

In production, configure gRPC TLS before binding `GRPC_HOST` to a non-loopback
address. If the certificate is private, set `GRPC_ROOT_CERT_PATH`; configure
`GRPC_TLS_SERVER_NAME` when the certificate's DNS name differs from the local
gateway address.

---

## Security

- TLS is supported on both server and client via the `tls`, `certChain`, and `privateKey` options.
- Default (development) mode uses insecure credentials; set `tls: true` for production.
- The `ServiceRegistry` evicts stale entries after a configurable TTL (default 120 s).

---

## Performance Settings

| Setting                 | Value | Notes                                                     |
| ----------------------- | ----- | --------------------------------------------------------- |
| Max message size        | 64 MB | Accommodates large WASM binaries                          |
| Keepalive ping interval | 10 s  | Detects dead connections quickly                          |
| Keepalive timeout       | 5 s   |                                                           |
| Client retry limit      | 3     | Exponential backoff, UNAVAILABLE / DEADLINE_EXCEEDED only |
