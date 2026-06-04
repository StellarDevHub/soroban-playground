import { IntegrationTestRunner } from './runner.js';

const API_BASE = process.env.API_URL || 'http://localhost:5000/api/search';

async function runIntegrationTests() {
  console.log('🔍 Starting Robust Integration Tests...\n');

  const runner = new IntegrationTestRunner(API_BASE, {
    verbose: true,
    maxRetries: 2,
    timeout: 5000,
  });

  // Test 1: Health check
  await runner.runTest('Health Check', '/health');

  // Test 2: Basic search
  await runner.runTest('Basic Search', '/projects', 'POST', {
    query: 'decentralized',
    filters: {},
    pagination: { page: 1, limit: 5 },
  });

  // Test 3: Autocomplete
  await runner.runTest('Autocomplete', '/autocomplete?q=defi&limit=5');

  // Test 4: Facet counts
  await runner.runTest('Facet Counts', '/facets?q=decentralized');

  // Test 5: Search with filters
  await runner.runTest('Filtered Search', '/projects', 'POST', {
    query: '',
    filters: { category: 'DeFi', status: 'active' },
    pagination: { page: 1, limit: 10 },
  });

  const summary = runner.getSummary();
  console.log('\n📊 Test Summary:');
  console.table({
    Total: summary.total,
    Passed: summary.passed,
    Failed: summary.failed,
    'Success Rate': `${summary.successRate.toFixed(1)}%`,
  });

  if (summary.failed > 0) {
    console.error('\n❌ Some tests failed. Please check the logs.');
    process.exit(1);
  } else {
    console.log('\n🎉 All integration tests passed!');
    process.exit(0);
  }
}

runIntegrationTests().catch((error) => {
  console.error('💥 Critical failure in test runner:', error);
  process.exit(1);
});
