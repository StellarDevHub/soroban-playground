# Shared Redis connections and cache recovery

`redisService` owns one ioredis client (or Cluster client with its managed node
connections). `cacheService` is a JSON compatibility adapter over that singleton;
it does not connect independently. Pub/sub uses the required dedicated subscriber.
Calling `close()` through either API shuts down the shared client and subscriber.

## Configuration

- Standalone: `REDIS_URL=redis://host:6379/0` (or `rediss://` for TLS).
- Cluster: `REDIS_CLUSTER_NODES=node1:6379,node2:6379`. URL username/password
  and TLS settings apply to every node; only database 0 is supported.
- Sentinel: `REDIS_SENTINEL_NODES=sentinel1:26379,sentinel2:26379` and
  `REDIS_SENTINEL_NAME=mymaster`. URL credentials authenticate to the discovered
  master. `REDIS_SENTINEL_USERNAME` / `REDIS_SENTINEL_PASSWORD` authenticate to
  Sentinel, and `REDIS_SENTINEL_TLS=true` enables TLS for discovery.
- `REDIS_TLS=true` enables data-node TLS. Certificate verification defaults to
  true; `REDIS_TLS_REJECT_UNAUTHORIZED=false` is an explicit opt-out for local
  self-signed deployments. Boolean flags accept only `true` or `false`.

Cluster and Sentinel lists are mutually exclusive. Endpoints validate hostname
and port syntax (including bracketed IPv6), and invalid settings produce a
credential-free diagnostic and use memory without opening Redis sockets.
Production with no explicit URL or topology uses memory; development defaults
to localhost. A topology-only production deployment does not require a URL.

## Failure and recovery

Requests use a bounded process-local LRU (5,000 entries / 100 MB) during outages.
TTL is retained. This cache is **not shared between instances**; outage writes
are not replayed into Redis on recovery. It does not provide distributed locking
or cross-instance rate-limit guarantees while Redis is unavailable.

Reconnect delays grow exponentially with jitter from 500–1,000 ms to a capped
15–30 seconds. Standalone, Cluster discovery and Sentinel discovery continue
retrying in the background, including after ten failures. Offline command
queues are disabled so cache requests can fall back promptly.

Five command failures open the circuit breaker. A ready connection clears it;
otherwise a 60-second timer probes the actual Redis socket, allowing recovery
from command failures even without a new connection event. Closing the service
cancels the timer. Health checks use real PING/INFO responses and report
`fallback` when Redis fails, rather than treating an in-memory PONG as healthy.

## Verification

```sh
# From the repository root, using the same Jest entry point as CI:
npx jest --config backend/jest.config.cjs backend/tests/redisConnection.test.js --runInBand
REDIS_TEST_SERVER=redis-server npx jest --config backend/jest.config.cjs backend/tests/redisConnection.integration.test.js --runInBand
```

The integration suite starts its own Redis on an ephemeral loopback port,
stops it, verifies JSON caching in memory, then restarts it and verifies writes
and health through the same ioredis client. It is skipped unless the executable
is supplied; CI installs Redis and runs it explicitly. Constructor-level tests
cover Cluster/Sentinel options; a full multi-node failover deployment is not
created by this suite.
