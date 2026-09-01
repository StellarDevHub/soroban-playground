# Soroban RPC pool

The backend's `sorobanRpcManager` supports a comma-separated
`SOROBAN_RPC_FALLBACK_URLS` priority list. Requests use the active endpoint
first, then round-robin through endpoints whose circuit is not open. Failures
trip a circuit breaker; successful calls close it again.

In production, the manager polls every endpoint every 10 seconds with both
`getHealth` and `getLatestLedger`. Unhealthy endpoints are removed from
routing and automatically become eligible again after a successful health
poll. Configure `RPC_HEALTH_CHECK_INTERVAL_MS` to change the interval.
