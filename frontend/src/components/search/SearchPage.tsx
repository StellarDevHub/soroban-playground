import React, { useState, useEffect, useCallback } from 'react';
import { Search, Filter, ArrowUpDown, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import SearchInput from './SearchInput';
import SearchFilters, { SearchFiltersState, FacetCounts } from './SearchFilters';
import SearchResults, { SearchResult, SearchMeta } from './SearchResults';
import searchService from '../../services/searchService';

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface SearchResponse {
  results: SearchResult[];
  pagination: PaginationInfo;
  meta: SearchMeta;
}

const SearchPage: React.FC = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [filters, setFilters] = useState<SearchFiltersState>({});
  const [facetCounts, setFacetCounts] = useState<FacetCounts>({});
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrev: false
  });
  const [meta, setMeta] = useState<SearchMeta | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingFacets, setIsLoadingFacets] = useState(false);
  const [sortBy, setSortBy] = useState('relevance');
  const [error, setError] = useState<string | null>(null);

  // Load facet counts when query or filters change
  useEffect(() => {
    loadFacetCounts();
  }, [query]);

  // Perform search when query, filters, or pagination changes
  useEffect(() => {
    if (query.trim()) {
      performSearch();
    }
  }, [query, filters, pagination.page, sortBy]);

  const loadFacetCounts = useCallback(async () => {
    setIsLoadingFacets(true);
    try {
      const counts = await searchService.getFacetCounts(query);
      setFacetCounts(counts);
    } catch (error) {
      console.error('Failed to load facet counts:', error);
    } finally {
      setIsLoadingFacets(false);
    }
  }, [query]);

  const performSearch = useCallback(async () => {
    if (!query.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const searchParams = {
        query,
        filters: {
          ...filters,
          sortBy
        },
        pagination: {
          page: pagination.page,
          limit: pagination.limit
        }
      };

      const response: SearchResponse = await searchService.searchProjects(
        searchParams.query,
        searchParams.filters,
        searchParams.pagination
      );

      setResults(response.results);
      setPagination(response.pagination);
      setMeta(response.meta);
    } catch (error) {
      console.error('Search failed:', error);
      setError('Search failed. Please try again.');
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, [query, filters, pagination.page, sortBy, pagination.limit]);

  const handleSearch = useCallback((newQuery: string) => {
    setQuery(newQuery);
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  const handleFiltersChange = useCallback((newFilters: SearchFiltersState) => {
    setFilters(newFilters);
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  const handleSortChange = useCallback((newSortBy: string) => {
    setSortBy(newSortBy);
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const sortOptions = [
    { value: 'relevance', label: 'Relevance' },
    { value: 'funding', label: 'Funding Amount' },
    { value: 'recent', label: 'Recently Added' },
    { value: 'completion', label: 'Completion Rate' },
    { value: 'title', label: 'Title (A-Z)' }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Project Discovery Platform
            </h1>
            <p className="text-gray-600 mb-6">
              Find innovative projects and support the next big idea
            </p>
            
            {/* Search Input */}
            <div className="max-w-2xl mx-auto">
              <SearchInput
                onSearch={handleSearch}
                placeholder="Search for projects, categories, or creators..."
                initialValue={query}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-8">
          {/* Sidebar Filters */}
          <div className="w-80 flex-shrink-0">
            <div className="sticky top-6">
              <SearchFilters
                filters={filters}
                onFiltersChange={handleFiltersChange}
                facetCounts={facetCounts}
                isLoading={isLoadingFacets}
              />
            </div>
          </div>

          {/* Results Section */}
          <div className="flex-1 min-w-0">
            {/* Results Header */}
            {query && (
              <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Search className="w-5 h-5 text-gray-500" />
                      <span className="text-sm text-gray-600">
                        Showing {results.length} of {pagination.total} results
                      </span>
                    </div>
                    
                    {meta && (
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Info className="w-3 h-3" />
                        <span>{meta.responseTime}ms</span>
                        {meta.searchType === 'fuzzy' && (
                          <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full">
                            Fuzzy Search
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Sort Dropdown */}
                  <div className="flex items-center gap-2">
                    <ArrowUpDown className="w-4 h-4 text-gray-500" />
                    <select
                      value={sortBy}
                      onChange={(e) => handleSortChange(e.target.value)}
                      className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    >
                      {sortOptions.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Error State */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                <div className="text-red-800">
                  {error}
                </div>
              </div>
            )}

            {/* Search Results */}
            <SearchResults
              results={results}
              isLoading={isLoading}
              query={query}
              meta={meta}
            />

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={!pagination.hasPrev}
                    className="flex items-center gap-1 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                  </button>

                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                      let pageNum;
                      if (pagination.totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (pagination.page <= 3) {
                        pageNum = i + 1;
                      } else if (pagination.page >= pagination.totalPages - 2) {
                        pageNum = pagination.totalPages - 4 + i;
                      } else {
                        pageNum = pagination.page - 2 + i;
                      }

                      return (
                        <button
                          key={pageNum}
                          onClick={() => handlePageChange(pageNum)}
                          className={`w-8 h-8 text-sm border rounded-md transition-colors ${
                            pageNum === pagination.page
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={!pagination.hasNext}
                    className="flex items-center gap-1 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Empty State (no query yet) */}
            {!query && (
              <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
                <div className="max-w-md mx-auto">
                  <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Search className="w-8 h-8 text-blue-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    Start Your Project Discovery
                  </h3>
                  <p className="text-gray-600 mb-6">
                    Search for innovative projects, explore categories, or discover creators
                  </p>
                  
                  {/* Quick Categories */}
                  <div className="grid grid-cols-2 gap-3">
                    {['DeFi', 'Payments', 'NFT', 'Infrastructure'].map((category) => (
                      <button
                        key={category}
                        onClick={() => handleSearch(category)}
                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors"
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SearchPage;
