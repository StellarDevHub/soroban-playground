# Backend Load Testing

The k6 suite covers HTTP and WebSocket traffic for production-style concurrency.

Run the backend locally, then execute:

```sh
npm run load:http --workspace=backend
npm run load:ws --workspace=backend
```

Useful environment overrides:

```sh
BASE_URL=http://localhost:5000 K6_VUS=500 K6_DURATION=5m npm run load:http --workspace=backend
WS_URL=ws://localhost:5000/ws K6_VUS=500 K6_DURATION=5m npm run load:ws --workspace=backend
```

The scripts assert an error rate below 1% and p95 HTTP latency below 200 ms.
Export results with k6 output flags, for example:

```sh
k6 run --summary-export load-results/http-summary.json backend/load-tests/http.js
```

Review memory and CPU usage alongside the k6 percentiles before promoting a
backend release.
