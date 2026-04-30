/**
 * Synthetic Assets Dashboard
 * 
 * Main component for the synthetic assets interface
 * Features:
 * - Asset overview and price tracking
 * - Position management (mint, burn, collateral)
 * - Trading interface (long/short positions)
 * - Real-time price updates via WebSocket
 * - Liquidation monitoring
 * - Analytics and history
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useSyntheticAssets } from '@/hooks/useSyntheticAssets';
import AssetOverview from '@/components/synthetic-assets/AssetOverview';
import PositionManager from '@/components/synthetic-assets/PositionManager';
import TradingInterface from '@/components/synthetic-assets/TradingInterface';
import PriceChart from '@/components/synthetic-assets/PriceChart';
import LiquidationMonitor from '@/components/synthetic-assets/LiquidationMonitor';
import ProtocolStats from '@/components/synthetic-assets/ProtocolStats';
import './SyntheticAssetsDashboard.module.css';

interface SyntheticAssetsDashboardProps {
  userAddress?: string;
}

const SyntheticAssetsDashboard: React.FC<SyntheticAssetsDashboardProps> = ({
  userAddress,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'positions' | 'trading' | 'analytics'>('overview');
  const [selectedAsset, setSelectedAsset] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // WebSocket for real-time updates
  const { data: wsData, subscribe, unsubscribe } = useWebSocket();

  // Synthetic assets API hooks
  const {
    assets,
    positions,
    prices,
    protocolParams,
    refreshAssets,
    refreshPositions,
    refreshPrices,
    refreshProtocolParams,
  } = useSyntheticAssets(userAddress);

  // Subscribe to price updates on component mount
  useEffect(() => {
    if (selectedAsset) {
      subscribe(`price:${selectedAsset}`);
      return () => unsubscribe(`price:${selectedAsset}`);
    }
  }, [selectedAsset, subscribe, unsubscribe]);

  // Handle WebSocket price updates
  useEffect(() => {
    if (wsData?.type === 'price_update') {
      refreshPrices();
    } else if (wsData?.type === 'liquidation_alert') {
      setError(`Position ${wsData.positionId} is liquidatable`);
      refreshPositions();
    }
  }, [wsData, refreshPrices, refreshPositions]);

  // Initial data load
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        await Promise.all([
          refreshAssets(),
          refreshPrices(),
          refreshProtocolParams(),
          userAddress && refreshPositions(),
        ]);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();

    // Set up refresh interval
    const interval = setInterval(loadData, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, [userAddress, refreshAssets, refreshPrices, refreshProtocolParams, refreshPositions]);

  // Auto-select first asset
  useEffect(() => {
    if (assets.length > 0 && !selectedAsset) {
      setSelectedAsset(assets[0].symbol);
    }
  }, [assets, selectedAsset]);

  const handleAssetChange = (assetSymbol: string) => {
    setSelectedAsset(assetSymbol);
    setActiveTab('overview');
  };

  return (
    <div className="synthetic-assets-dashboard">
      <header className="dashboard-header">
        <div className="header-content">
          <h1>Synthetic Assets</h1>
          <p className="subtitle">Create, trade, and manage synthetic assets</p>
        </div>

        <div className="header-actions">
          {userAddress && (
            <div className="user-info">
              <span className="address">{userAddress.slice(0, 6)}...{userAddress.slice(-4)}</span>
            </div>
          )}
          <button
            className="refresh-btn"
            onClick={() => {
              setIsLoading(true);
              Promise.all([
                refreshAssets(),
                refreshPositions(),
                refreshPrices(),
                refreshProtocolParams(),
              ]).finally(() => setIsLoading(false));
            }}
            disabled={isLoading}
          >
            ↻ Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="dashboard-content">
        {/* Asset Selector */}
        <aside className="asset-sidebar">
          <div className="asset-selector">
            <h3>Assets</h3>
            <div className="asset-list">
              {assets.map(asset => (
                <button
                  key={asset.symbol}
                  className={`asset-item ${selectedAsset === asset.symbol ? 'active' : ''}`}
                  onClick={() => handleAssetChange(asset.symbol)}
                >
                  <div className="asset-name">
                    <strong>{asset.symbol}</strong>
                    <small>{asset.name}</small>
                  </div>
                  {prices[asset.symbol] && (
                    <div className="asset-price">
                      ${(prices[asset.symbol] / 100000000).toFixed(2)}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Protocol Stats */}
          {protocolParams && (
            <div className="protocol-stats">
              <h4>Protocol</h4>
              <ProtocolStats params={protocolParams} />
            </div>
          )}
        </aside>

        {/* Main Content */}
        <main className="dashboard-main">
          {/* Tabs */}
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              Overview
            </button>
            <button
              className={`tab ${activeTab === 'positions' ? 'active' : ''}`}
              onClick={() => setActiveTab('positions')}
              disabled={!userAddress}
            >
              Positions
            </button>
            <button
              className={`tab ${activeTab === 'trading' ? 'active' : ''}`}
              onClick={() => setActiveTab('trading')}
              disabled={!userAddress}
            >
              Trading
            </button>
            <button
              className={`tab ${activeTab === 'analytics' ? 'active' : ''}`}
              onClick={() => setActiveTab('analytics')}
            >
              Analytics
            </button>
          </div>

          {/* Tab Content */}
          <div className="tab-content">
            {isLoading ? (
              <div className="loading">
                <div className="spinner" />
                <p>Loading...</p>
              </div>
            ) : (
              <>
                {activeTab === 'overview' && selectedAsset && (
                  <div className="overview-content">
                    <AssetOverview
                      asset={assets.find(a => a.symbol === selectedAsset)}
                      price={prices[selectedAsset]}
                    />
                    <PriceChart
                      assetSymbol={selectedAsset}
                      onPriceUpdate={() => refreshPrices()}
                    />
                  </div>
                )}

                {activeTab === 'positions' && userAddress && (
                  <div className="positions-content">
                    <PositionManager
                      positions={positions}
                      selectedAsset={selectedAsset}
                      onPositionUpdate={() => refreshPositions()}
                      prices={prices}
                      protocolParams={protocolParams}
                    />
                  </div>
                )}

                {activeTab === 'trading' && userAddress && selectedAsset && (
                  <div className="trading-content">
                    <TradingInterface
                      assetSymbol={selectedAsset}
                      userAddress={userAddress}
                      currentPrice={prices[selectedAsset]}
                      onTradeOpen={() => refreshPositions()}
                      protocolParams={protocolParams}
                    />
                  </div>
                )}

                {activeTab === 'analytics' && (
                  <div className="analytics-content">
                    <LiquidationMonitor
                      positions={positions}
                      prices={prices}
                      protocolParams={protocolParams}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default SyntheticAssetsDashboard;
