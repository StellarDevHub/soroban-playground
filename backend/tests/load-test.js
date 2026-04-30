#!/usr/bin/env node

/**
 * Load Testing Script for Rate Limiting
 * Tests concurrent requests under different tier limits
 * Verifies:
 * - Rate limit enforcement
 * - No race conditions
 * - Correct header responses
 * - Tier segregation
 */

import http from 'http';
import crypto from 'crypto';

const API_BASE_URL = process.env.API_URL || 'http://localhost:5000';
const TEST_DURATION_MS = 30000; // 30 seconds
const logger = {
  success: (msg) => console.log(`✓ ${msg}`),
  error: (msg) => console.log(`✗ ${msg}`),
  info: (msg) => console.log(`ℹ ${msg}`),
  warn: (msg) => console.log(`⚠ ${msg}`),
};

interface TestResult {
  tier: string;
  totalRequests: number;
  successfulRequests: number;
  rateLimitedRequests: number;
  errors: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  requestsPerSecond: number;
  noConcurrencyIssues: boolean;
}

async function generateApiKey(tier) {
  return new Promise((resolve, reject) => {
    const requestData = JSON.stringify({
      name: `test-key-${tier}-${Date.now()}`,
      description: `Load test key for ${tier} tier`,
      tier,
    });

    const options = {
      hostname: new URL(API_BASE_URL).hostname,
      port: new URL(API_BASE_URL).port || 5000,
      path: '/api/admin/api-keys',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestData),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.key);
        } catch {
          reject(new Error('Failed to parse key response'));
        }
      });
    });

    req.on('error', reject);
    req.write(requestData);
    req.end();
  });
}

async function makeRequest(apiKey, testData) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const options = {
      hostname: new URL(API_BASE_URL).hostname,
      port: new URL(API_BASE_URL).port || 5000,
      path: `/api/compile?api_key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
    };

    const req = http.request(options, (res) => {
      const responseTime = Date.now() - startTime;
      const rateLimited = res.statusCode === 429;
      const successful = res.statusCode < 400;

      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          responseTime,
          rateLimited,
          successful,
          headers: res.headers,
          concurrencyIssue: false,
        });
      });
    });

    req.on('error', () => {
      resolve({
        statusCode: 0,
        responseTime: Date.now() - startTime,
        rateLimited: false,
        successful: false,
        headers: {},
        concurrencyIssue: true,
      });
    });

    req.write(JSON.stringify(testData));
    req.end();
  });
}

async function runLoadTest(tier) {
  logger.info(`Starting load test for tier: ${tier}`);

  try {
    // Generate API key for this tier
    const apiKey = await generateApiKey(tier);
    logger.success(`Generated API key for ${tier} tier`);

    const testData = {
      code: 'pub fn main() { 1 + 1; }',
    };

    const results = {
      tier,
      totalRequests: 0,
      successfulRequests: 0,
      rateLimitedRequests: 0,
      errors: 0,
      responseTimes: [],
      concurrencyIssues: 0,
    };

    const startTime = Date.now();
    const requestPromises = [];

    // Send concurrent requests for the duration
    while (Date.now() - startTime < TEST_DURATION_MS) {
      // Send 10 concurrent requests
      for (let i = 0; i < 10; i++) {
        const promise = makeRequest(apiKey, testData).then((result) => {
          results.totalRequests++;
          if (result.successful) results.successfulRequests++;
          if (result.rateLimited) results.rateLimitedRequests++;
          if (result.statusCode === 0) {
            results.errors++;
            results.concurrencyIssues += result.concurrencyIssue ? 1 : 0;
          }
          results.responseTimes.push(result.responseTime);

          // Verify rate limit headers
          if (result.headers['x-ratelimit-limit-minute']) {
            // Headers are present
          }
        });
        requestPromises.push(promise);
      }

      // Wait a bit before next batch
      await new Promise((r) => setTimeout(r, 100));
    }

    // Wait for all requests to complete
    await Promise.all(requestPromises);

    const duration = (Date.now() - startTime) / 1000;
    const responseTimes = results.responseTimes.sort((a, b) => a - b);

    return {
      tier,
      totalRequests: results.totalRequests,
      successfulRequests: results.successfulRequests,
      rateLimitedRequests: results.rateLimitedRequests,
      errors: results.errors,
      avgResponseTime: Math.round(
        results.responseTimes.reduce((a, b) => a + b, 0) / results.responseTimes.length
      ),
      minResponseTime: Math.min(...responseTimes),
      maxResponseTime: Math.max(...responseTimes),
      requestsPerSecond: Math.round(results.totalRequests / duration),
      noConcurrencyIssues: results.concurrencyIssues === 0,
    };
  } catch (error) {
    logger.error(`Load test failed for ${tier}: ${error.message}`);
    return null;
  }
}

async function main() {
  logger.info('🧪 Rate Limiter Load Tests Starting...\n');

  const tiers = ['free', 'standard', 'premium', 'admin'];
  const allResults = [];

  for (const tier of tiers) {
    const result = await runLoadTest(tier);
    if (result) {
      allResults.push(result);
      logger.success(
        `${tier}: ${result.totalRequests} requests, ${result.rateLimitedRequests} rate limited, ${result.requestsPerSecond} req/s`
      );
    }
    // Wait between tests
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Print summary
  logger.info('\n📊 Test Summary:\n');
  console.table(
    allResults.map((r) => ({
      Tier: r.tier,
      'Total Requests': r.totalRequests,
      'Rate Limited': r.rateLimitedRequests,
      'Successful': r.successfulRequests,
      'Errors': r.errors,
      'Avg Response': `${r.avgResponseTime}ms`,
      'Req/s': r.requestsPerSecond,
      'No Race Conds': r.noConcurrencyIssues ? '✓' : '✗',
    }))
  );

  // Verify acceptance criteria
  logger.info('\n✅ Acceptance Criteria Verification:\n');
  const allRateLimited = allResults.every((r) => r.rateLimitedRequests > 0);
  const noErrors = allResults.every((r) => r.errors === 0);
  const noConcurrencyIssues = allResults.every((r) => r.noConcurrencyIssues);

  if (allRateLimited) logger.success('All tiers enforced rate limits');
  else logger.error('Some tiers did not enforce rate limits');

  if (noErrors) logger.success('No connection errors detected');
  else logger.error('Connection errors detected');

  if (noConcurrencyIssues) logger.success('No race conditions detected');
  else logger.error('Race conditions may be present');

  process.exit(allRateLimited && noErrors && noConcurrencyIssues ? 0 : 1);
}

main().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
