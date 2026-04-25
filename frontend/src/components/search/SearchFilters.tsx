import React, { useState, useEffect } from 'react';
import { Filter, ChevronDown, ChevronUp, X } from 'lucide-react';

interface SearchFiltersProps {
  filters: SearchFiltersState;
  onFiltersChange: (filters: SearchFiltersState) => void;
  facetCounts?: FacetCounts;
  isLoading?: boolean;
}

export interface SearchFiltersState {
  category?: string;
  status?: string;
  creator?: string;
  fundingMin?: number;
  fundingMax?: number;
}

export interface FacetCounts {
  categories: Array<{ name: string; count: number }>;
  statuses: Array<{ name: string; count: number }>;
  creators: Array<{ name: string; count: number }>;
  fundingRanges: Array<{ name: string; count: number }>;
}

const SearchFilters: React.FC<SearchFiltersProps> = ({
  filters,
  onFiltersChange,
  facetCounts,
  isLoading = false
}) => {
  const [isExpanded, setIsExpanded] = useState({
    category: true,
    status: true,
    creator: false,
    funding: false
  });

  const [tempFundingRange, setTempFundingRange] = useState({
    min: '',
    max: ''
  });

  useEffect(() => {
    setTempFundingRange({
      min: filters.fundingMin?.toString() || '',
      max: filters.fundingMax?.toString() || ''
    });
  }, [filters.fundingMin, filters.fundingMax]);

  const handleFilterChange = (key: keyof SearchFiltersState, value: any) => {
    const newFilters = { ...filters, [key]: value };
    onFiltersChange(newFilters);
  };

  const handleClearFilter = (key: keyof SearchFiltersState) => {
    const newFilters = { ...filters };
    delete newFilters[key];
    onFiltersChange(newFilters);
  };

  const handleClearAll = () => {
    onFiltersChange({});
  };

  const handleFundingRangeApply = () => {
    const min = tempFundingRange.min ? parseFloat(tempFundingRange.min) : undefined;
    const max = tempFundingRange.max ? parseFloat(tempFundingRange.max) : undefined;
    
    handleFilterChange('fundingMin', min);
    handleFilterChange('fundingMax', max);
  };

  const getActiveFilterCount = () => {
    return Object.keys(filters).length;
  };

  const formatFundingRange = (name: string): [number, number] => {
    switch (name) {
      case 'Under $10k': return [0, 9999];
      case '$10k - $50k': return [10000, 49999];
      case '$50k - $100k': return [50000, 99999];
      case 'Over $100k': return [100000, Infinity];
      default: return [0, Infinity];
    }
  };

  const toggleExpanded = (section: keyof typeof isExpanded) => {
    setIsExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Filter className="w-5 h-5 text-gray-600" />
          <h3 className="text-lg font-semibold text-gray-900">Filters</h3>
          {getActiveFilterCount() > 0 && (
            <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2 py-1 rounded-full">
              {getActiveFilterCount()}
            </span>
          )}
        </div>
        {getActiveFilterCount() > 0 && (
          <button
            onClick={handleClearAll}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Category Filter */}
      <div className="mb-6">
        <button
          onClick={() => toggleExpanded('category')}
          className="w-full flex items-center justify-between py-2 text-left hover:bg-gray-50 rounded px-2 transition-colors"
        >
          <span className="font-medium text-gray-900">Category</span>
          {isExpanded.category ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </button>
        
        {isExpanded.category && (
          <div className="mt-3 space-y-2">
            {facetCounts?.categories?.map((category) => (
              <label
                key={category.name}
                className="flex items-center justify-between py-2 px-2 hover:bg-gray-50 rounded cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="category"
                    value={category.name}
                    checked={filters.category === category.name}
                    onChange={(e) => handleFilterChange('category', e.target.value)}
                    className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">{category.name}</span>
                </div>
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                  {category.count}
                </span>
              </label>
            ))}
            
            {filters.category && (
              <div className="flex items-center gap-2 pt-2 border-t">
                <span className="text-sm text-blue-600 font-medium">
                  {filters.category}
                </span>
                <button
                  onClick={() => handleClearFilter('category')}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Status Filter */}
      <div className="mb-6">
        <button
          onClick={() => toggleExpanded('status')}
          className="w-full flex items-center justify-between py-2 text-left hover:bg-gray-50 rounded px-2 transition-colors"
        >
          <span className="font-medium text-gray-900">Status</span>
          {isExpanded.status ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </button>
        
        {isExpanded.status && (
          <div className="mt-3 space-y-2">
            {facetCounts?.statuses?.map((status) => (
              <label
                key={status.name}
                className="flex items-center justify-between py-2 px-2 hover:bg-gray-50 rounded cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="status"
                    value={status.name}
                    checked={filters.status === status.name}
                    onChange={(e) => handleFilterChange('status', e.target.value)}
                    className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 capitalize">{status.name}</span>
                </div>
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                  {status.count}
                </span>
              </label>
            ))}
            
            {filters.status && (
              <div className="flex items-center gap-2 pt-2 border-t">
                <span className="text-sm text-blue-600 font-medium capitalize">
                  {filters.status}
                </span>
                <button
                  onClick={() => handleClearFilter('status')}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Creator Filter */}
      <div className="mb-6">
        <button
          onClick={() => toggleExpanded('creator')}
          className="w-full flex items-center justify-between py-2 text-left hover:bg-gray-50 rounded px-2 transition-colors"
        >
          <span className="font-medium text-gray-900">Creator</span>
          {isExpanded.creator ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </button>
        
        {isExpanded.creator && (
          <div className="mt-3">
            <input
              type="text"
              placeholder="Search creators..."
              value={filters.creator || ''}
              onChange={(e) => handleFilterChange('creator', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
            />
            
            {facetCounts?.creators?.slice(0, 5).map((creator) => (
              <button
                key={creator.name}
                onClick={() => handleFilterChange('creator', creator.name)}
                className="w-full text-left py-2 px-2 hover:bg-gray-50 rounded text-sm text-gray-700 mt-1"
              >
                {creator.name}
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full ml-2">
                  {creator.count}
                </span>
              </button>
            ))}
            
            {filters.creator && (
              <div className="flex items-center gap-2 pt-2 border-t">
                <span className="text-sm text-blue-600 font-medium">
                  {filters.creator}
                </span>
                <button
                  onClick={() => handleClearFilter('creator')}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Funding Range Filter */}
      <div className="mb-6">
        <button
          onClick={() => toggleExpanded('funding')}
          className="w-full flex items-center justify-between py-2 text-left hover:bg-gray-50 rounded px-2 transition-colors"
        >
          <span className="font-medium text-gray-900">Funding Range</span>
          {isExpanded.funding ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </button>
        
        {isExpanded.funding && (
          <div className="mt-3 space-y-3">
            {/* Preset ranges */}
            <div className="space-y-2">
              {facetCounts?.fundingRanges?.map((range) => (
                <button
                  key={range.name}
                  onClick={() => {
                    const [min, max] = formatFundingRange(range.name);
                    handleFilterChange('fundingMin', min === 0 ? undefined : min);
                    handleFilterChange('fundingMax', max === Infinity ? undefined : max);
                  }}
                  className="w-full text-left py-2 px-2 hover:bg-gray-50 rounded text-sm text-gray-700"
                >
                  {range.name}
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full ml-2">
                    {range.count}
                  </span>
                </button>
              ))}
            </div>
            
            {/* Custom range */}
            <div className="pt-3 border-t">
              <p className="text-sm font-medium text-gray-700 mb-2">Custom Range</p>
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  placeholder="Min"
                  value={tempFundingRange.min}
                  onChange={(e) => setTempFundingRange(prev => ({ ...prev, min: e.target.value }))}
                  className="w-24 px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                />
                <span className="text-gray-500">-</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={tempFundingRange.max}
                  onChange={(e) => setTempFundingRange(prev => ({ ...prev, max: e.target.value }))}
                  className="w-24 px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                />
                <button
                  onClick={handleFundingRangeApply}
                  className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                >
                  Apply
                </button>
              </div>
            </div>
            
            {(filters.fundingMin !== undefined || filters.fundingMax !== undefined) && (
              <div className="flex items-center gap-2 pt-2 border-t">
                <span className="text-sm text-blue-600 font-medium">
                  ${filters.fundingMin?.toLocaleString() || '0'} - ${filters.fundingMax?.toLocaleString() || '∞'}
                </span>
                <button
                  onClick={() => {
                    handleClearFilter('fundingMin');
                    handleClearFilter('fundingMax');
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
        </div>
      )}
    </div>
  );
};

export default SearchFilters;
