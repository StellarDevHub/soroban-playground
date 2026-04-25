import express from 'express';
import searchService from '../services/searchService.js';

const router = express.Router();

// Initialize search service
router.use(async (req, res, next) => {
  try {
    await searchService.initialize();
    next();
  } catch (error) {
    console.error('Search service initialization error:', error);
    res.status(500).json({ error: 'Search service unavailable' });
  }
});

// Main search endpoint
router.post('/projects', async (req, res) => {
  try {
    const { query, filters = {}, pagination = {} } = req.body;
    
    if (!query || query.trim().length < 1) {
      return res.status(400).json({ 
        error: 'Query parameter is required and must be at least 1 character' 
      });
    }

    const results = await searchService.searchProjects(query.trim(), filters, pagination);
    
    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Search endpoint error:', error);
    res.status(500).json({ 
      error: 'Search operation failed',
      message: error.message 
    });
  }
});

// Autocomplete endpoint
router.get('/autocomplete', async (req, res) => {
  try {
    const { q: query, limit = 10 } = req.query;
    
    if (!query || query.length < 2) {
      return res.json({ suggestions: [] });
    }

    const suggestions = await searchService.getAutocompleteSuggestions(query, parseInt(limit));
    
    res.json({
      success: true,
      data: { suggestions }
    });
  } catch (error) {
    console.error('Autocomplete error:', error);
    res.status(500).json({ 
      error: 'Autocomplete failed',
      message: error.message 
    });
  }
});

// Faceted filter counts endpoint
router.get('/facets', async (req, res) => {
  try {
    const { q: query = '' } = req.query;
    
    const facets = await searchService.getFacetCounts(query);
    
    res.json({
      success: true,
      data: facets
    });
  } catch (error) {
    console.error('Facets error:', error);
    res.status(500).json({ 
      error: 'Facet retrieval failed',
      message: error.message 
    });
  }
});

// Popular searches endpoint
router.get('/popular', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    const popular = await searchService.getPopularSearches(parseInt(limit));
    
    res.json({
      success: true,
      data: popular
    });
  } catch (error) {
    console.error('Popular searches error:', error);
    res.status(500).json({ 
      error: 'Popular searches retrieval failed',
      message: error.message 
    });
  }
});

// Search analytics endpoint
router.get('/analytics', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    
    const analytics = await searchService.getSearchAnalytics(parseInt(days));
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ 
      error: 'Analytics retrieval failed',
      message: error.message 
    });
  }
});

// Health check for search service
router.get('/health', async (req, res) => {
  try {
    // Test database connection
    await searchService.initialize();
    
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'search-service'
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
