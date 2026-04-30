/**
 * Position Manager Component
 * Allows users to manage collateral positions and mint/burn synthetic assets
 */

'use client';

import React, { useState } from 'react';
import { useSyntheticAssetsAPI } from '@/hooks/useSyntheticAssetsAPI';

interface Position {
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

interface ProtocolParams {
  minCollateralRatio: number;
  liquidationThreshold: number;
  liquidationBonus: number;
  feePercentage: number;
}

interface PositionManagerProps {
  positions: Position[];
  selectedAsset: string;
  prices: Record<string, number>;
  protocolParams?: ProtocolParams;
  onPositionUpdate: () => void;
}

const PositionManager: React.FC<PositionManagerProps> = ({
  positions,
  selectedAsset,
  prices,
  protocolParams,
  onPositionUpdate,
}) => {
  const [activeTab, setActiveTab] = useState<'mint' | 'burn' | 'collateral'>('mint');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state for mint
  const [mintCollateral, setMintCollateral] = useState('');
  const [mintAmount, setMintAmount] = useState('');

  // Form state for burn
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);
  const [burnAmount, setBurnAmount] = useState('');

  // Form state for collateral
  const [additionalCollateral, setAdditionalCollateral] = useState('');

  const { mintSynthetic, burnSynthetic, addCollateral, getMaxMintable } =
    useSyntheticAssetsAPI();

  const assetPositions = positions.filter(p => p.assetSymbol === selectedAsset && p.status === 'OPEN');
  const price = prices[selectedAsset];

