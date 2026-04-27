import React from 'react';
import { Clock, TrendingUp, Users, DollarSign, Calendar, ExternalLink } from 'lucide-react';

interface SearchResultsProps {
  results: SearchResult[];
  isLoading?: boolean;
  query?: string;
  meta?: SearchMeta;
}

export interface SearchResult {
  id: number;
  title: string;
  description: string;
  category: string;
  status: string;
  creator_name: string;
  funding_goal: number;
  current_funding: number;
  completion_rate: number;
  created_at: string;
  updated_at: string;
  tags?: string[];
  search_rank?: number;
  field_weight?: number;
  is_fuzzy_match?: boolean;
}

export interface SearchMeta {
  query: string;
  responseTime: number;
  searchType: string;
}

const SearchResults: React.FC<SearchResultsProps> = ({
  results,
  isLoading = false,
  query,
  meta
}) => {
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'funded':
        return 'bg-blue-100 text-blue-800';
      case 'completed':
        return 'bg-purple-100 text-purple-800';
      case 'draft':
        return 'bg-gray-100 text-gray-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category.toLowerCase()) {
      case 'defi':
        return 'bg-indigo-100 text-indigo-800';
      case 'payments':
        return 'bg-green-100 text-green-800';
      case 'nft':
        return 'bg-pink-100 text-pink-800';
      case 'infrastructure':
        return 'bg-orange-100 text-orange-800';
      case 'tools':
        return 'bg-blue-100 text-blue-800';
      case 'analytics':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const highlightText = (text: string, query: string) => {
    if (!query || query.length < 2) return text;
    
    const regex = new RegExp(`(${query})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, index) => 
      regex.test(part) ? (
        <span key={index} className="font-semibold text-blue-600 bg-blue-50 px-0.5 rounded">
          {part}
        </span>
      ) : (
        <span key={index}>{part}</span>
      )
    );
  };

  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, index) => (
          <div key={index} className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse">
            <div className="space-y-4">
              <div className="h-6 bg-gray-200 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              <div className="h-20 bg-gray-200 rounded"></div>
              <div className="flex gap-4">
                <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                <div className="h-4 bg-gray-200 rounded w-1/4"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
        <div className="max-w-md mx-auto">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <TrendingUp className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No projects found</h3>
          <p className="text-gray-600 mb-4">
            {query ? `No projects found matching "${query}"` : 'No projects available'}
          </p>
          {query && (
            <div className="text-sm text-gray-500">
              Try adjusting your search terms or filters
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search metadata */}
      {meta && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-blue-800">
              Found {results.length} results for "{meta.query}" 
              {meta.searchType === 'fuzzy' && ' (including fuzzy matches)'}
            </div>
            <div className="text-xs text-blue-600">
              {meta.responseTime}ms
            </div>
          </div>
        </div>
      )}

      {/* Results list */}
      {results.map((result) => (
        <div
          key={result.id}
          className={`bg-white rounded-lg border border-gray-200 p-6 hover:shadow-lg transition-shadow duration-200 ${
            result.is_fuzzy_match ? 'border-yellow-300 bg-yellow-50' : ''
          }`}
        >
          {/* Header with title and badges */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-gray-900 mb-2 hover:text-blue-600 cursor-pointer">
                {highlightText(result.title, query || '')}
                {result.is_fuzzy_match && (
                  <span className="ml-2 text-xs bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">
                    Fuzzy Match
                  </span>
                )}
              </h3>
              
              {/* Badges */}
              <div className="flex flex-wrap gap-2 mb-3">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getCategoryColor(result.category)}`}>
                  {result.category}
                </span>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${getStatusColor(result.status)}`}>
                  {result.status}
                </span>
                {result.tags?.slice(0, 3).map((tag, index) => (
                  <span key={index} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            
            {/* Ranking indicator */}
            {result.search_rank && (
              <div className="ml-4 text-xs text-gray-500 text-right">
                <div>Relevance</div>
                <div className="font-semibold text-blue-600">
                  {result.search_rank.toFixed(1)}
                </div>
              </div>
            )}
          </div>

          {/* Description */}
          <p className="text-gray-600 mb-4 line-clamp-3">
            {highlightText(truncateText(result.description, 200), query || '')}
          </p>

          {/* Project details grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {/* Funding progress */}
            <div className="flex items-center gap-3">
              <DollarSign className="w-5 h-5 text-green-600" />
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {formatCurrency(result.current_funding)}
                </div>
                <div className="text-xs text-gray-500">
                  of {formatCurrency(result.funding_goal)} goal
                </div>
              </div>
            </div>

            {/* Completion rate */}
            <div className="flex items-center gap-3">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {result.completion_rate.toFixed(1)}%
                </div>
                <div className="text-xs text-gray-500">funded</div>
              </div>
            </div>

            {/* Creator */}
            <div className="flex items-center gap-3">
              <Users className="w-5 h-5 text-purple-600" />
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {result.creator_name}
                </div>
                <div className="text-xs text-gray-500">creator</div>
              </div>
            </div>
          </div>

          {/* Funding progress bar */}
          <div className="mb-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-blue-500 to-green-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(result.completion_rate, 100)}%` }}
              ></div>
            </div>
          </div>

          {/* Footer with dates and action */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <div className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Created {formatDate(result.created_at)}
              </div>
              {result.updated_at !== result.created_at && (
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Updated {formatDate(result.updated_at)}
                </div>
              )}
            </div>
            
            <button className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 transition-colors">
              View Project
              <ExternalLink className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default SearchResults;
