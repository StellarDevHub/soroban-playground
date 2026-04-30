/**
 * Protocol Stats Component
 * Displays protocol parameters and statistics
 */

'use client';

import React from 'react';

interface ProtocolParams {
  minCollateralRatio: number;
  liquidationThreshold: number;
  liquidationBonus: number;
  feePercentage: number;
}

interface ProtocolStatsProps {
  params: ProtocolParams;
}

const ProtocolStats: React.FC<ProtocolStatsProps> = ({ params }) => {
  return (
    <div className="protocol-stats">
      <div className="stat-item">
        <label>Min Collateral Ratio</label>
        <value>{(params.minCollateralRatio / 100).toFixed(1)}%</value>
      </div>
      <div className="stat-item">
        <label>Liquidation Threshold</label>
        <value>{(params.liquidationThreshold / 100).toFixed(1)}%</value>
      </div>
      <div className="stat-item">
        <label>Liquidation Bonus</label>
        <value>{(params.liquidationBonus / 100).toFixed(2)}%</value>
      </div>
      <div className="stat-item">
        <label>Trading Fee</label>
        <value>{(params.feePercentage / 100).toFixed(2)}%</value>
      </div>
    </div>
  );
};

export default ProtocolStats;
