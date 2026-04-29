/**
 * Price Chart Component
 * Displays real-time price chart for synthetic assets
 */

'use client';

import React, { useState, useEffect } from 'react';

interface PriceChartProps {
  assetSymbol: string;
  onPriceUpdate?: () => void;
}

const PriceChart: React.FC<PriceChartProps> = ({ assetSymbol, onPriceUpdate }) => {
  const [timeframe, setTimeframe] = useState<'1H' | '1D' | '1W' | '1M'>('1D');
  const [isLoading, setIsLoading] = useState(false);

  const priceChangePercent = 5.2; // Mock data
  const isPositive = priceChangePercent >= 0;

  return (
    <div className="price-chart">
      <div className="chart-header">
        <h4>{assetSymbol} Price Chart</h4>
        <div className="timeframe-buttons">
          {(['1H', '1D', '1W', '1M'] as const).map(tf => (
            <button
              key={tf}
              className={`timeframe-btn ${timeframe === tf ? 'active' : ''}`}
              onClick={() => setTimeframe(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-container">
        {isLoading ? (
          <div className="chart-loading">
            <div className="spinner" />
          </div>
        ) : (
          <div className="chart-placeholder">
            {/* In production, integrate with a charting library like TradingView or Chart.js */}
            <svg viewBox="0 0 800 400" className="price-chart-svg">
              {/* Placeholder: Simple price line */}
              <polyline
                points="0,150 100,140 200,155 300,130 400,145 500,120 600,135 700,125 800,140"
                fill="none"
                stroke="#4CAF50"
                strokeWidth="2"
              />
            </svg>
          </div>
        )}
      </div>

      <div className="chart-stats">
        <div className="stat">
          <label>24h Change</label>
          <value className={isPositive ? 'positive' : 'negative'}>
            {isPositive ? '+' : ''}{priceChangePercent.toFixed(2)}%
          </value>
        </div>
        <div className="stat">
          <label>Volume (24h)</label>
          <value>$2,456,789</value>
        </div>
        <div className="stat">
          <label>Market Cap</label>
          <value>$125,456,789</value>
        </div>
      </div>
    </div>
  );
};

export default PriceChart;
