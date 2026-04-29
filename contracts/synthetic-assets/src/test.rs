#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _,
    token::{self, StellarAssetClient},
    Address, Env, String, Symbol,
};

use crate::{
    SyntheticAssetsContract, SyntheticAssetsContractClient,
    types::*,
};

fn setup_env() -> (Env, SyntheticAssetsContractClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    
    let contract_id = env.register_contract(None, SyntheticAssetsContract);
    let client = SyntheticAssetsContractClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let collateral_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    
    (env, client, admin, oracle, collateral_token)
}

fn setup_contract() -> (Env, SyntheticAssetsContractClient<'static>, Address, Address, Address) {
    let (env, client, admin, oracle, collateral_token) = setup_env();
    
    client.initialize(
        &admin,
        &oracle,
        &collateral_token,
        &15000u32, // 150% min collateral ratio
        &12000u32, // 120% liquidation threshold
        &500u32,   // 5% liquidation bonus
        &100u32,   // 1% fee
    );
    
    (env, client, admin, oracle, collateral_token)
}

fn mint_collateral_tokens(
    env: &Env,
    collateral_token: &Address,
    to: &Address,
    amount: i128,
) {
    // Use admin to mint tokens through StellarAssetClient
    // The admin is the one who registered the asset contract
    let stellar_client = StellarAssetClient::new(env, collateral_token);
    stellar_client.mint(to, &amount);
}

