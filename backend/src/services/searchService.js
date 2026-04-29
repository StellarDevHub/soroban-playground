import { getDatabase } from '../database/connection.js';

class SearchService {
  constructor() {
    this.db = null;
  }

  async initialize() {
    this.db = getDatabase();
  }

  // Levenshtein distance calculation for fuzzy matching
  calculateLevenshteinDistance(str1, str2) {
    const matrix = Array(str2.length + 1)
      .fill(null)
      .map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }
    return matrix[str2.length][str1.length];
  }

  // Phonetic matching using Soundex-like approach
  getPhoneticCode(str) {
    const code = str.toUpperCase().replace(/[^A-Z]/g, '');
    if (!code) return '';

    const soundex = {
      B: '1',
      F: '1',
      P: '1',
      V: '1',
      C: '2',
      G: '2',
      J: '2',
      K: '2',
      Q: '2',
      S: '2',
      X: '2',
      Z: '2',
      D: '3',
      T: '3',
      L: '4',
      M: '5',
      N: '5',
      R: '6',
    };

    let result = code[0];
    let lastCode = soundex[code[0]] || '';

    for (let i = 1; i < code.length; i++) {
      const currentCode = soundex[code[i]] || '';
      if (currentCode && currentCode !== lastCode) {
        result += currentCode;
      }
      lastCode = currentCode;
    }

    return result.padEnd(4, '0').substring(0, 4);
  }

  // BM25 ranking algorithm implementation
  calculateBM25Score(
    termFreq,
    docLength,
    avgDocLength,
    totalDocs,
    docsWithTerm
  ) {
    const k1 = 1.2;
    const b = 0.75;

    const idf = Math.log(
      (totalDocs - docsWithTerm + 0.5) / (docsWithTerm + 0.5)
    );
    const normalizedTermFreq =
      (termFreq * (k1 + 1)) /
      (termFreq + k1 * (1 - b + b * (docLength / avgDocLength)));

    return idf * normalizedTermFreq;
  }

  // Enhanced search with fuzzy matching and ranking
  async searchProjects(query, filters = {}, pagination = {}) {
    const startTime = Date.now();
    const {
      category,
      status,
      creator,
      fundingMin,
      fundingMax,
      sortBy = 'relevance',
      page = 1,
      limit = 20,
    } = filters;

    const offset = (page - 1) * limit;

    try {
      // Build base search query with FTS5
      let searchQuery = `
        SELECT 
          p.*,
          projects_fts.rank as search_rank,
          CASE 
            WHEN p.title LIKE ? THEN 3
            WHEN p.description LIKE ? THEN 2
            ELSE 1
          END as field_weight
        FROM projects p
        JOIN projects_fts ON p.id = projects_fts.rowid
        WHERE projects_fts MATCH ?
      `;

      const queryParams = [`%${query}%`, `%${query}%`, query];

      // Add filters
      if (category) {
        searchQuery += ` AND p.category = ?`;
        queryParams.push(category);
      }
      if (status) {
        searchQuery += ` AND p.status = ?`;
        queryParams.push(status);
      }
      if (creator) {
        searchQuery += ` AND p.creator_name LIKE ?`;
        queryParams.push(`%${creator}%`);
      }
      if (fundingMin !== undefined) {
        searchQuery += ` AND p.current_funding >= ?`;
        queryParams.push(fundingMin);
      }
      if (fundingMax !== undefined) {
        searchQuery += ` AND p.current_funding <= ?`;
        queryParams.push(fundingMax);
      }

      // Add sorting based on ranking algorithm
      const sortMapping = {
        relevance:
          'search_rank DESC, field_weight DESC, p.completion_rate DESC',
        funding: 'p.current_funding DESC',
        recent: 'p.created_at DESC',
        completion: 'p.completion_rate DESC',
        title: 'p.title ASC',
      };

      searchQuery += ` ORDER BY ${sortMapping[sortBy] || sortMapping['relevance']}`;
      searchQuery += ` LIMIT ? OFFSET ?`;
      queryParams.push(limit, offset);

      const results = await this.db.all(searchQuery, queryParams);

      // Get total count for pagination
      const countQuery = `
        SELECT COUNT(*) as total
        FROM projects p
        JOIN projects_fts ON p.id = projects_fts.rowid
        WHERE projects_fts MATCH ?
        ${category ? 'AND p.category = ?' : ''}
        ${status ? 'AND p.status = ?' : ''}
        ${creator ? 'AND p.creator_name LIKE ?' : ''}
        ${fundingMin !== undefined ? 'AND p.current_funding >= ?' : ''}
        ${fundingMax !== undefined ? 'AND p.current_funding <= ?' : ''}
      `;

      const countParams = [query];
      if (category) countParams.push(category);
      if (status) countParams.push(status);
      if (creator) countParams.push(`%${creator}%`);
      if (fundingMin !== undefined) countParams.push(fundingMin);
      if (fundingMax !== undefined) countParams.push(fundingMax);

      const countResult = await this.db.get(countQuery, countParams);
      const total = countResult.total;

      // Apply fuzzy matching for additional results if needed
      if (results.length < limit && query.length > 2) {
        const fuzzyResults = await this.getFuzzyMatches(
          query,
          filters,
          limit - results.length
        );
        results.push(...fuzzyResults);
      }

      const responseTime = Date.now() - startTime;

      // Log search analytics
      await this.logSearchAnalytics(
        query,
        filters,
        results.length,
        responseTime
      );

      return {
        results,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
        meta: {
          query,
          responseTime,
          searchType: results.length > 0 ? 'fts' : 'fuzzy',
        },
      };
    } catch (error) {
      console.error('Search error:', error);
      throw new Error('Search operation failed');
    }
  }

  // Fuzzy matching for typos and similar terms
  async getFuzzyMatches(query, filters, limit) {
    const projects = await this.db.all(
      `
      SELECT *, 
        CASE 
          WHEN LOWER(title) LIKE LOWER(?) THEN 0.8
          WHEN LOWER(description) LIKE LOWER(?) THEN 0.6
          ELSE 0.4
        END as similarity_score
      FROM projects 
      WHERE (LOWER(title) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?))
        AND category LIKE COALESCE(?, category)
        AND status LIKE COALESCE(?, status)
      ORDER BY similarity_score DESC, completion_rate DESC
      LIMIT ?
    `,
      [
        `%${query}%`,
        `%${query}%`,
        `%${query}%`,
        `%${query}%`,
        filters.category || '%',
        filters.status || '%',
        limit,
      ]
    );

    return projects.map((project) => ({
      ...project,
      search_rank: project.similarity_score * 10,
      is_fuzzy_match: true,
    }));
  }

  // Get faceted filter counts
  async getFacetCounts(query = '') {
    try {
      const facets = {};

      // Category counts
      facets.categories = await this.db.all(
        `
        SELECT category as name, COUNT(*) as count
        FROM projects p
        LEFT JOIN projects_fts fts ON p.id = fts.rowid
        WHERE (? = '' OR fts MATCH ?)
        GROUP BY category
        ORDER BY count DESC
      `,
        [query, query]
      );

      // Status counts
      facets.statuses = await this.db.all(
        `
        SELECT status as name, COUNT(*) as count
        FROM projects p
        LEFT JOIN projects_fts fts ON p.id = fts.rowid
        WHERE (? = '' OR fts MATCH ?)
        GROUP BY status
        ORDER BY count DESC
      `,
        [query, query]
      );

      // Creator counts (top 10)
      facets.creators = await this.db.all(
        `
        SELECT creator_name as name, COUNT(*) as count
        FROM projects p
        LEFT JOIN projects_fts fts ON p.id = fts.rowid
        WHERE (? = '' OR fts MATCH ?)
        GROUP BY creator_name
        ORDER BY count DESC
        LIMIT 10
      `,
        [query, query]
      );

      // Funding range counts
      facets.fundingRanges = await this.db.all(
        `
        SELECT 
          CASE 
            WHEN funding_goal < 10000 THEN 'Under $10k'
            WHEN funding_goal < 50000 THEN '$10k - $50k'
            WHEN funding_goal < 100000 THEN '$50k - $100k'
            ELSE 'Over $100k'
          END as name,
          COUNT(*) as count
        FROM projects p
        LEFT JOIN projects_fts fts ON p.id = fts.rowid
        WHERE (? = '' OR fts MATCH ?)
        GROUP BY name
        ORDER BY count DESC
      `,
        [query, query]
      );

      return facets;
    } catch (error) {
      console.error('Facet counts error:', error);
      return {};
    }
  }

  // Autocomplete suggestions
  async getAutocompleteSuggestions(query, limit = 10) {
    try {
      if (query.length < 2) return [];

      const suggestions = await this.db.all(
        `
        SELECT DISTINCT 
          substr(title, 1, 50) as suggestion,
          'title' as type,
          COUNT(*) OVER () as total_matches
        FROM projects_fts
        WHERE title MATCH ?
        UNION ALL
        SELECT DISTINCT 
          substr(category, 1, 50) as suggestion,
          'category' as type,
          COUNT(*) OVER () as total_matches
        FROM projects_fts
        WHERE category MATCH ?
        UNION ALL
        SELECT DISTINCT 
          substr(creator_name, 1, 50) as suggestion,
          'creator' as type,
          COUNT(*) OVER () as total_matches
        FROM projects_fts
        WHERE creator_name MATCH ?
        LIMIT ?
      `,
        [`${query}*`, `${query}*`, `${query}*`, limit]
      );

      return suggestions;
    } catch (error) {
      console.error('Autocomplete error:', error);
      return [];
    }
  }

  // Log search analytics
  async logSearchAnalytics(query, filters, resultsCount, responseTime) {
    try {
      await this.db.run(
        `
        INSERT INTO search_analytics (query, filters_applied, results_count, response_time_ms)
        VALUES (?, ?, ?, ?)
      `,
        [query, JSON.stringify(filters), resultsCount, responseTime]
      );

      // Update popular searches
      await this.db.run(
        `
        INSERT INTO popular_searches (query, search_count)
        VALUES (?, 1)
        ON CONFLICT(query) DO UPDATE SET 
          search_count = search_count + 1,
          last_updated = CURRENT_TIMESTAMP
      `,
        [query]
      );
    } catch (error) {
      console.error('Analytics logging error:', error);
    }
  }

  // Get popular searches
  async getPopularSearches(limit = 10) {
    try {
      return await this.db.all(
        `
        SELECT query, search_count, last_updated
        FROM popular_searches
        ORDER BY search_count DESC, last_updated DESC
        LIMIT ?
      `,
        [limit]
      );
    } catch (error) {
      console.error('Popular searches error:', error);
      return [];
    }
  }

  // Get search analytics
  async getSearchAnalytics(days = 7) {
    try {
      return await this.db.all(`
        SELECT 
          DATE(timestamp) as date,
          COUNT(*) as search_count,
          AVG(response_time_ms) as avg_response_time,
          AVG(results_count) as avg_results
        FROM search_analytics
        WHERE timestamp >= datetime('now', '-${days} days')
        GROUP BY DATE(timestamp)
        ORDER BY date DESC
      `);
    } catch (error) {
      console.error('Analytics error:', error);
      return [];
    }
  }
}

export default new SearchService();
