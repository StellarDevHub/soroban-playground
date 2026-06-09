#!/bin/bash

# Ensure alice account is funded on testnet
stellar keys fund alice --network testnet || true

echo "Starting deployment of all compiled contracts to testnet..."
echo "Deployed Contracts:" > deployed_contracts.txt

# Find all release .wasm files in the contracts directory
find contracts -type f -name "*.wasm" | grep release | while read wasm_path; do
    echo "Deploying $wasm_path..."
    
    # Try to deploy and capture the contract ID
    CONTRACT_ID=$(stellar contract deploy --wasm "$wasm_path" --source alice --network testnet 2>/dev/null)
    
    if [ -n "$CONTRACT_ID" ]; then
        echo "✅ Success: $wasm_path -> $CONTRACT_ID"
        echo "$wasm_path: $CONTRACT_ID" >> deployed_contracts.txt
    else
        echo "❌ Failed to deploy: $wasm_path"
    fi
    
    # Wait a few seconds to avoid rate limiting
    sleep 3
done

echo "Deployment complete! Check deployed_contracts.txt for the contract IDs."
