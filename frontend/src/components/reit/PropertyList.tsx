'use client';

import React, { useState, useEffect } from 'react';
import { reitApi, Property } from '@/services/reitService';
import { Card } from './Card';
import { LoadingSpinner } from './LoadingSpinner';
import { useWallet } from '@/hooks/useWallet';

interface PropertyListProps {
  contractId: string;
}

export function PropertyList({ contractId }: PropertyListProps) {
  const { publicKey, isConnected } = useWallet();
  const [properties, setProperties] = useState<Property[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filter, setFilter] = useState<string>('all');
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [buyShares, setBuyShares] = useState<number>(1);
  const [isBuying, setIsBuying] = useState(false);

  useEffect(() => {
    loadProperties();
  }, [contractId, currentPage, filter]);

  const loadProperties = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const status = filter !== 'all' ? filter : undefined;
      const result = await reitApi.getProperties(
        contractId,
        { status },
        { page: currentPage, limit: 12 }
      );

      setProperties(result.data);
      setTotalPages(result.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load properties');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBuyShares = async () => {
    if (!publicKey || !selectedProperty) return;

    try {
      setIsBuying(true);
      await reitApi.buyShares(contractId, publicKey, selectedProperty.property_id, buyShares);
      alert(`Purchase request submitted for ${buyShares} shares`);
      setSelectedProperty(null);
      setBuyShares(1);
      loadProperties();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to buy shares');
    } finally {
      setIsBuying(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Listed': return 'bg-blue-100 text-blue-800';
      case 'Funded': return 'bg-yellow-100 text-yellow-800';
      case 'Active': return 'bg-green-100 text-green-800';
      case 'Suspended': return 'bg-red-100 text-red-800';
      case 'Delisted': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <p className="text-red-600">{error}</p>
        <button
          onClick={loadProperties}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Retry
        </button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {['all', 'Listed', 'Active', 'Funded'].map((status) => (
          <button
            key={status}
            onClick={() => {
              setFilter(status);
              setCurrentPage(1);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === status
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {status === 'all' ? 'All Properties' : status}
          </button>
        ))}
      </div>

      {/* Property Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {properties.map((property) => (
          <Card key={property.id} className="p-4 hover:shadow-lg transition-shadow">
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-semibold text-lg truncate">{property.name}</h3>
              <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(property.status)}`}>
                {property.status}
              </span>
            </div>
            
            <p className="text-gray-500 text-sm mb-2">{property.location}</p>
            
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Price per Share:</span>
                <span className="font-medium">{(property.price_per_share / 10000000).toFixed(2)} XLM</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Total Shares:</span>
                <span className="font-medium">{property.total_shares.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Shares Sold:</span>
                <span className="font-medium">{property.shares_sold.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Target Yield:</span>
                <span className="font-medium">{(property.target_yield_bps / 100).toFixed(2)}%</span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-3">
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full"
                  style={{ width: `${(property.shares_sold / property.total_shares) * 100}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {((property.shares_sold / property.total_shares) * 100).toFixed(1)}% funded
              </p>
            </div>

            {/* Action Button */}
            {property.status === 'Listed' && isConnected && (
              <button
                onClick={() => setSelectedProperty(property)}
                className="mt-4 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Buy Shares
              </button>
            )}
          </Card>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-4 py-2 rounded-lg bg-gray-100 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-4 py-2">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-4 py-2 rounded-lg bg-gray-100 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {/* Buy Modal */}
      {selectedProperty && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Buy Shares - {selectedProperty.name}</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Number of Shares
                </label>
                <input
                  type="number"
                  min={1}
                  max={selectedProperty.total_shares - selectedProperty.shares_sold}
                  value={buyShares}
                  onChange={(e) => setBuyShares(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 border rounded-lg"
                />
                <p className="text-sm text-gray-500 mt-1">
                  Available: {selectedProperty.total_shares - selectedProperty.shares_sold} shares
                </p>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between mb-2">
                  <span>Price per share:</span>
                  <span>{(selectedProperty.price_per_share / 10000000).toFixed(2)} XLM</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Total Cost:</span>
                  <span>{((buyShares * selectedProperty.price_per_share) / 10000000).toFixed(2)} XLM</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setSelectedProperty(null)}
                className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleBuyShares}
                disabled={isBuying}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {isBuying ? 'Processing...' : 'Confirm Purchase'}
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
