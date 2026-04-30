-- Create synthetic assets tables
-- Run with: npm run migrate

-- Positions table (collateral and trading positions)
CREATE TABLE IF NOT EXISTS positions (
  id SERIAL PRIMARY KEY,
  position_id BIGINT UNIQUE NOT NULL,
  user_address VARCHAR(255) NOT NULL,
  asset_symbol VARCHAR(50) NOT NULL,
  type VARCHAR(20) NOT NULL, -- 'COLLATERAL' or 'TRADING'
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN', -- 'OPEN', 'CLOSED', 'LIQUIDATED'
  
  -- Collateral position fields
  collateral_amount BIGINT,
  minted_amount BIGINT,
  
  -- Trading position fields
  margin BIGINT,
  leverage INT,
  direction VARCHAR(10), -- 'LONG' or 'SHORT'
  entry_price BIGINT,
  notional BIGINT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_position_id (position_id),
  INDEX idx_user_address (user_address),
  INDEX idx_asset_symbol (asset_symbol),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
);

-- Synthetic assets table
CREATE TABLE IF NOT EXISTS synthetic_assets (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  decimals INT NOT NULL,
  total_supply BIGINT DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_symbol (symbol)
);

-- Price history table
CREATE TABLE IF NOT EXISTS asset_prices (
  id SERIAL PRIMARY KEY,
  asset_symbol VARCHAR(50) NOT NULL REFERENCES synthetic_assets(symbol),
  price BIGINT NOT NULL,
  confidence INT NOT NULL, -- 0-100
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_asset_symbol (asset_symbol),
  INDEX idx_created_at (created_at)
);

-- Events table
CREATE TABLE IF NOT EXISTS synthetic_asset_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL, -- 'MINT', 'BURN', 'TRADE', 'LIQUIDATE', etc.
  subject VARCHAR(255) NOT NULL, -- Position ID or asset symbol
  details JSONB NOT NULL,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_event_type (event_type),
  INDEX idx_subject (subject),
  INDEX idx_created_at (created_at)
);

-- Liquidation alerts table
CREATE TABLE IF NOT EXISTS liquidation_alerts (
  id SERIAL PRIMARY KEY,
  position_id BIGINT UNIQUE NOT NULL REFERENCES positions(position_id),
  alerted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP WITH TIME ZONE,
  
  INDEX idx_position_id (position_id),
  INDEX idx_alerted_at (alerted_at)
);

-- Protocol parameters snapshot table
CREATE TABLE IF NOT EXISTS protocol_params_history (
  id SERIAL PRIMARY KEY,
  min_collateral_ratio INT NOT NULL,
  liquidation_threshold INT NOT NULL,
  liquidation_bonus INT NOT NULL,
  fee_percentage INT NOT NULL,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_created_at (created_at)
);

-- Collateral ratio history table (for analytics)
CREATE TABLE IF NOT EXISTS collateral_ratio_history (
  id SERIAL PRIMARY KEY,
  position_id BIGINT NOT NULL REFERENCES positions(position_id),
  ratio BIGINT NOT NULL,
  health_factor BIGINT NOT NULL,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_position_id (position_id),
  INDEX idx_created_at (created_at)
);

-- User positions summary (denormalized for quick lookups)
CREATE TABLE IF NOT EXISTS user_position_summary (
  id SERIAL PRIMARY KEY,
  user_address VARCHAR(255) NOT NULL,
  total_collateral_deposited BIGINT DEFAULT 0,
  total_synthetic_minted BIGINT DEFAULT 0,
  total_trading_margin BIGINT DEFAULT 0,
  open_positions_count INT DEFAULT 0,
  liquidated_positions_count INT DEFAULT 0,
  
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE (user_address),
  INDEX idx_user_address (user_address)
);

-- Create or replace indexes for better query performance
CREATE INDEX idx_positions_user_status ON positions(user_address, status);
CREATE INDEX idx_positions_asset_status ON positions(asset_symbol, status);
CREATE INDEX idx_synthetic_assets_created ON synthetic_assets(created_at);
CREATE INDEX idx_events_timestamp ON synthetic_asset_events(event_type, created_at);
