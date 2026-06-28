import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

export const errorRate = new Rate('http_error_rate');
export const healthLatency = new Trend('health_latency');

export const options = {
  scenarios: {
    steady_500_vus: {
      executor: 'constant-vus',
      vus: Number(__ENV.K6_VUS ?? 500),
      duration: __ENV.K6_DURATION ?? '5m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<200'],
    http_error_rate: ['rate<0.01'],
    health_latency: ['p(95)<200'],
  },
};

const BASE_URL = __ENV.BASE_URL ?? 'http://localhost:5000';

export default function () {
  const health = http.get(`${BASE_URL}/api/health`);
  healthLatency.add(health.timings.duration);
  errorRate.add(health.status >= 400);
  check(health, {
    'health returned 200': (res) => res.status === 200,
    'health p95 target sample under 200ms': (res) => res.timings.duration < 200,
  });

  const graphql = http.post(
    `${BASE_URL}/graphql`,
    JSON.stringify({ query: '{ health }' }),
    { headers: { 'content-type': 'application/json' } }
  );
  errorRate.add(graphql.status >= 400);
  check(graphql, {
    'graphql returned 200': (res) => res.status === 200,
    'graphql health is ok': (res) => res.json('data.health') === 'ok',
  });

  sleep(1);
}
