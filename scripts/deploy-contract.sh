#!/bin/bash

# Copyright (c) 2026 StellarDevTools
# SPDX-License-Identifier: MIT

# Subscription Management Contract Deployment Script
# This script deploys the subscription management smart contract to testnet

set -e

# Configuration
CONTRACT_NAME="subscription-management"
NETWORK="testnet"
CONTRACT_DIR="contracts/subscription-management"
WASM_FILE="$CONTRACT_DIR/target/wasm32-unknown-unknown/release/subscription_management.wasm"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required tools are installed
check_dependencies() {
    log_info "Checking dependencies..."
    
    if ! command -v soroban &> /dev/null; then
        log_error "soroban CLI is not installed. Please install it first."
        exit 1
    fi
    
    if ! command -v cargo &> /dev/null; then
        log_error "cargo is not installed. Please install Rust first."
        exit 1
    fi
    
    if ! command -v rustc &> /dev/null; then
        log_error "rustc is not installed. Please install Rust first."
        exit 1
    fi
    
    log_success "All dependencies are installed!"
}

# Build the contract
build_contract() {
    log_info "Building the subscription management contract..."
    
    cd "$CONTRACT_DIR"
    
    # Check if wasm target is installed
    if ! rustup target list --installed | grep -q "wasm32-unknown-unknown"; then
        log_info "Installing wasm32-unknown-unknown target..."
        rustup target add wasm32-unknown-unknown
    fi
    
    # Build the contract
    cargo build --target wasm32-unknown-unknown --release
    
    if [ ! -f "$WASM_FILE" ]; then
        log_error "Contract build failed. WASM file not found at $WASM_FILE"
        exit 1
    fi
    
    log_success "Contract built successfully!"
    
    cd - > /dev/null
}

# Deploy the contract
deploy_contract() {
    log_info "Deploying contract to $NETWORK..."
    
    # Get the network passphrase
    case $NETWORK in
        "testnet")
            NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
            RPC_URL="https://soroban-testnet.stellar.org"
            ;;
        "futurenet")
            NETWORK_PASSPHRASE="Test SDF Future Network ; October 2022"
            RPC_URL="https://soroban-futurenet.stellar.org"
            ;;
        *)
            log_error "Unsupported network: $NETWORK"
            exit 1
            ;;
    esac
    
    # Check if we have a secret key
    if [ -z "$SOROBAN_SECRET_KEY" ]; then
        log_warning "SOROBAN_SECRET_KEY environment variable not set."
        log_info "Please set your secret key: export SOROBAN_SECRET_KEY='your-secret-key'"
        read -p "Enter your secret key (or press Enter to skip):" SECRET_KEY
        
        if [ -n "$SECRET_KEY" ]; then
            export SOROBAN_SECRET_KEY="$SECRET_KEY"
        else
            log_error "Secret key is required for deployment."
            exit 1
        fi
    fi
    
    # Deploy the contract
    log_info "Deploying contract..."
    
    CONTRACT_ADDRESS=$(soroban contract deploy \
        --wasm "$WASM_FILE" \
        --source "$SOROBAN_SECRET_KEY" \
        --network "$NETWORK" \
        --rpc-url "$RPC_URL" \
        --network-passphrase "$NETWORK_PASSPHRASE" \
        | grep "Contract Address:" | awk '{print $3}')
    
    if [ -z "$CONTRACT_ADDRESS" ]; then
        log_error "Contract deployment failed."
        exit 1
    fi
    
    log_success "Contract deployed successfully!"
    log_info "Contract Address: $CONTRACT_ADDRESS"
    
    # Save contract address to file
    echo "$CONTRACT_ADDRESS" > "$CONTRACT_DIR/.contract_address"
    log_info "Contract address saved to $CONTRACT_DIR/.contract_address"
}

# Initialize the contract
initialize_contract() {
    log_info "Initializing the contract..."
    
    if [ ! -f "$CONTRACT_DIR/.contract_address" ]; then
        log_error "Contract address not found. Please deploy the contract first."
        exit 1
    fi
    
    CONTRACT_ADDRESS=$(cat "$CONTRACT_DIR/.contract_address")
    
    # Initialize the contract with admin address and platform fee
    ADMIN_ADDRESS=$(soroban keys address --secret-key "$SOROBAN_SECRET_KEY")
    PLATFORM_FEE=100 # 1% fee (100 basis points)
    
    log_info "Initializing contract with admin: $ADMIN_ADDRESS"
    log_info "Platform fee: $PLATFORM_FEE basis points"
    
    soroban contract invoke \
        --id "$CONTRACT_ADDRESS" \
        --source "$SOROBAN_SECRET_KEY" \
        --network "$NETWORK" \
        --rpc-url "$RPC_URL" \
        --network-passphrase "$NETWORK_PASSPHRASE" \
        -- \
        initialize \
        --admin "$ADMIN_ADDRESS" \
        --platform-fee-bps "$PLATFORM_FEE"
    
    log_success "Contract initialized successfully!"
}

