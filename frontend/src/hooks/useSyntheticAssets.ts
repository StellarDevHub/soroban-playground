/**
 * Hook for managing Synthetic Assets state
 * Handles data fetching and caching for frontend
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSyntheticAssetsAPI } from './useSyntheticAssetsAPI';

export interface Asset {
  symbol: string;
  name: string;
  decimals: number;
  totalSupply: number;
}

export interface Position {
  positionId: number;
  userAddress: string;
  assetSymbol: string;
  collateralAmount: number;
  mintedAmount: number;
  createdAt: string;
  healthFactor: number;
  ratio: number;
  status: 'OPEN' | 'CLOSED' | 'LIQUIDATED';
}

export interface ProtocolParams {
  minCollateralRatio: number;
  liquidationThreshold: number;
  liquidationBonus: number;
  feePercentage: number;
}

export const useSyntheticAssets = (userAddress?: string) => {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [protocolParams, setProtocolParams] = useState<ProtocolParams | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    getRegisteredAssets,
    getAssetPrice,
    getPosition,
    getProtocolParams,
  } = useSyntheticAssetsAPI();

  const refreshAssets = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await getRegisteredAssets();
      if (response.success && Array.isArray(response.data)) {
        // Fetch full asset details
        const assetDetails = response.data.map((symbol: string) => ({
          symbol,
          name: `Synthetic ${symbol.substring(1)}`,
          decimals: 8,
          totalSupply: 0,
        }));
        setAssets(assetDetails);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch assets');
    } finally {
      setIsLoading(false);
    }
  }, [getRegisteredAssets]);

  const refreshPrices = useCallback(async () => {
    try {
      const priceData: Record<string, number> = {};
      for (const asset of assets) {
        try {
          const response = await getAssetPrice(asset.symbol);
          if (response.success) {
            priceData[asset.symbol] = response.data.price;
          }
        } catch (err) {
          console.error(`Failed to fetch price for ${asset.symbol}:`, err);
        }
      }
      setPrices(priceData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch prices');
    }
  }, [assets, getAssetPrice]);

  const refreshPositions = useCallback(async () => {
    if (!userAddress) return;

    try {
      setIsLoading(true);
      // In a real implementation, you would fetch user positions from the API
      // For now, we'll just clear them
      setPositions([]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch positions');
    } finally {
      setIsLoading(false);
    }
  }, [userAddress]);

  const refreshProtocolParams = useCallback(async () => {
    try {
      const response = await getProtocolParams();
      if (response.success) {
        setProtocolParams(response.data);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch protocol params');
    }
  }, [getProtocolParams]);

  return {
    assets,
    positions,
    prices,
    protocolParams,
    isLoading,
    error,
    refreshAssets,
    refreshPrices,
    refreshPositions,
    refreshProtocolParams,
  };
};

export default useSyntheticAssets;
