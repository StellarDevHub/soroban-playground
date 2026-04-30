/**
 * Liquidation Monitor Component
 * Monitors positions at risk of liquidation
 */

'use client';

import React from 'react';

interface Position {
  positionId: number;
  userAddress: string;
  assetSymbol: string;
  ratio: number;
  healthFactor: number;
  status: string;
}

interface ProtocolParams {
  liquidationThreshold: number;
}

interface LiquidationMonitorProps {
  positions: Position[];
  prices: Record<string, number>;
  protocolParams?: ProtocolParams;
}

const LiquidationMonitor: React.FC<LiquidationMonitorProps> = ({
  positions,
  prices,
  protocolParams,
}) => {
  const liquidationThreshold = protocolParams?.liquidationThreshold || 120;
  const atRiskPositions = positions.filter(
    p => p.ratio <= liquidationThreshold && p.status === 'OPEN'
  );

  return (
    <div className="liquidation-monitor">
      <h3>Liquidation Monitor</h3>

      {atRiskPositions.length === 0 ? (
        <div className="no-risk">
          <p>✓ No positions at risk of liquidation</p>
        </div>
      ) : (
        <div className="at-risk-positions">
          <div className="warning-banner">
            <strong>⚠️ {atRiskPositions.length} position(s) at liquidation risk</strong>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Position ID</th>
                  <th>Asset</th>
                  <th>Collateral Ratio</th>
                  <th>Health Factor</th>
                  <th>Risk Level</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {atRiskPositions.map(position => {
                  const riskPercent = ((liquidationThreshold - position.ratio) / liquidationThreshold) * 100;
                  const riskLevel =
                    riskPercent < 5
                      ? 'critical'
                      : riskPercent < 10
                      ? 'high'
                      : 'medium';

                  return (
                    <tr key={position.positionId} className={`risk-${riskLevel}`}>
                      <td>#{position.positionId}</td>
                      <td>{position.assetSymbol}</td>
                      <td>
                        <span className="ratio-badge">{(position.ratio / 100).toFixed(1)}%</span>
                      </td>
                      <td>{position.healthFactor.toFixed(2)}</td>
                      <td>
                        <span className={`risk-badge ${riskLevel}`}>{riskLevel.toUpperCase()}</span>
                      </td>
                      <td>
                        <button className="btn btn-small">Add Collateral</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="liquidation-info">
        <h4>How Liquidation Works</h4>
        <div className="info-box">
          <p>
            <strong>Liquidation Threshold:</strong> {(liquidationThreshold / 100).toFixed(1)}%
          </p>
          <p>
            When your collateral ratio drops below the liquidation threshold, your position becomes
            eligible for liquidation. Liquidators can then pay off your debt and claim your collateral
            plus a liquidation bonus.
          </p>
          <p>
            <strong>How to avoid liquidation:</strong>
          </p>
          <ul>
            <li>Monitor your collateral ratio regularly</li>
            <li>Add collateral before reaching the liquidation threshold</li>
            <li>Reduce your minted amount if prices decline</li>
            <li>Set price alerts for your assets</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default LiquidationMonitor;
