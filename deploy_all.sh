#!/bin/bash

# Ensure alice account is funded on testnet
stellar keys fund alice --network testnet || true

echo "Starting deployment of all compiled contracts to testnet..."
echo "Deployed Contracts:" > deployed_contracts.txt

# Contracts explicitly excluded from production deployment.
# These are reference/example contracts that must never be deployed
# automatically to production or testnet via this script.
#
# To deploy an excluded contract manually (e.g. for a demo), build it
# independently and deploy with `stellar contract deploy` directly.
EXCLUDED_PATTERNS=(
    "guess-the-number"  # Example/reference only — see contracts/guess-the-number/README.md
)

is_excluded() {
    local wasm_path="$1"
    for pattern in "${EXCLUDED_PATTERNS[@]}"; do
        if echo "$wasm_path" | grep -q "$pattern"; then
            return 0  # excluded
        fi
    done
    return 1  # not excluded
}

# Find all release .wasm files in the contracts directory
find contracts -type f -name "*.wasm" | grep release | while read wasm_path; do
    # Skip excluded (example/reference) contracts.
    if is_excluded "$wasm_path"; then
        echo "⏭️  Skipped (reference/example): $wasm_path"
        continue
    fi

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
