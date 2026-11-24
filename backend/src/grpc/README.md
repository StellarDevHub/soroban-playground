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

| File                    | Purpose                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `soroban_indexer.proto` | Protocol Buffer definitions for the `IndexerService`                                            |
| `soroban.proto`         | Canonical Soroban compile, simulate, deploy, and compile-stream contracts with HTTP annotations |
| `server.js`             | gRPC server — implements `IndexerService` handlers and exposes `grpcEventBus`                   |
| `sorobanService.js`     | Authenticated compile, simulate, deploy, and bidirectional compile-stream handlers              |
| `gateway.ts`            | REST-to-gRPC proxy and OpenAPI 3.1 generator driven by `soroban.proto` HTTP annotations         |
| `client.js`             | `GrpcClient` — promise-wrapped stub with exponential-backoff retry                              |
| `serviceRegistry.js`    | `ServiceRegistry` — health-polling, round-robin load balancing, TTL eviction                    |
| `index.js`              | Re-exports the gRPC server, Soroban client, REST gateway, and service registry APIs             |

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

| Variable                   | Default     | Description                                                               |
| -------------------------- | ----------- | ------------------------------------------------------------------------- |
| `GRPC_PORT`                | `50051`     | Port the gRPC server binds to                                             |
| `GRPC_HOST`                | `127.0.0.1` | gRPC bind address                                                         |
| `GRPC_ENABLED`             | `true`      | Set to `false` to disable gRPC and its REST gateway                       |
| `GRPC_MTLS`                | `false`     | **Enable mutual TLS** — both server and client must present certificates  |
| `GRPC_TLS`                 | `false`     | Enable server-only TLS (mTLS is preferred for production)                 |
| `GRPC_SERVER_CERT`         | unset       | PEM-encoded server certificate chain (inline, `\n`-escaped)              |
| `GRPC_SERVER_KEY`          | unset       | PEM-encoded server private key (inline, `\n`-escaped)                    |
| `GRPC_CA_CERT`             | unset       | PEM CA used to verify client certificates (required for mTLS)             |
| `GRPC_CLIENT_CERT`         | unset       | PEM client certificate chain (required for mTLS on the client side)       |
| `GRPC_CLIENT_KEY`          | unset       | PEM client private key (required for mTLS on the client side)             |
| `GRPC_ROOT_CERT`           | unset       | PEM root CA for verifying the server certificate                          |
| `SSL_CERT_PATH`            | unset       | File-path fallback for server cert                                        |
| `SSL_KEY_PATH`             | unset       | File-path fallback for server key                                         |
| `GRPC_CA_CERT_PATH`        | unset       | File-path fallback for CA cert                                            |
| `GRPC_CLIENT_CERT_PATH`    | unset       | File-path fallback for client cert                                        |
| `GRPC_CLIENT_KEY_PATH`     | unset       | File-path fallback for client key                                         |
| `GRPC_ROOT_CERT_PATH`      | unset       | File-path fallback for root CA cert                                       |
| `GRPC_GATEWAY_HOST`        | `127.0.0.1` | gRPC address used by the local REST proxy                                 |
| `GRPC_GATEWAY_DEADLINE_MS` | `120000`    | Gateway gRPC deadline                                                     |
| `GRPC_AUTH_TOKEN`          | unset       | Access token for `GrpcClient` inter-service calls                        |
| `GRPC_INDEXER_HOST`        | `localhost` | Indexer host used by GrpcClient                                           |
| `GRPC_INDEXER_PORT`        | `50051`     | Indexer port used by GrpcClient                                           |
| `GRPC_TLS_SERVER_NAME`     | unset       | Override expected TLS server name (for Kubernetes / custom SANs)         |
| `GRPC_SSL_CIPHER_SUITES`   | set by grpcCredentials.js | Colon-separated OpenSSL cipher list enforced by gRPC-core |

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

### Mutual TLS (mTLS) — recommended for production

All gRPC communication should use mutual TLS so that both endpoints verify each other's X.509 certificate.  Set `GRPC_MTLS=true` and supply certificate material via environment variables or Kubernetes Secrets.

