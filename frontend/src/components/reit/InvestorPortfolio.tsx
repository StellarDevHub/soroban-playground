'use client';

import React, { useState, useEffect } from 'react';
import { reitApi, Ownership, Portfolio } from '@/services/reitService';
import { Card } from './Card';
import { LoadingSpinner } from './LoadingSpinner';

interface InvestorPortfolioProps {
  contractId: string;
  investorAddress: string;
}

export function InvestorPortfolio({ contractId, investorAddress }: InvestorPortfolioProps) {
  const [properties, setProperties] = useState<Ownership[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [claimableData, setClaimableData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimingProperty, setClaimingProperty] = useState<number | null>(null);

  useEffect(() => {
    loadPortfolio();
  }, [contractId, investorAddress]);

  const loadPortfolio = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [propertiesData, claimable] = await Promise.all([
        reitApi.getInvestorProperties(contractId, investorAddress),
        reitApi.getClaimableDividends(contractId, investorAddress),
      ]);

      setProperties(propertiesData.properties);
      setPortfolio(propertiesData.portfolio_summary);
      setClaimableData(claimable);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load portfolio');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClaimDividends = async (propertyId: number) => {
    try {
      setClaimingProperty(propertyId);
      await reitApi.claimDividends(contractId, investorAddress, propertyId);
      alert('Dividend claim request submitted');
      loadPortfolio();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to claim dividends');
    } finally {
      setClaimingProperty(null);
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
          onClick={loadPortfolio}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Retry
        </button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Portfolio Summary */}
      {portfolio && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <p className="text-sm text-gray-500">Properties</p>
            <p className="text-2xl font-bold">{portfolio.property_count}</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-gray-500">Total Shares</p>
            <p className="text-2xl font-bold">{portfolio.total_shares.toLocaleString()}</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-gray-500">Portfolio Value</p>
            <p className="text-2xl font-bold">{(portfolio.portfolio_value / 10000000).toFixed(2)} XLM</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-gray-500">Claimable Dividends</p>
            <p className="text-2xl font-bold text-green-600">
              {((claimableData?.total_claimable || 0) / 10000000).toFixed(2)} XLM
            </p>
          </Card>
        </div>
      )}

      {/* Properties Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Property</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Shares</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Value</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Dividends Claimed</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {properties.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No investments yet. Browse properties to start investing.
                  </td>
                </tr>
              ) : (
                properties.map((prop) => {
                  const claimable = claimableData?.by_property.find(
                    (p: any) => p.property_id === prop.property_id
                  )?.claimable_amount || 0;

                  return (
                    <tr key={prop.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium">{prop.name}</p>
                          <p className="text-sm text-gray-500">{prop.location}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">{prop.shares.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">
                        {((prop.shares * (prop.price_per_share || 0)) / 10000000).toFixed(2)} XLM
                      </td>
                      <td className="px-4 py-3 text-right">
                        {(prop.dividend_claimed / 10000000).toFixed(2)} XLM
                      </td>
                      <td className="px-4 py-3 text-center">
                        {claimable > 0 ? (
                          <button
                            onClick={() => handleClaimDividends(prop.property_id)}
                            disabled={claimingProperty === prop.property_id}
                            className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
                          >
                            {claimingProperty === prop.property_id
                              ? 'Claiming...'
                              : `Claim ${(claimable / 10000000).toFixed(2)} XLM`}
                          </button>
                        ) : (
                          <span className="text-sm text-gray-400">No dividends</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