# Create test plans
create_test_plans() {
    log_info "Creating test subscription plans..."
    
    if [ ! -f "$CONTRACT_DIR/.contract_address" ]; then
        log_error "Contract address not found. Please deploy the contract first."
        exit 1
    fi
    
    CONTRACT_ADDRESS=$(cat "$CONTRACT_DIR/.contract_address")
    
    # Create basic plan
    log_info "Creating basic plan..."
    soroban contract invoke \
        --id "$CONTRACT_ADDRESS" \
        --source "$SOROBAN_SECRET_KEY" \
        --network "$NETWORK" \
        --rpc-url "$RPC_URL" \
        --network-passphrase "$NETWORK_PASSPHRASE" \
        -- \
        create_plan \
        --caller "$SOROBAN_SECRET_KEY" \
        --plan-id "basic_monthly" \
        --name "Basic Monthly" \
        --description "Basic subscription plan with essential features" \
        --price-per-period 1000000000 \
        --billing-period 2592000 \
        --is-active true
    
    # Create premium plan
    log_info "Creating premium plan..."
    soroban contract invoke \
        --id "$CONTRACT_ADDRESS" \
        --source "$SOROBAN_SECRET_KEY" \
        --network "$NETWORK" \
        --rpc-url "$RPC_URL" \
        --network-passphrase "$NETWORK_PASSPHRASE" \
        -- \
        create_plan \
        --caller "$SOROBAN_SECRET_KEY" \
        --plan-id "premium_monthly" \
        --name "Premium Monthly" \
        --description "Premium subscription plan with advanced features" \
        --price-per-period 5000000000 \
        --billing-period 2592000 \
        --is-active true
    
    log_success "Test plans created successfully!"
}

# Verify deployment
verify_deployment() {
    log_info "Verifying contract deployment..."
    
    if [ ! -f "$CONTRACT_DIR/.contract_address" ]; then
        log_error "Contract address not found. Please deploy the contract first."
        exit 1
    fi
    
    CONTRACT_ADDRESS=$(cat "$CONTRACT_DIR/.contract_address")
    
    # Get contract admin
    ADMIN_ADDRESS=$(soroban contract invoke \
        --id "$CONTRACT_ADDRESS" \
        --source "$SOROBAN_SECRET_KEY" \
        --network "$NETWORK" \
        --rpc-url "$RPC_URL" \
        --network-passphrase "$NETWORK_PASSPHRASE" \
        -- \
        get_admin \
        --admin "$SOROBAN_SECRET_KEY" 2>/dev/null || echo "Failed to get admin")
    
    # Get platform fee
    PLATFORM_FEE=$(soroban contract invoke \
        --id "$CONTRACT_ADDRESS" \
        --source "$SOROBAN_SECRET_KEY" \
        --network "$NETWORK" \
        --rpc-url "$RPC_URL" \
        --network-passphrase "$NETWORK_PASSPHRASE" \
        -- \
        get_platform_fee \
        --admin "$SOROBAN_SECRET_KEY" 2>/dev/null || echo "Failed to get platform fee")
    
    # Get basic plan details
    BASIC_PLAN=$(soroban contract invoke \
        --id "$CONTRACT_ADDRESS" \
        --source "$SOROBAN_SECRET_KEY" \
        --network "$NETWORK" \
        --rpc-url "$RPC_URL" \
        --network-passphrase "$NETWORK_PASSPHRASE" \
        -- \
        get_plan_details \
        --plan-id "basic_monthly" 2>/dev/null || echo "Failed to get basic plan")
    
    echo ""
    log_info "=== Deployment Verification ==="
    log_info "Contract Address: $CONTRACT_ADDRESS"
    log_info "Network: $NETWORK"
    echo ""
    log_info "Admin Address: $ADMIN_ADDRESS"
    log_info "Platform Fee: $PLATFORM_FEE"
    echo ""
    log_info "Basic Plan Details: $BASIC_PLAN"
    echo ""
    
    if [ -n "$ADMIN_ADDRESS" ] && [ -n "$PLATFORM_FEE" ]; then
        log_success "Contract deployment verified successfully!"
    else
        log_warning "Contract deployment verification incomplete. Some checks failed."
    fi
}

# Show usage information
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  build              Build the contract"
    echo "  deploy             Deploy the contract"
    echo "  initialize         Initialize the contract"
    echo "  test-plans         Create test subscription plans"
    echo "  verify             Verify the deployment"
    echo "  all                Run all steps (build, deploy, initialize, test-plans, verify)"
    echo "  help               Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  SOROBAN_SECRET_KEY  Your Stellar secret key"
    echo ""
    echo "Examples:"
    echo "  $0 all                           # Full deployment"
    echo "  $0 build                        # Build only"
    echo "  $0 deploy                       # Deploy only"
    echo "  SOROBAN_SECRET_KEY='your-key' $0 all  # Deploy with custom key"
}

# Main function
main() {
    case "${1:-all}" in
        "build")
            check_dependencies
            build_contract
            ;;
        "deploy")
            check_dependencies
            build_contract
            deploy_contract
            ;;
        "initialize")
            initialize_contract
            ;;
        "test-plans")
            create_test_plans
            ;;
        "verify")
            verify_deployment
            ;;
        "all")
            check_dependencies
            build_contract
            deploy_contract
            initialize_contract
            create_test_plans
            verify_deployment
            ;;
        "help"|"-h"|"--help")
            show_usage
            ;;
        *)
            log_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
