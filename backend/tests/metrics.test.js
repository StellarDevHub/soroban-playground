import express from 'express';
import request from 'supertest';
import metricsRoute from '../src/routes/metrics.js';

describe('/metrics', () => {
  it('exposes CPU, memory, and request metrics for Prometheus', async () => {
    const app = express();
    app.use('/metrics', metricsRoute);

    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('process_memory_rss_bytes');
    expect(res.text).toContain('process_cpu_seconds_total');
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('http_request_rate_per_second');
  });
});
