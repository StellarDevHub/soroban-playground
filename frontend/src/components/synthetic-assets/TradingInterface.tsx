/**
 * Trading Interface Component
 * Allows users to open and manage leveraged trading positions
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useSyntheticAssetsAPI } from '@/hooks/useSyntheticAssetsAPI';

type TradeDirection = 'Long' | 'Short';

interface ProtocolParams {
  minCollateralRatio: number;
  liquidationThreshold: number;
  liquidationBonus: number;
  feePercentage: number;
}

interface TradingInterfaceProps {
  assetSymbol: string;
  userAddress: string;
  currentPrice?: number;
  protocolParams?: ProtocolParams;
  onTradeOpen: () => void;
}

const TradingInterface: React.FC<TradingInterfaceProps> = ({
  assetSymbol,
  userAddress,
  currentPrice,
  protocolParams,
  onTradeOpen,
}) => {
  const [direction, setDirection] = useState<TradeDirection>('Long');
  const [margin, setMargin] = useState('');
  const [leverage, setLeverage] = useState('2');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [liquidationPrice, setLiquidationPrice] = useState<number | null>(null);

  const { openTrade } = useSyntheticAssetsAPI();

  // Calculate liquidation price based on margin and leverage
  useEffect(() => {
    if (currentPrice && margin) {
      const leverageMultiplier = parseInt(leverage) / 10000;
      const marginRatio = (parseInt(margin) / (parseInt(margin) * leverageMultiplier)) * 100;
      
      if (direction === 'Long') {
        const liqPrice = currentPrice - (currentPrice * marginRatio / 100);
        setLiquidationPrice(liqPrice);
      } else {
        const liqPrice = currentPrice + (currentPrice * marginRatio / 100);
        setLiquidationPrice(liqPrice);
      }
    }
  }, [currentPrice, margin, leverage, direction]);

  const handleOpenTrade = async () => {
    try {
      setIsSubmitting(true);
      setError(null);

      if (!margin || !leverage) {
        setError('Please enter margin and leverage');
        return;
      }

      await openTrade({
        assetSymbol,
        direction,
        margin: parseInt(margin),
        leverage: parseInt(leverage),
      });

      setSuccess('Trade opened successfully');
      setMargin('');
      setLeverage('2');
      onTradeOpen();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open trade');
    } finally {
      setIsSubmitting(false);
    }
  };

  const notionalValue = margin ? parseInt(margin) * (parseInt(leverage) / 10000) : 0;
  const fee = notionalValue * (protocolParams?.feePercentage || 0) / 10000;

  return (
    <div className="trading-interface">
      <div className="trading-form">
        <h3>Open Trading Position</h3>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {/* Direction Selection */}
        <div className="direction-selector">
          <button
            className={`direction-btn ${direction === 'Long' ? 'active long' : ''}`}
            onClick={() => setDirection('Long')}
          >
            📈 Long
          </button>
          <button
            className={`direction-btn ${direction === 'Short' ? 'active short' : ''}`}
            onClick={() => setDirection('Short')}
          >
            📉 Short
          </button>
        </div>

        {/* Margin Input */}
        <div className="form-group">
          <label>Margin (USD)</label>
          <input
            type="number"
            value={margin}
            onChange={e => setMargin(e.target.value)}
            placeholder="0.00"
            min="0"
          />
          <small>Minimum: $250</small>
        </div>

        {/* Leverage Slider */}
        <div className="form-group">
          <label>Leverage: {(parseInt(leverage) / 10000).toFixed(1)}x</label>
          <input
            type="range"
            value={leverage}
            onChange={e => setLeverage(e.target.value)}
            min="10000"
            max="100000"
            step="5000"
            className="leverage-slider"
          />
          <div className="leverage-values">
            <span>1x</span>
            <span>10x</span>
          </div>
        </div>

        {/* Trading Calculations */}
        <div className="trading-calcs">
          <div className="calc-item">
            <label>Current Price</label>
            <value>${currentPrice ? (currentPrice / 100000000).toFixed(8) : '—'}</value>
          </div>
          <div className="calc-item">
            <label>Notional Value</label>
            <value>${(notionalValue / 100).toFixed(2)}</value>
          </div>
          <div className="calc-item">
            <label>Trading Fee (1%)</label>
            <value>${(fee / 100).toFixed(2)}</value>
          </div>
          <div className="calc-item">
            <label>Liquidation Price</label>
            <value className={direction === 'Long' ? 'danger' : 'success'}>
              ${liquidationPrice ? (liquidationPrice / 100000000).toFixed(8) : '—'}
            </value>
          </div>
        </div>

        {/* Risk Warning */}
        <div className="risk-warning">
          <strong>⚠️ Risk Warning:</strong>
          <p>
            {direction === 'Long'
              ? `Your position will be liquidated if ${assetSymbol} falls below $${liquidationPrice ? (liquidationPrice / 100000000).toFixed(8) : '—'}`
              : `Your position will be liquidated if ${assetSymbol} rises above $${liquidationPrice ? (liquidationPrice / 100000000).toFixed(8) : '—'}`}
          </p>
        </div>

        <button
          className="btn btn-primary btn-large"
          onClick={handleOpenTrade}
          disabled={isSubmitting || !margin || !leverage}
        >
          {isSubmitting ? 'Opening...' : `Open ${direction} Position`}
        </button>
      </div>

      {/* Info Panel */}
      <div className="trading-info">
        <h4>How Leverage Works</h4>
        <div className="info-item">
          <strong>Long Position</strong>
          <p>You profit when the price goes up and lose when it goes down.</p>
        </div>
        <div className="info-item">
          <strong>Short Position</strong>
          <p>You profit when the price goes down and lose when it goes up.</p>
        </div>
        <div className="info-item">
          <strong>Liquidation</strong>
          <p>
            If your position's losses exceed your margin, it will be automatically liquidated
            to prevent further losses.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TradingInterface;