```
GRPC_MTLS=true

# Server certificate (PEM-encoded; use \n to encode newlines in a single line):
GRPC_SERVER_CERT=<server-cert-chain PEM>
GRPC_SERVER_KEY=<server-private-key PEM>
GRPC_CA_CERT=<CA-cert PEM>          # CA used to verify client certificates

# Client certificate (required when GRPC_MTLS=true):
GRPC_CLIENT_CERT=<client-cert PEM>
GRPC_CLIENT_KEY=<client-private-key PEM>
GRPC_ROOT_CERT=<root-CA PEM>        # used to verify the server certificate
```

File-path alternatives are accepted when the PEM env vars are absent:

```
SSL_CERT_PATH=      # server cert file
SSL_KEY_PATH=       # server key file
GRPC_CA_CERT_PATH=
GRPC_CLIENT_CERT_PATH=
GRPC_CLIENT_KEY_PATH=
GRPC_ROOT_CERT_PATH=
```

#### How it works

`grpcCredentials.js` is the single source of truth for credential construction:

- **Server** — `buildServerCredentials()` calls `grpc.ServerCredentials.createSsl(caCert, [{cert_chain, private_key}], true)`.  The third argument (`checkClientCertificate: true`) makes the TLS handshake require and verify the client's certificate against the supplied CA.
- **Client** — `buildClientCredentials()` calls `grpc.credentials.createSsl(rootCert, clientKey, clientCert)`, presenting the client's certificate during the TLS handshake.
- **Cipher policy** — `GRPC_SSL_CIPHER_SUITES` is set at startup to a TLS 1.3 + strong ECDHE/AEAD-only TLS 1.2 suite list.  Weak suites (RC4, 3DES, NULL, EXPORT, MD5-based) are excluded.
- **Production guard** — `buildServerCredentials()` and `buildClientCredentials()` throw at startup if `NODE_ENV=production` and neither `GRPC_MTLS` nor `GRPC_TLS` is set, preventing accidental insecure deployments.

#### Generating certificates (development / staging)

```bash
# 1. Generate a CA
openssl genrsa -out ca.key 4096
openssl req -new -x509 -key ca.key -out ca.crt -days 365 \
  -subj "/CN=SorobanCA/O=StellarDevTools"

# 2. Generate a server cert signed by the CA
openssl genrsa -out server.key 4096
openssl req -new -key server.key -out server.csr \
  -subj "/CN=soroban-grpc/O=StellarDevTools"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 365 -sha256 \
  -extfile <(echo "subjectAltName=DNS:localhost,IP:127.0.0.1")

# 3. Generate a client cert signed by the same CA
openssl genrsa -out client.key 4096
openssl req -new -key client.key -out client.csr \
  -subj "/CN=soroban-client/O=StellarDevTools"
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out client.crt -days 365 -sha256 \
  -extfile <(echo "extendedKeyUsage=clientAuth")

# Load into env (inline PEM — replace literal newlines with \n):
export GRPC_SERVER_CERT=$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' server.crt)
export GRPC_SERVER_KEY=$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' server.key)
export GRPC_CA_CERT=$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' ca.crt)
export GRPC_CLIENT_CERT=$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' client.crt)
export GRPC_CLIENT_KEY=$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' client.key)
export GRPC_ROOT_CERT=$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' ca.crt)
```

For Kubernetes, mount the certs as a Secret and reference the file paths via `SSL_CERT_PATH`, `SSL_KEY_PATH`, `GRPC_CA_CERT_PATH`, etc.

- Default (development) mode uses insecure credentials when `GRPC_MTLS` and `GRPC_TLS` are both unset; this is blocked in `NODE_ENV=production`.
- The `ServiceRegistry` evicts stale entries after a configurable TTL (default 120 s).

---

## Performance Settings

| Setting                 | Value | Notes                                                     |
| ----------------------- | ----- | --------------------------------------------------------- |
| Max message size        | 64 MB | Accommodates large WASM binaries                          |
| Keepalive ping interval | 10 s  | Detects dead connections quickly                          |
| Keepalive timeout       | 5 s   |                                                           |
| Client retry limit      | 3     | Exponential backoff, UNAVAILABLE / DEADLINE_EXCEEDED only |
