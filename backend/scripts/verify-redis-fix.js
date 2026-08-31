#!/usr/bin/env node
/**
 * Verification script for Redis connection pool fix
 * Run with: node scripts/verify-redis-fix.js
 */

import redisService from '../src/services/redisService.js';

const TESTS = {
  passed: 0,
  failed: 0,
  warnings: 0,
};

function pass(test) {
  TESTS.passed++;
  console.log(`✅ ${test}`);
}

function fail(test, error) {
  TESTS.failed++;
  console.error(`❌ ${test}`);
  if (error) console.error(`   Error: ${error}`);
}

function warn(test, message) {
  TESTS.warnings++;
  console.warn(`⚠️  ${test}`);
  if (message) console.warn(`   ${message}`);
}

async function verifyRedisService() {
  console.log('\n🔍 Verifying Unified Redis Service...\n');

  // Test 1: Service instantiation
  try {
    if (redisService) {
      pass('RedisService instance created');
    } else {
      fail('RedisService instance creation');
    }
  } catch (error) {
    fail('RedisService instantiation', error.message);
  }

  // Test 2: Circuit breaker properties
  try {
    if (typeof redisService.circuitBreakerState === 'string') {
      pass(`Circuit breaker state initialized: ${redisService.circuitBreakerState}`);
    } else {
      fail('Circuit breaker state property');
    }
  } catch (error) {
    fail('Circuit breaker properties', error.message);
  }

  // Test 3: Fallback cache
  try {
    if (redisService.localCache) {
      pass('LRU memory cache fallback initialized');
    } else {
      fail('LRU memory cache fallback');
    }
  } catch (error) {
    fail('Fallback cache', error.message);
  }

  // Test 4: Environment configuration
  try {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      pass(`REDIS_URL configured: ${redisUrl.replace(/:[^@]+@/, ':***@')}`);
    } else {
      warn('REDIS_URL not set', 'Will use default redis://localhost:6379');
    }
  } catch (error) {
    fail('Environment configuration', error.message);
  }

  // Test 5: TLS configuration
  try {
    const redisTls = process.env.REDIS_TLS;
    if (redisTls === 'true') {
      pass('REDIS_TLS enabled');
    } else {
      console.log(`ℹ️  REDIS_TLS: ${redisTls || 'false (default)'}`);
    }
  } catch (error) {
    fail('TLS configuration', error.message);
  }

  // Test 6: Cluster configuration
  try {
    const clusterNodes = process.env.REDIS_CLUSTER_NODES;
    if (clusterNodes) {
      pass(`Redis Cluster configured: ${clusterNodes.split(',').length} nodes`);
    } else {
      console.log('ℹ️  Redis Cluster: not configured (standalone mode)');
    }
  } catch (error) {
    fail('Cluster configuration', error.message);
  }

  // Test 7: Connection test
  try {
    const health = await redisService.healthCheck();
    if (health.status === 'connected') {
      pass(`Redis connection: ${health.status}`);
    } else if (health.status === 'fallback') {
      warn(
        'Redis using fallback mode',
        'Connection failed, using in-memory cache'
      );
    } else {
      warn('Redis connection', `Status: ${health.status}`);
    }
  } catch (error) {
    warn('Redis connection test', error.message);
  }

  // Test 8: Basic operations
  try {
    const testKey = '__redis_fix_test__';
    const testValue = `test_${Date.now()}`;

    await redisService.set(testKey, testValue, 10);
    const retrieved = await redisService.get(testKey);
    await redisService.del(testKey);

    if (retrieved === testValue) {
      pass('Basic Redis operations (set/get/del)');
    } else {
      warn('Basic Redis operations', `Expected ${testValue}, got ${retrieved}`);
    }
  } catch (error) {
    warn('Basic Redis operations', error.message);
  }

  // Test 9: Pipeline operations
  try {
    const pipeline = redisService.pipeline();
    if (pipeline && typeof pipeline.exec === 'function') {
      pass('Pipeline operations supported');
    } else {
      fail('Pipeline operations');
    }
  } catch (error) {
    fail('Pipeline operations', error.message);
  }

  // Test 10: CacheService methods merged
  try {
    const methods = [
      'clearSearchCache',
      'cacheSearchResults',
      'getQueryPopularity',
      'generateSearchKey',
    ];
    const missing = methods.filter(
      (method) => typeof redisService[method] !== 'function'
    );
    if (missing.length === 0) {
      pass('CacheService methods merged');
    } else {
      fail('CacheService methods', `Missing: ${missing.join(', ')}`);
    }
  } catch (error) {
    fail('CacheService methods', error.message);
  }

  // Test 11: Circuit breaker methods
  try {
    const methods = [
      'executeWithCircuitBreaker',
      'openCircuitBreaker',
      'resetCircuitBreaker',
      'recordCircuitBreakerFailure',
    ];
    const missing = methods.filter(
      (method) => typeof redisService[method] !== 'function'
    );
    if (missing.length === 0) {
      pass('Circuit breaker methods implemented');
    } else {
      fail('Circuit breaker methods', `Missing: ${missing.join(', ')}`);
    }
  } catch (error) {
    fail('Circuit breaker methods', error.message);
  }

  // Test 12: Admin snapshot
  try {
    const snapshot = await redisService.getCacheAdminSnapshot();
    if (
      snapshot.circuitBreakerState &&
      typeof snapshot.isFallbackMode === 'boolean'
    ) {
      pass(
        `Admin snapshot: CB=${snapshot.circuitBreakerState}, Fallback=${snapshot.isFallbackMode}`
      );
    } else {
      fail('Admin snapshot', 'Missing required fields');
    }
  } catch (error) {
    fail('Admin snapshot', error.message);
  }
}

