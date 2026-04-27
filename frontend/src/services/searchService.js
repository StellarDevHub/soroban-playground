const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

class SearchService {
  // Main search function
  async searchProjects(query, filters = {}, pagination = {}) {
    try {
      const response = await fetch(`${API_BASE_URL}/search/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          filters,
          pagination
        })
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error('Search API error:', error);
      throw error;
    }
  }

  // Autocomplete suggestions
  async getAutocompleteSuggestions(query, limit = 10) {
    try {
      const params = new URLSearchParams({
        q: query,
        limit: limit.toString()
      });

      const response = await fetch(`${API_BASE_URL}/search/autocomplete?${params}`);
      
      if (!response.ok) {
        throw new Error(`Autocomplete failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data.suggestions;
    } catch (error) {
      console.error('Autocomplete API error:', error);
      return [];
    }
  }

  // Get faceted filter counts
  async getFacetCounts(query = '') {
    try {
      const params = new URLSearchParams({ q: query });
      const response = await fetch(`${API_BASE_URL}/search/facets?${params}`);
      
      if (!response.ok) {
        throw new Error(`Facets failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error('Facets API error:', error);
      return {};
    }
  }

  // Get popular searches
  async getPopularSearches(limit = 10) {
    try {
      const params = new URLSearchParams({ limit: limit.toString() });
      const response = await fetch(`${API_BASE_URL}/search/popular?${params}`);
      
      if (!response.ok) {
        throw new Error(`Popular searches failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error('Popular searches API error:', error);
      return [];
    }
  }

  // Get search analytics
  async getSearchAnalytics(days = 7) {
    try {
      const params = new URLSearchParams({ days: days.toString() });
      const response = await fetch(`${API_BASE_URL}/search/analytics?${params}`);
      
      if (!response.ok) {
        throw new Error(`Analytics failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error('Analytics API error:', error);
      return [];
    }
  }

  // Health check
  async healthCheck() {
    try {
      const response = await fetch(`${API_BASE_URL}/search/health`);
      
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Health check API error:', error);
      return { success: false, status: 'error' };
    }
  }
}

export default new SearchService();
