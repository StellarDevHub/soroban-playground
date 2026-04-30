-- Rollback synthetic assets tables

DROP TABLE IF EXISTS collateral_ratio_history;
DROP TABLE IF EXISTS user_position_summary;
DROP TABLE IF EXISTS protocol_params_history;
DROP TABLE IF EXISTS liquidation_alerts;
DROP TABLE IF EXISTS synthetic_asset_events;
DROP TABLE IF EXISTS asset_prices;
DROP TABLE IF EXISTS positions;
DROP TABLE IF EXISTS synthetic_assets;