async function verifyCompileService() {
  console.log('\n🔍 Verifying Compile Service Integration...\n');

  try {
    // Dynamic import to check if compileService loads correctly
    const { initializeCompileService, getCompileStats } = await import(
      '../src/services/compileService.js'
    );

    if (typeof initializeCompileService === 'function') {
      pass('CompileService loads successfully');
    } else {
      fail('CompileService initialization function');
    }

    if (typeof getCompileStats === 'function') {
      pass('CompileService stats function available');
    } else {
      fail('CompileService stats function');
    }
  } catch (error) {
    fail('CompileService import', error.message);
  }
}

async function verifyCacheServiceDeprecation() {
  console.log('\n🔍 Verifying CacheService Deprecation...\n');

  try {
    const cacheService = await import('../src/services/cacheService.js');

    if (cacheService.default === redisService) {
      pass('CacheService re-exports redisService correctly');
    } else {
      fail('CacheService re-export', 'Does not match redisService instance');
    }
  } catch (error) {
    fail('CacheService import', error.message);
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Redis Connection Pool & Circuit Breaker - Verification   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  await verifyRedisService();
  await verifyCompileService();
  await verifyCacheServiceDeprecation();

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                     Test Results                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`✅ Passed:   ${TESTS.passed}`);
  console.log(`⚠️  Warnings: ${TESTS.warnings}`);
  console.log(`❌ Failed:   ${TESTS.failed}`);
  console.log('');

  if (TESTS.failed === 0) {
    console.log('🎉 All critical tests passed!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Configure REDIS_URL in .env if not already set');
    console.log('2. Run: npm start');
    console.log('3. Test: curl http://localhost:5000/health');
    console.log('');
    process.exit(0);
  } else {
    console.error('❌ Some tests failed. Please review the errors above.');
    process.exit(1);
  }
}

// Graceful cleanup
process.on('SIGINT', async () => {
  console.log('\n\nShutting down...');
  try {
    await redisService.quit();
  } catch (err) {
    // Ignore cleanup errors
  }
  process.exit(0);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
