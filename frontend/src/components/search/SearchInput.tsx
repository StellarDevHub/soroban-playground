import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Clock, TrendingUp } from 'lucide-react';
import searchService from '../../services/searchService';

interface SearchInputProps {
  onSearch: (query: string) => void;
  placeholder?: string;
  className?: string;
  initialValue?: string;
}

interface AutocompleteSuggestion {
  suggestion: string;
  type: 'title' | 'category' | 'creator';
  total_matches: number;
}

const SearchInput: React.FC<SearchInputProps> = ({
  onSearch,
  placeholder = 'Search projects...',
  className = '',
  initialValue = ''
}) => {
  const [query, setQuery] = useState(initialValue);
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [popularSearches, setPopularSearches] = useState<string[]>([]);
  const [showPopular, setShowPopular] = useState(false);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  // Load popular searches on mount
  useEffect(() => {
    loadPopularSearches();
  }, []);

  // Debounced autocomplete
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.length >= 2) {
      debounceRef.current = setTimeout(() => {
        fetchSuggestions(query);
      }, 200); // 200ms debounce for performance
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        !inputRef.current?.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
        setShowPopular(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadPopularSearches = async () => {
    try {
      const popular = await searchService.getPopularSearches(5);
      setPopularSearches(popular.map((p: any) => p.query));
    } catch (error) {
      console.error('Failed to load popular searches:', error);
    }
  };

  const fetchSuggestions = async (searchQuery: string) => {
    if (searchQuery.length < 2) return;

    setIsLoading(true);
    try {
      const results = await searchService.getAutocompleteSuggestions(searchQuery, 8);
      setSuggestions(results);
      setShowSuggestions(true);
      setShowPopular(false);
    } catch (error) {
      console.error('Failed to fetch suggestions:', error);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    
    if (value.length === 0) {
      setShowSuggestions(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim());
      setShowSuggestions(false);
      setShowPopular(false);
      inputRef.current?.blur();
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setQuery(suggestion);
    onSearch(suggestion);
    setShowSuggestions(false);
    setShowPopular(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowSuggestions(false);
      setShowPopular(false);
      inputRef.current?.blur();
    }
  };

  const handleClear = () => {
    setQuery('');
    setSuggestions([]);
    setShowSuggestions(false);
    setShowPopular(false);
    inputRef.current?.focus();
  };

  const handleInputFocus = () => {
    if (query.length === 0 && popularSearches.length > 0) {
      setShowPopular(true);
    } else if (query.length >= 2) {
      setShowSuggestions(true);
    }
  };

  const getSuggestionIcon = (type: string) => {
    switch (type) {
      case 'title':
        return <Search className="w-4 h-4 text-blue-500" />;
      case 'category':
        return <TrendingUp className="w-4 h-4 text-green-500" />;
      case 'creator':
        return <Clock className="w-4 h-4 text-purple-500" />;
      default:
        return <Search className="w-4 h-4 text-gray-500" />;
    }
  };

  const highlightMatch = (text: string, query: string) => {
    if (!query) return text;
    
    const regex = new RegExp(`(${query})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, index) => 
      regex.test(part) ? (
        <span key={index} className="font-semibold text-blue-600 bg-blue-50">
          {part}
        </span>
      ) : (
        <span key={index}>{part}</span>
      )
    );
  };

  return (
    <div className={`relative ${className}`}>
      <form onSubmit={handleSubmit} className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={handleInputFocus}
            placeholder={placeholder}
            className="w-full pl-10 pr-10 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
          />
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </form>

      {/* Autocomplete Suggestions */}
      {showSuggestions && (
        <div
          ref={suggestionsRef}
          className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto"
        >
          {isLoading ? (
            <div className="p-4 text-center text-gray-500">
              <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
            </div>
          ) : suggestions.length > 0 ? (
            <div className="py-2">
              {suggestions.map((suggestion, index) => (
                <button
                  key={index}
                  onClick={() => handleSuggestionClick(suggestion.suggestion)}
                  className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center gap-3 transition-colors duration-150"
                >
                  {getSuggestionIcon(suggestion.type)}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {highlightMatch(suggestion.suggestion, query)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {suggestion.type} • {suggestion.total_matches} results
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : query.length >= 2 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              No suggestions found
            </div>
          ) : null}
        </div>
      )}

      {/* Popular Searches */}
      {showPopular && !showSuggestions && popularSearches.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50"
        >
          <div className="p-3 border-b border-gray-100">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <TrendingUp className="w-4 h-4" />
              Popular Searches
            </div>
          </div>
          <div className="py-2">
            {popularSearches.map((search, index) => (
              <button
                key={index}
                onClick={() => handleSuggestionClick(search)}
                className="w-full px-4 py-2 text-left hover:bg-gray-50 text-sm text-gray-700 transition-colors duration-150"
              >
                {search}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchInput;
