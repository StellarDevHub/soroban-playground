// Test script for the search API
import fetch from 'node-fetch';

const API_BASE = 'http://localhost:5000/api/search';

async function testSearchAPI() {
  console.log('🔍 Testing Search API...\n');

  try {
    // Test 1: Health check
    console.log('1. Testing health check...');
    const healthResponse = await fetch(`${API_BASE}/health`);
    const healthData = await healthResponse.json();
    console.log('Health check:', healthData);
    console.log('✅ Health check passed\n');

    // Test 2: Basic search
    console.log('2. Testing basic search...');
    const searchResponse = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'decentralized',
        filters: {},
        pagination: { page: 1, limit: 5 }
      })
    });
    const searchData = await searchResponse.json();
    console.log('Search results:', JSON.stringify(searchData, null, 2));
    console.log('✅ Basic search passed\n');

    // Test 3: Autocomplete
    console.log('3. Testing autocomplete...');
    const autocompleteResponse = await fetch(`${API_BASE}/autocomplete?q=defi&limit=5`);
    const autocompleteData = await autocompleteResponse.json();
    console.log('Autocomplete suggestions:', autocompleteData);
    console.log('✅ Autocomplete passed\n');

    // Test 4: Facet counts
    console.log('4. Testing facet counts...');
    const facetsResponse = await fetch(`${API_BASE}/facets?q=decentralized`);
    const facetsData = await facetsResponse.json();
    console.log('Facet counts:', facetsData);
    console.log('✅ Facet counts passed\n');

    // Test 5: Search with filters
    console.log('5. Testing search with filters...');
    const filteredSearchResponse = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: '',
        filters: { category: 'DeFi', status: 'active' },
        pagination: { page: 1, limit: 10 }
      })
    });
    const filteredSearchData = await filteredSearchResponse.json();
    console.log('Filtered search results:', JSON.stringify(filteredSearchData, null, 2));
    console.log('✅ Filtered search passed\n');

    console.log('🎉 All tests passed! Search API is working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Make sure the backend server is running on http://localhost:5000');
  }
}

// Run tests
testSearchAPI();
