/**
 * Hook for Synthetic Assets API calls
 * Provides functions to interact with the backend API
 */

'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';

interface ApiError {
  message: string;
  code?: string;
}

export const useSyntheticAssetsAPI = () => {
  const { token } = useAuth();
  const [error, setError] = useState<ApiError | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  const callApi = useCallback(
    async (
      method: string,
      endpoint: string,
      data?: any
    ) => {
      try {
        setIsLoading(true);
        setError(null);

        const options: RequestInit = {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
          },
        };

        if (data) {
          options.body = JSON.stringify(data);
        }

        const response = await fetch(
          `${apiUrl}/v1/synthetic-assets${endpoint}`,
          options
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `API error: ${response.status}`);
        }

        return await response.json();
      } catch (err) {
        const apiError = {
          message: err instanceof Error ? err.message : 'Unknown error',
        };
        setError(apiError);
        throw apiError;
      } finally {
        setIsLoading(false);
      }
    },
    [token, apiUrl]
  );

  return {
    isLoading,
    error,
    
    // Asset Management
    registerAsset: (asset: any) =>
      callApi('POST', '/register', asset),
    
    // Minting & Burning
    mintSynthetic: (data: {
      assetSymbol: string;
      collateralAmount: number;
      mintAmount: number;
    }) =>
      callApi('POST', '/mint', {
        userAddress: 'current-user', // Will be resolved from wallet
        ...data,
      }),
    
    burnSynthetic: (data: {
      positionId: number;
      burnAmount: number;
    }) =>
      callApi('POST', '/burn', {
        userAddress: 'current-user',
        ...data,
      }),
    
    addCollateral: (data: {
      positionId: number;
      additionalCollateral: number;
    }) =>
      callApi('POST', '/add-collateral', {
        userAddress: 'current-user',
        ...data,
      }),
    
    // Trading
    openTrade: (data: {
      assetSymbol: string;
      direction: string;
      margin: number;
      leverage: number;
    }) =>
      callApi('POST', '/open-trade', {
        userAddress: 'current-user',
        ...data,
      }),
    
    closeTrade: (positionId: number) =>
      callApi('POST', '/close-trade', {
        userAddress: 'current-user',
        positionId,
      }),
    
    updatePrice: (data: {
      assetSymbol: string;
      newPrice: number;
      confidence: number;
    }) =>
      callApi('POST', '/price', data),
    
    // Queries
    getPosition: (positionId: number) =>
      callApi('GET', `/position/${positionId}`),
    
    getTradingPosition: (positionId: number) =>
      callApi('GET', `/trade/${positionId}`),
    
    getAssetPrice: (symbol: string) =>
      callApi('GET', `/price/${symbol}`),
    
    getCollateralRatio: (positionId: number) =>
      callApi('GET', `/ratio/${positionId}`),
    
    getHealthFactor: (positionId: number) =>
      callApi('GET', `/health/${positionId}`),
    
    isLiquidatable: (positionId: number) =>
      callApi('GET', `/liquidatable/${positionId}`),
    
    getProtocolParams: () =>
      callApi('GET', '/params'),
    
    getRegisteredAssets: () =>
      callApi('GET', '/assets'),
    
    getMaxMintable: (assetSymbol: string, collateralAmount: number) =>
      callApi('GET', `/max-mintable?assetSymbol=${assetSymbol}&collateralAmount=${collateralAmount}`),
    
    getTradingPnL: (positionId: number) =>
      callApi('GET', `/pnl/${positionId}`),
  };
};

export default useSyntheticAssetsAPI;
