#!/bin/bash

# Create all required labels for the 50 issues
echo "Creating labels for GitHub issues..."

# Contract development labels
gh label create "contract-development" --color "#f97583" --description "Smart contract development tasks" 2>/dev/null || echo "✓ contract-development exists"
gh label create "defi" --color "#ff6600" --description "Decentralized Finance related" 2>/dev/null || echo "✓ defi exists"
gh label create "tokenomics" --color "#ff9900" --description "Token economics and distribution" 2>/dev/null || echo "✓ tokenomics exists"
gh label create "security" --color "#d73a4a" --description "Security-focused tasks" 2>/dev/null || echo "✓ security exists"
gh label create "nft" --color "#ff00ff" --description "NFT related features" 2>/dev/null || echo "✓ nft exists"
gh label create "governance" --color "#6600cc" --description "DAO and governance features" 2>/dev/null || echo "✓ governance exists"
gh label create "bridge" --color "#0099ff" --description "Cross-chain bridge features" 2>/dev/null || echo "✓ bridge exists"
gh label create "oracle" --color "#ff6600" --description "Oracle integration tasks" 2>/dev/null || echo "✓ oracle exists"
gh label create "insurance" --color "#00cc99" --description "Insurance protocol features" 2>/dev/null || echo "✓ insurance exists"
gh label create "staking" --color "#3366ff" --description "Staking related features" 2>/dev/null || echo "✓ staking exists"
gh label create "supply-chain" --color "#996633" --description "Supply chain tracking" 2>/dev/null || echo "✓ supply-chain exists"
gh label create "rwa" --color "#669999" --description "Real World Asset tokenization" 2>/dev/null || echo "✓ rwa exists"
gh label create "derivatives" --color "#cc0066" --description "Financial derivatives" 2>/dev/null || echo "✓ derivatives exists"
gh label create "identity" --color "#9933ff" --description "Decentralized identity" 2>/dev/null || echo "✓ identity exists"
gh label create "gaming" --color "#ff3399" --description "Gaming and lottery features" 2>/dev/null || echo "✓ gaming exists"
gh label create "sustainability" --color "#00cc66" --description "Environmental and sustainability" 2>/dev/null || echo "✓ sustainability exists"
gh label create "social" --color "#ff6699" --description "Social media features" 2>/dev/null || echo "✓ social exists"
gh label create "stablecoin" --color "#0066cc" --description "Stablecoin implementation" 2>/dev/null || echo "✓ stablecoin exists"
gh label create "entertainment" --color "#cc33ff" --description "Entertainment industry features" 2>/dev/null || echo "✓ entertainment exists"
gh label create "marketplace" --color "#ff9933" --description "Marketplace features" 2>/dev/null || echo "✓ marketplace exists"
gh label create "storage" --color "#666699" --description "Decentralized storage" 2>/dev/null || echo "✓ storage exists"
gh label create "synthetics" --color "#9900cc" --description "Synthetic assets" 2>/dev/null || echo "✓ synthetics exists"
gh label create "payments" --color "#009966" --description "Payment systems" 2>/dev/null || echo "✓ payments exists"
gh label create "notary" --color "#663300" --description "Notary and verification services" 2>/dev/null || echo "✓ notary exists"
gh label create "access-control" --color "#333399" --description "Access control mechanisms" 2>/dev/null || echo "✓ access-control exists"
gh label create "ticketing" --color "#ff6600" --description "Event ticketing systems" 2>/dev/null || echo "✓ ticketing exists"
gh label create "data" --color "#006699" --description "Data marketplace and management" 2>/dev/null || echo "✓ data exists"
gh label create "lending" --color "#0099cc" --description "Lending protocols" 2>/dev/null || echo "✓ lending exists"
gh label create "commerce" --color "#cc9900" --description "E-commerce features" 2>/dev/null || echo "✓ commerce exists"
gh label create "intellectual-property" --color "#9966cc" --description "Intellectual property management" 2>/dev/null || echo "✓ intellectual-property exists"
gh label create "finance" --color "#006633" --description "Financial services" 2>/dev/null || echo "✓ finance exists"

# Difficulty labels
gh label create "advanced" --color "#fbca04" --description "Advanced difficulty level" 2>/dev/null || echo "✓ advanced exists"
gh label create "expert" --color "#d73a4a" --description "Expert difficulty level" 2>/dev/null || echo "✓ expert exists"

# Component labels (frontend/backend already exist)
gh label create "frontend" --color "#1d44c7" --description "Frontend development" 2>/dev/null || echo "✓ frontend exists"
gh label create "backend" --color "#0366d6" --description "Backend development" 2>/dev/null || echo "✓ backend exists"

echo ""
echo "✅ All labels created successfully!"