  const handleMint = async () => {
    try {
      setIsSubmitting(true);
      setError(null);
      const collateral = parseInt(mintCollateral);
      const amount = parseInt(mintAmount);

      if (!collateral || !amount) {
        setError('Please enter valid amounts');
        return;
      }

      await mintSynthetic({
        assetSymbol: selectedAsset,
        collateralAmount: collateral,
        mintAmount: amount,
      });

      setSuccess('Position minted successfully');
      setMintCollateral('');
      setMintAmount('');
      onPositionUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mint');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBurn = async () => {
    try {
      setIsSubmitting(true);
      setError(null);

      if (!selectedPosition || !burnAmount) {
        setError('Please select a position and amount');
        return;
      }

      await burnSynthetic({
        positionId: selectedPosition,
        burnAmount: parseInt(burnAmount),
      });

      setSuccess('Synthetic assets burned successfully');
      setBurnAmount('');
      setSelectedPosition(null);
      onPositionUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to burn');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddCollateral = async () => {
    try {
      setIsSubmitting(true);
      setError(null);

      if (!selectedPosition || !additionalCollateral) {
        setError('Please select a position and amount');
        return;
      }

      await addCollateral({
        positionId: selectedPosition,
        additionalCollateral: parseInt(additionalCollateral),
      });

      setSuccess('Collateral added successfully');
      setAdditionalCollateral('');
      onPositionUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add collateral');
    } finally {
      setIsSubmitting(false);
    }
  };

  const calculateMaxMint = () => {
    if (!price || !mintCollateral) return 0;
    if (!protocolParams) return 0;
    const ratio = protocolParams.minCollateralRatio / 10000;
    return parseInt(mintCollateral) / (price / 100000000) / ratio;
  };

  return (
    <div className="position-manager">
      <div className="manager-tabs">
        <button
          className={`tab ${activeTab === 'mint' ? 'active' : ''}`}
          onClick={() => setActiveTab('mint')}
        >
          Mint
        </button>
        <button
          className={`tab ${activeTab === 'burn' ? 'active' : ''}`}
          onClick={() => setActiveTab('burn')}
          disabled={assetPositions.length === 0}
        >
          Burn
        </button>
        <button
          className={`tab ${activeTab === 'collateral' ? 'active' : ''}`}
          onClick={() => setActiveTab('collateral')}
          disabled={assetPositions.length === 0}
        >
          Add Collateral
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Mint Tab */}
      {activeTab === 'mint' && (
        <div className="form-section">
          <h3>Mint Synthetic Assets</h3>
          <div className="form-group">
            <label>Collateral Amount ({selectedAsset})</label>
            <input
              type="number"
              value={mintCollateral}
              onChange={e => setMintCollateral(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="form-group">
            <label>Amount to Mint</label>
            <input
              type="number"
              value={mintAmount}
              onChange={e => setMintAmount(e.target.value)}
              placeholder="0.00"
            />
            <small>Max: {calculateMaxMint().toFixed(2)}</small>
          </div>

          <div className="form-info">
            <p>
              Collateral Ratio:{' '}
              <strong>
                {mintCollateral && mintAmount && price
                  ? ((parseInt(mintCollateral) / (parseInt(mintAmount) * price / 100000000)) * 100).toFixed(1)
                  : '—'}
                %
              </strong>
            </p>
          </div>

          <button
            className="btn btn-primary"
            onClick={handleMint}
            disabled={isSubmitting || !mintCollateral || !mintAmount}
          >
            {isSubmitting ? 'Submitting...' : 'Mint'}
          </button>
        </div>
      )}

      {/* Burn Tab */}
      {activeTab === 'burn' && (
        <div className="form-section">
          <h3>Burn Synthetic Assets</h3>

          <div className="form-group">
            <label>Position</label>
            <select
              value={selectedPosition || ''}
              onChange={e => setSelectedPosition(e.target.value ? parseInt(e.target.value) : null)}
            >
              <option value="">Select a position...</option>
              {assetPositions.map(position => (
                <option key={position.positionId} value={position.positionId}>
                  Position {position.positionId} - {position.mintedAmount / 10 ** 8} {selectedAsset}
                </option>
              ))}
            </select>
          </div>

          {selectedPosition && (
            <div className="form-group">
              <label>Amount to Burn</label>
              <input
                type="number"
                value={burnAmount}
                onChange={e => setBurnAmount(e.target.value)}
                placeholder="0.00"
              />
              <small>
                Available:{' '}
                {assetPositions
                  .find(p => p.positionId === selectedPosition)
                  ?.mintedAmount.toFixed(2)}
              </small>
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={handleBurn}
            disabled={isSubmitting || !selectedPosition || !burnAmount}
          >
            {isSubmitting ? 'Submitting...' : 'Burn'}
          </button>
        </div>
      )}

      {/* Collateral Tab */}
      {activeTab === 'collateral' && (
        <div className="form-section">
          <h3>Add Collateral</h3>

          <div className="form-group">
            <label>Position</label>
            <select
              value={selectedPosition || ''}
              onChange={e => setSelectedPosition(e.target.value ? parseInt(e.target.value) : null)}
            >
              <option value="">Select a position...</option>
              {assetPositions.map(position => (
                <option key={position.positionId} value={position.positionId}>
                  Position {position.positionId} - Ratio: {(position.ratio / 100).toFixed(1)}%
                </option>
              ))}
            </select>
          </div>

          {selectedPosition && (
            <div className="form-group">
              <label>Additional Collateral</label>
              <input
                type="number"
                value={additionalCollateral}
                onChange={e => setAdditionalCollateral(e.target.value)}
                placeholder="0.00"
              />
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={handleAddCollateral}
            disabled={isSubmitting || !selectedPosition || !additionalCollateral}
          >
            {isSubmitting ? 'Submitting...' : 'Add Collateral'}
          </button>
        </div>
      )}

      {/* Positions List */}
      <div className="positions-list">
        <h4>Your Positions</h4>
        {assetPositions.length === 0 ? (
          <p className="no-data">No open positions</p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Collateral</th>
                  <th>Minted</th>
                  <th>Ratio</th>
                  <th>Health</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {assetPositions.map(position => (
                  <tr key={position.positionId}>
                    <td>#{position.positionId}</td>
                    <td>{(position.collateralAmount / 10 ** 8).toFixed(2)}</td>
                    <td>{(position.mintedAmount / 10 ** 8).toFixed(2)} {selectedAsset}</td>
                    <td>
                      <span className={`ratio ${position.ratio < 12000 ? 'danger' : 'safe'}`}>
                        {(position.ratio / 100).toFixed(1)}%
                      </span>
                    </td>
                    <td>{position.healthFactor.toFixed(2)}</td>
                    <td>
                      <span className={`status ${position.status.toLowerCase()}`}>
                        {position.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default PositionManager;
