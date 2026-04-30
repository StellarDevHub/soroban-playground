/**
 * Asset Overview Component
 * Displays asset information and key metrics
 */

'use client';

import React from 'react';

interface Asset {
  symbol: string;
  name: string;
  decimals: number;
  totalSupply: number;
}

interface AssetOverviewProps {
  asset?: Asset;
  price?: number;
}

const AssetOverview: React.FC<AssetOverviewProps> = ({ asset, price }) => {
  if (!asset) {
    return <div className="asset-overview loading">Select an asset to view details</div>;
  }

  const formattedPrice = price ? (price / 100000000).toFixed(8) : '—';
  const formattedSupply = asset.totalSupply / Math.pow(10, asset.decimals);

  return (
    <div className="asset-overview">
      <div className="overview-header">
        <div className="asset-title">
          <h2>{asset.symbol}</h2>
          <p>{asset.name}</p>
        </div>
        <div className="price-display">
          <div className="price-value">${formattedPrice}</div>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric">
          <label>Total Supply</label>
          <value>{formattedSupply.toFixed(2)}</value>
        </div>
        <div className="metric">
          <label>Decimals</label>
          <value>{asset.decimals}</value>
        </div>
        <div className="metric">
          <label>Last Updated</label>
          <value>{new Date().toLocaleTimeString()}</value>
        </div>
      </div>

      <div className="asset-description">
        <p>
          This synthetic asset is backed by collateral and can be traded on the Stellar network.
          Manage your positions using the controls above.
        </p>
      </div>
    </div>
  );
};

export default AssetOverview;