#[test]
fn test_initialize_success() {
    let (_env, client, admin, oracle, collateral_token) = setup_env();
    
    assert_eq!(client.is_initialized(), false);
    
    client.initialize(
        &admin,
        &oracle,
        &collateral_token,
        &15000u32,
        &12000u32,
        &500u32,
        &100u32,
    );
    
    assert_eq!(client.is_initialized(), true);
    assert_eq!(client.get_admin(), admin);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_initialize_already_initialized() {
    let (_, client, admin, oracle, collateral_token) = setup_contract();
    
    // Try to initialize again
    client.initialize(
        &admin,
        &oracle,
        &collateral_token,
        &15000u32,
        &12000u32,
        &500u32,
        &100u32,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #17)")]
fn test_initialize_invalid_collateral_ratio() {
    let (_env, client, admin, oracle, collateral_token) = setup_env();
    
    client.initialize(
        &admin,
        &oracle,
        &collateral_token,
        &5000u32, // Too low (< 100%)
        &12000u32,
        &500u32,
        &100u32,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #18)")]
fn test_initialize_invalid_liquidation_threshold() {
    let (_env, client, admin, oracle, collateral_token) = setup_env();
    
    client.initialize(
        &admin,
        &oracle,
        &collateral_token,
        &15000u32,
        &16000u32, // Higher than min collateral ratio
        &500u32,
        &100u32,
    );
}

#[test]
fn test_register_synthetic_asset() {
    let (env, client, _admin, _, _) = setup_contract();
    
    let symbol = Symbol::new(&env, "sUSD");
    
    client.register_synthetic_asset(
        &symbol,
        &String::from_str(&env, "Synthetic USD"),
        &8u32,
        &100000000i128, // $1.00
    );
    
    let asset = client.get_asset(&symbol);
    assert_eq!(asset.symbol, symbol);
    assert_eq!(asset.total_supply, 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_register_duplicate_asset() {
    let (env, client, _admin, _, _) = setup_contract();
    
    let symbol = Symbol::new(&env, "sUSD");
    
    client.register_synthetic_asset(
        &symbol,
        &String::from_str(&env, "Synthetic USD"),
        &8u32,
        &100000000i128,
    );
    
    // Try to register again
    client.register_synthetic_asset(
        &symbol,
        &String::from_str(&env, "Synthetic USD 2"),
        &8u32,
        &100000000i128,
    );
}

#[test]
fn test_update_price() {
    let (env, client, _admin, _, _) = setup_contract();
    
    let symbol = Symbol::new(&env, "sUSD");
    
    client.register_synthetic_asset(
        &symbol,
        &String::from_str(&env, "Synthetic USD"),
        &8u32,
        &100000000i128,
    );
    
    let price_data = client.get_asset_price(&symbol);
    assert_eq!(price_data.price, 100000000i128);
    
    // Update price
    client.update_price(&symbol, &105000000i128, &95u32);
    
    let new_price_data = client.get_asset_price(&symbol);
    assert_eq!(new_price_data.price, 105000000i128);
}

#[test]
fn test_mint_synthetic() {
    let (env, client, _admin, _, collateral_token) = setup_contract();
    
    let user = Address::generate(&env);
    let symbol = Symbol::new(&env, "sUSD");
    
    // Register asset
    client.register_synthetic_asset(
        &symbol,
        &String::from_str(&env, "Synthetic USD"),
        &8u32,
        &100000000i128, // $1.00
    );
    
    // Mint collateral to user - 1000 tokens (with 7 decimal places for simplicity)
    mint_collateral_tokens(&env, &collateral_token, &user, 10000000i128);
    
    // Approve contract to spend collateral
    let token_client = token::Client::new(&env, &collateral_token);
    token_client.approve(&user, &client.address, &5000000i128, &1000u32);
    
    // Mint synthetic: 200 sUSD at $1.00 with 300 collateral = 150% ratio
    client.mint_synthetic(&user, &symbol, &3000000i128, &2000000i128);
    
    let position_id = 1u64;
    let position = client.get_position(&position_id);
    assert_eq!(position.user, user);
    assert_eq!(position.minted_amount, 2000000i128);
    assert_eq!(position.collateral_amount, 3000000i128);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn test_mint_insufficient_collateral() {
    let (env, client, _admin, _, collateral_token) = setup_contract();
    
    let user = Address::generate(&env);
    let symbol = Symbol::new(&env, "sUSD");
    
    client.register_synthetic_asset(
        &symbol,
        &String::from_str(&env, "Synthetic USD"),
        &8u32,
        &100000000i128,
    );
    
    mint_collateral_tokens(&env, &collateral_token, &user, 10000000i128);
    
    let token_client = token::Client::new(&env, &collateral_token);
    token_client.approve(&user, &client.address, &1000000i128, &1000u32);
    
    // Try to mint with insufficient collateral - only 100 collateral for 100 mint
    client.mint_synthetic(&user, &symbol, &1000000i128, &1000000i128);
}

#[test]
fn test_add_collateral() {
    let (env, client, _admin, _, collateral_token) = setup_contract();
    
    let user = Address::generate(&env);
    let symbol = Symbol::new(&env, "sUSD");
    
    client.register_synthetic_asset(
        &symbol,
        &String::from_str(&env, "Synthetic USD"),
        &8u32,
        &100000000i128,
    );
    
    mint_collateral_tokens(&env, &collateral_token, &user, 10000000i128);
    
    let token_client = token::Client::new(&env, &collateral_token);
    token_client.approve(&user, &client.address, &5000000i128, &1000u32);
    
    client.mint_synthetic(&user, &symbol, &3000000i128, &2000000i128);
    
    let position_id = 1u64;
    let position_before = client.get_position(&position_id);
    assert_eq!(position_before.collateral_amount, 3000000i128);
    
    // Add more collateral
    token_client.approve(&user, &client.address, &1000000i128, &1000u32);
    client.add_collateral(&user, &position_id, &1000000i128);
    
    let position_after = client.get_position(&position_id);
    assert_eq!(position_after.collateral_amount, 4000000i128);
}

#[test]
fn test_burn_synthetic() {
    let (env, client, _admin, _, collateral_token) = setup_contract();
    
    let user = Address::generate(&env);
    let symbol = Symbol::new(&env, "sUSD");
    
    client.register_synthetic_asset(
        &symbol,
        &String::from_str(&env, "Synthetic USD"),
        &8u32,
        &100000000i128,
    );
    
    mint_collateral_tokens(&env, &collateral_token, &user, 10000000i128);
    
    let token_client = token::Client::new(&env, &collateral_token);
    token_client.approve(&user, &client.address, &5000000i128, &1000u32);
    
    client.mint_synthetic(&user, &symbol, &3000000i128, &2000000i128);
    
    let position_id = 1u64;
    
    // Burn half (100)
    client.burn_synthetic(&user, &position_id, &1000000i128);
    
    let position = client.get_position(&position_id);
    assert_eq!(position.minted_amount, 1000000i128);
}

#[test]
fn test_collateral_ratio_calculation() {
    let (env, client, _admin, _, collateral_token) = setup_contract();
    
    let user = Address::generate(&env);
    let symbol = Symbol::new(&env, "sUSD");
    
    client.register_synthetic_asset(
        &symbol,
        &String::from_str(&env, "Synthetic USD"),
        &8u32,
        &100000000i128,
    );
    
    mint_collateral_tokens(&env, &collateral_token, &user, 10000000i128);
    
    let token_client = token::Client::new(&env, &collateral_token);
    token_client.approve(&user, &client.address, &5000000i128, &1000u32);
    
    // Mint with 150% collateral ratio
    // 300 collateral / (200 minted * 1.00 price) = 1.5 = 150%
    client.mint_synthetic(&user, &symbol, &3000000i128, &2000000i128);
    
    let position_id = 1u64;
    let ratio = client.get_collateral_ratio(&position_id);
    assert_eq!(ratio, 15000i128); // 15000 basis points = 150%
}

#[test]
fn test_is_liquidatable() {
    let (env, client, _admin, _, collateral_token) = setup_contract();
    
    let user = Address::generate(&env);
    let symbol = Symbol::new(&env, "sUSD");
    
    client.register_synthetic_asset(
        &symbol,
        &String::from_str(&env, "Synthetic USD"),
        &8u32,
        &100000000i128,
    );
    
    mint_collateral_tokens(&env, &collateral_token, &user, 10000000i128);
    
    let token_client = token::Client::new(&env, &collateral_token);
    token_client.approve(&user, &client.address, &5000000i128, &1000u32);
    
    // Open at the minimum ratio, then move price so the position
    // lands exactly on the liquidation threshold.
    client.mint_synthetic(&user, &symbol, &3000000i128, &2000000i128);
    client.update_price(&symbol, &125000000i128, &95u32);
    
    let position_id = 1u64;
    
    // Should be liquidatable (ratio == threshold means liquidatable)
    let liquidatable = client.is_liquidatable(&position_id);
    assert_eq!(liquidatable, true);
}

#[test]
fn test_open_trade() {
    let (env, client, _admin, _, collateral_token) = setup_contract();
    
    let user = Address::generate(&env);
    let symbol = Symbol::new(&env, "sUSD");
    
    client.register_synthetic_asset(
        &symbol,
        &String::from_str(&env, "Synthetic USD"),
        &8u32,
        &100000000i128,
    );
    
    mint_collateral_tokens(&env, &collateral_token, &user, 10000000i128);
    
    let token_client = token::Client::new(&env, &collateral_token);
    token_client.approve(&user, &client.address, &5000000i128, &1000u32);
    
    // Open long position with 2x leverage (100 margin)
    let position_id = client.open_trade(&user, &symbol, &TradeDirection::Long, &1000000i128, &20000u32);
    
    let position = client.get_trading_position_info(&position_id);
    assert_eq!(position.user, user);
    assert_eq!(position.direction, TradeDirection::Long);
    assert_eq!(position.leverage, 20000u32);
    assert_eq!(position.margin, 1000000i128);
}

#[test]
#[should_panic(expected = "Error(Contract, #22)")]
fn test_open_trade_insufficient_margin() {
    let (env, client, _admin, _, collateral_token) = setup_contract();
    
    let user = Address::generate(&env);
    let symbol = Symbol::new(&env, "sUSD");
    
    client.register_synthetic_asset(
        &symbol,
        &String::from_str(&env, "Synthetic USD"),
        &8u32,
        &100000000i128,
    );
    
    mint_collateral_tokens(&env, &collateral_token, &user, 10000000i128);
    
    let token_client = token::Client::new(&env, &collateral_token);
    token_client.approve(&user, &client.address, &5000000i128, &1000u32);
    
    // Try to open trade with insufficient margin for 10x leverage (10 margin for 100 notional)
    client.open_trade(&user, &symbol, &TradeDirection::Long, &100000i128, &100000u32);
}

#[test]
fn test_close_trade() {
    let (env, client, _admin, _, collateral_token) = setup_contract();
    
    let user = Address::generate(&env);
    let symbol = Symbol::new(&env, "sUSD");
    
    client.register_synthetic_asset(
        &symbol,
        &String::from_str(&env, "Synthetic USD"),
        &8u32,
        &100000000i128,
    );
    
    mint_collateral_tokens(&env, &collateral_token, &user, 10000000i128);
    
    let token_client = token::Client::new(&env, &collateral_token);
    token_client.approve(&user, &client.address, &5000000i128, &1000u32);
    
    let position_id = client.open_trade(&user, &symbol, &TradeDirection::Long, &1000000i128, &20000u32);
    
    // Close position
    let _final_amount = client.close_trade(&user, &position_id);
    
    // Position should be closed
    let position = client.get_trading_position_info(&position_id);
    assert_eq!(position.is_open, false);
}

#[test]
fn test_get_max_mintable() {
    let (env, client, _admin, _, _) = setup_contract();
    
    let symbol = Symbol::new(&env, "sUSD");
    
    client.register_synthetic_asset(
        &symbol,
        &String::from_str(&env, "Synthetic USD"),
        &8u32,
        &100000000i128,
    );
    
    // With 150% collateral ratio and price of $1.00:
    // 300 collateral / 1.50 = 200 max mintable
    let max_mintable = client.get_max_mintable(&symbol, &3000000i128);
    assert_eq!(max_mintable, 2000000i128);
}

#[test]
fn test_protocol_params() {
    let (_env, client, _admin, _, _) = setup_contract();
    
    let params = client.get_protocol_params();
    assert_eq!(params.min_collateral_ratio, 15000u32);
    assert_eq!(params.liquidation_threshold, 12000u32);
    assert_eq!(params.liquidation_bonus, 500u32);
    assert_eq!(params.fee_percentage, 100u32);
}

#[test]
fn test_update_protocol_params() {
    let (_env, client, _admin, _, _) = setup_contract();
    
    // Update params
    client.update_protocol_params(&16000u32, &13000u32, &600u32, &200u32);
    
    let params = client.get_protocol_params();
    assert_eq!(params.min_collateral_ratio, 16000u32);
    assert_eq!(params.liquidation_threshold, 13000u32);
    assert_eq!(params.liquidation_bonus, 600u32);
    assert_eq!(params.fee_percentage, 200u32);
}

#[test]
#[should_panic(expected = "Error(Contract, #17)")]
fn test_update_protocol_params_invalid_ratio() {
    let (_env, client, _admin, _, _) = setup_contract();
    
    client.update_protocol_params(&5000u32, &12000u32, &500u32, &100u32);
}

#[test]
fn test_is_asset_registered() {
    let (env, client, _admin, _, _) = setup_contract();
    
    let symbol = Symbol::new(&env, "sUSD");
    
    assert_eq!(client.is_asset_registered(&symbol), false);
    
    client.register_synthetic_asset(
        &symbol,
        &String::from_str(&env, "Synthetic USD"),
        &8u32,
        &100000000i128,
    );
    
    assert_eq!(client.is_asset_registered(&symbol), true);
}

#[test]
fn test_update_oracle() {
    let (env, client, _admin, _, _) = setup_contract();
    
    let new_oracle = Address::generate(&env);
    client.update_oracle(&new_oracle);
    
    // Note: oracle address isn't directly accessible, but operation should succeed
}

#[test]
fn test_update_collateral_token() {
    let (env, client, _admin, _, _) = setup_contract();
    
    let new_token = Address::generate(&env);
    client.update_collateral_token(&new_token);
    
    // Note: token address isn't directly accessible, but operation should succeed
}

#[test]
fn test_multiple_assets() {
    let (env, client, _admin, _, _) = setup_contract();
    
    let usd = Symbol::new(&env, "sUSD");
    let btc = Symbol::new(&env, "sBTC");
    
    client.register_synthetic_asset(&usd, &String::from_str(&env, "Synthetic USD"), &8u32, &100000000i128);
    client.register_synthetic_asset(&btc, &String::from_str(&env, "Synthetic BTC"), &8u32, &50000000000i128);
    
    assert_eq!(client.is_asset_registered(&usd), true);
    assert_eq!(client.is_asset_registered(&btc), true);
    
    let usd_asset = client.get_asset(&usd);
    let btc_asset = client.get_asset(&btc);
    
    assert_eq!(usd_asset.symbol, usd);
    assert_eq!(btc_asset.symbol, btc);
}

#[test]
fn test_trading_pnl_calculation() {
    let (env, client, _admin, _, collateral_token) = setup_contract();
    
    let user = Address::generate(&env);
    let symbol = Symbol::new(&env, "sUSD");
    
    client.register_synthetic_asset(&symbol, &String::from_str(&env, "Synthetic USD"), &8u32, &100000000i128);
    
    mint_collateral_tokens(&env, &collateral_token, &user, 10000000i128);
    
    let token_client = token::Client::new(&env, &collateral_token);
    token_client.approve(&user, &client.address, &5000000i128, &1000u32);
    
    let position_id = client.open_trade(&user, &symbol, &TradeDirection::Long, &1000000i128, &20000u32);
    
    let _position = client.get_trading_position_info(&position_id);
    
    // Update price up 10%
    client.update_price(&symbol, &110000000i128, &95u32);
    
    let pnl = client.get_trading_pnl(&position_id);
    // PnL should be positive for long when price goes up
    assert!(pnl > 0);
}

#[test]
fn test_short_position_pnl() {
    let (env, client, _admin, _, collateral_token) = setup_contract();
    
    let user = Address::generate(&env);
    let symbol = Symbol::new(&env, "sUSD");
    
    client.register_synthetic_asset(&symbol, &String::from_str(&env, "Synthetic USD"), &8u32, &100000000i128);
    
    mint_collateral_tokens(&env, &collateral_token, &user, 10000000i128);
    
    let token_client = token::Client::new(&env, &collateral_token);
    token_client.approve(&user, &client.address, &5000000i128, &1000u32);
    
    let position_id = client.open_trade(&user, &symbol, &TradeDirection::Short, &1000000i128, &20000u32);
    
    let _position = client.get_trading_position_info(&position_id);
    
    // Update price down 10% - short should profit
    client.update_price(&symbol, &90000000i128, &95u32);
    
    let pnl = client.get_trading_pnl(&position_id);
    assert!(pnl > 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_get_nonexistent_asset() {
    let (env, client, _admin, _, _) = setup_contract();
    
    let symbol = Symbol::new(&env, "NONEXISTENT");
    client.get_asset(&symbol);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn test_get_nonexistent_position() {
    let (_env, client, _admin, _, _) = setup_contract();
    
    client.get_position(&999u64);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn test_get_nonexistent_trading_position() {
    let (_env, client, _admin, _, _) = setup_contract();
    
    client.get_trading_position_info(&999u64);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_unauthorized_add_collateral() {
    let (env, client, _admin, _, collateral_token) = setup_contract();
    
    let user = Address::generate(&env);
    let attacker = Address::generate(&env);
    let symbol = Symbol::new(&env, "sUSD");
    
    client.register_synthetic_asset(&symbol, &String::from_str(&env, "Synthetic USD"), &8u32, &100000000i128);
    
    mint_collateral_tokens(&env, &collateral_token, &user, 10000000i128);
    
    let token_client = token::Client::new(&env, &collateral_token);
    token_client.approve(&user, &client.address, &5000000i128, &1000u32);
    
    client.mint_synthetic(&user, &symbol, &3000000i128, &2000000i128);
    
    // Attacker tries to add collateral to user's position
    client.add_collateral(&attacker, &1u64, &1000000i128);
}

// Edge case tests
#[test]
#[should_panic]
fn test_zero_amount_mint() {
    let (env, client, _admin, _, collateral_token) = setup_contract();
    
    let user = Address::generate(&env);
    let symbol = Symbol::new(&env, "sUSD");
    
    client.register_synthetic_asset(&symbol, &String::from_str(&env, "Synthetic USD"), &8u32, &100000000i128);
    
    mint_collateral_tokens(&env, &collateral_token, &user, 10000000i128);
    
    let token_client = token::Client::new(&env, &collateral_token);
    token_client.approve(&user, &client.address, &5000000i128, &1000u32);
    
    // Try mint with zero amount should panic/fail
    client.mint_synthetic(&user, &symbol, &0i128, &0i128);
}

#[test]
fn test_high_leverage_bounds() {
    let (env, client, _admin, _, collateral_token) = setup_contract();
    
    let user = Address::generate(&env);
    let symbol = Symbol::new(&env, "sUSD");
    
    client.register_synthetic_asset(&symbol, &String::from_str(&env, "Synthetic USD"), &8u32, &100000000i128);
    
    mint_collateral_tokens(&env, &collateral_token, &user, 10000000i128);
    
    let token_client = token::Client::new(&env, &collateral_token);
    token_client.approve(&user, &client.address, &5000000i128, &1000u32);
    
    // 10x leverage (maximum allowed) with 100 margin
    let position_id = client.open_trade(&user, &symbol, &TradeDirection::Long, &1000000i128, &100000u32);
    
    let position = client.get_trading_position_info(&position_id);
    assert_eq!(position.leverage, 100000u32);
}

#[test]
#[should_panic(expected = "Error(Contract, #21)")]
fn test_excessive_leverage() {
    let (env, client, _admin, _, collateral_token) = setup_contract();
    
    let user = Address::generate(&env);
    let symbol = Symbol::new(&env, "sUSD");
    
    client.register_synthetic_asset(&symbol, &String::from_str(&env, "Synthetic USD"), &8u32, &100000000i128);
    
    mint_collateral_tokens(&env, &collateral_token, &user, 10000000i128);
    
    let token_client = token::Client::new(&env, &collateral_token);
    token_client.approve(&user, &client.address, &5000000i128, &1000u32);
    
    // Try 11x leverage (> 10x max) with 100 margin
    client.open_trade(&user, &symbol, &TradeDirection::Long, &1000000i128, &110000u32);
}
