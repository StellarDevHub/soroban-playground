#!/usr/bin/env python3
"""
Create 50 complex GitHub issues for Soroban Playground
Run this script with: python3 create_all_issues.py
"""

import subprocess
import time
import sys

# All 50 issues data
all_issues = [
    # 1-10: DeFi & Trading
    ("Frontend + Backend | Implement Multi-Signature Wallet Contract with Time-Locked Transactions and Visual Approval Workflow", "contract-development,frontend,backend,security,advanced", "Multi-Signature Wallet"),
    ("Frontend + Backend | Build Decentralized Exchange (DEX) with Automated Market Maker (AMM) and Liquidity Pool Dashboard", "contract-development,defi,frontend,backend,advanced", "DEX with AMM"),
    ("Frontend + Backend | Create Token Vesting Contract with Cliff Periods and Frontend Portfolio Tracker", "contract-development,tokenomics,frontend,backend,advanced", "Token Vesting"),
    ("Frontend + Backend | Implement Flash Loan Contract with Arbitrage Detection and Profit Calculator", "contract-development,defi,frontend,backend,expert", "Flash Loan"),
    ("Frontend + Backend | Develop NFT Marketplace with Royalty Distribution and Auction System", "contract-development,nft,frontend,backend,advanced", "NFT Marketplace"),
    ("Frontend + Backend | Build Lending Protocol with Collateralization Ratio Monitoring and Liquidation Engine", "contract-development,defi,frontend,backend,expert", "Lending Protocol"),
    ("Frontend + Backend | Create Governance DAO Contract with Proposal Lifecycle and Voting Analytics Dashboard", "contract-development,governance,frontend,backend,advanced", "Governance DAO"),
    ("Frontend + Backend | Implement Cross-Chain Bridge Contract with Transaction Monitoring and Status Tracker", "contract-development,bridge,frontend,backend,expert", "Cross-Chain Bridge"),
    ("Frontend + Backend | Build Yield Farming Contract with Strategy Optimizer and APY Comparison Tool", "contract-development,defi,frontend,backend,advanced", "Yield Farming"),
    ("Frontend + Backend | Develop Prediction Market Contract with Oracle Integration and Market Analytics", "contract-development,oracle,frontend,backend,advanced", "Prediction Market"),
    
    # 11-20: Advanced Financial Instruments
    ("Frontend + Backend | Create Insurance Protocol Contract with Claim Assessment and Risk Dashboard", "contract-development,insurance,frontend,backend,advanced", "Insurance Protocol"),
    ("Frontend + Backend | Implement Token Swap Aggregator with Route Optimization and Gas Estimator", "contract-development,defi,frontend,backend,expert", "Token Swap Aggregator"),
    ("Frontend + Backend | Build Staking Derivatives Contract with Liquid Staking Token and Yield Tracker", "contract-development,staking,frontend,backend,advanced", "Staking Derivatives"),
    ("Frontend + Backend | Develop Supply Chain Tracking Contract with Provenance Verification and QR Integration", "contract-development,supply-chain,frontend,backend,advanced", "Supply Chain"),
    ("Frontend + Backend | Create Real Estate Tokenization Contract with Fractional Ownership and Rental Distribution", "contract-development,rwa,frontend,backend,expert", "Real Estate Tokenization"),
    ("Frontend + Backend | Implement Options Trading Contract with Pricing Model and Greeks Calculator", "contract-development,derivatives,frontend,backend,expert", "Options Trading"),
    ("Frontend + Backend | Build Decentralized Identity (DID) Contract with Verifiable Credentials and Reputation System", "contract-development,identity,frontend,backend,advanced", "Decentralized Identity"),
    ("Frontend + Backend | Develop Lottery Contract with Verifiable Randomness and Prize Distribution Analytics", "contract-development,gaming,frontend,backend,advanced", "Lottery System"),
    ("Frontend + Backend | Create Carbon Credit Trading Contract with Verification and Environmental Impact Tracker", "contract-development,sustainability,frontend,backend,advanced", "Carbon Credits"),
    ("Frontend + Backend | Implement Perpetual Futures Contract with Funding Rate Mechanism and Position Manager", "contract-development,derivatives,frontend,backend,expert", "Perpetual Futures"),
    
    # 21-30: Social & Content Platforms
    ("Frontend + Backend | Build Decentralized Social Media Contract with Content Monetization and Creator Analytics", "contract-development,social,frontend,backend,advanced", "Social Media"),
    ("Frontend + Backend | Develop Stablecoin Contract with Algorithmic Stability Mechanism and Reserve Dashboard", "contract-development,stablecoin,frontend,backend,expert", "Stablecoin"),
    ("Frontend + Backend | Create Royalty Distribution Contract for Music Streaming with Usage Analytics", "contract-development,entertainment,frontend,backend,advanced", "Music Royalties"),
    ("Frontend + Backend | Implement Job Marketplace Contract with Escrow Payment and Skill Verification", "contract-development,marketplace,frontend,backend,advanced", "Job Marketplace"),
    ("Frontend + Backend | Build Decentralized Cloud Storage Contract with File Sharding and Redundancy Management", "contract-development,storage,frontend,backend,expert", "Cloud Storage"),
    ("Frontend + Backend | Develop Synthetic Assets Contract with Price Tracking and Collateral Management", "contract-development,synthetics,frontend,backend,expert", "Synthetic Assets"),
    ("Frontend + Backend | Create Subscription Management Contract with Recurring Payments and Usage Analytics", "contract-development,payments,frontend,backend,advanced", "Subscription Management"),
    ("Frontend + Backend | Implement Token Airdrop Contract with Merkle Tree Distribution and Eligibility Checker", "contract-development,tokenomics,frontend,backend,advanced", "Token Airdrop"),
    ("Frontend + Backend | Build Decentralized Voting System with Quadratic Voting and Privacy Preservation", "contract-development,governance,frontend,backend,advanced", "Quadratic Voting"),
    ("Frontend + Backend | Develop Royalty-Free Music Licensing Contract with Usage Tracking and Revenue Sharing", "contract-development,entertainment,frontend,backend,advanced", "Music Licensing"),
    
    # 31-40: Enterprise & Professional Tools
    ("Frontend + Backend | Create Decentralized File Notary Contract with Timestamp Verification and Certificate Generation", "contract-development,notary,frontend,backend,advanced", "File Notary"),
    ("Frontend + Backend | Implement Tokenized Real Estate Investment Trust (REIT) with Dividend Distribution", "contract-development,rwa,frontend,backend,expert", "Tokenized REIT"),
    ("Frontend + Backend | Build Decentralized Bug Bounty Contract with Vulnerability Disclosure and Reward Distribution", "contract-development,security,frontend,backend,advanced", "Bug Bounty"),
    ("Frontend + Backend | Develop Automated Market Maker for NFTs with Dynamic Pricing and Collection Analytics", "contract-development,nft,frontend,backend,expert", "NFT AMM"),
    ("Frontend + Backend | Create Decentralized Freelancer Escrow with Milestone Tracking and Dispute Resolution", "contract-development,marketplace,frontend,backend,advanced", "Freelancer Escrow"),
    ("Frontend + Backend | Implement Decentralized Autonomous Organization (DAO) Treasury Management with Multi-Sig Controls", "contract-development,governance,frontend,backend,advanced", "DAO Treasury"),
    ("Frontend + Backend | Build Token Burn Mechanism with Deflationary Economics and Supply Tracker", "contract-development,tokenomics,frontend,backend,advanced", "Token Burn"),
    ("Frontend + Backend | Develop Cross-Protocol Yield Optimizer with Auto-Compounding and Strategy Backtesting", "contract-development,defi,frontend,backend,expert", "Yield Optimizer"),
    ("Frontend + Backend | Create Decentralized Content Publishing Platform with Tip Jar and Subscriber Analytics", "contract-development,social,frontend,backend,advanced", "Content Publishing"),
    ("Frontend + Backend | Implement Decentralized Exchange Limit Order Book with Order Matching Engine", "contract-development,defi,frontend,backend,expert", "Limit Order Book"),
    
    # 41-50: Identity & Access Management
    ("Frontend + Backend | Build Decentralized Freelancer Identity with Portfolio Verification and Skill Endorsements", "contract-development,identity,frontend,backend,advanced", "Freelancer Identity"),
    ("Frontend + Backend | Develop Token Gated Access Control with Membership NFTs and Community Analytics", "contract-development,access-control,frontend,backend,advanced", "Token Gated Access"),
    ("Frontend + Backend | Create Decentralized Prediction Market for Sports with Live Odds and Betting Analytics", "contract-development,gaming,frontend,backend,advanced", "Sports Prediction"),
    ("Frontend + Backend | Implement Decentralized Invoice Factoring with Early Payment Discount and Risk Assessment", "contract-development,finance,frontend,backend,advanced", "Invoice Factoring"),
    ("Frontend + Backend | Build Decentralized Event Ticketing with Anti-Scalping Mechanism and Attendee Analytics", "contract-development,ticketing,frontend,backend,advanced", "Event Ticketing"),
    ("Frontend + Backend | Develop Decentralized Data Marketplace with Privacy-Preserving Queries and Usage Tracking", "contract-development,data,frontend,backend,expert", "Data Marketplace"),
    ("Frontend + Backend | Create Decentralized Micro-Lending Platform with Credit Scoring and Repayment Tracking", "contract-development,lending,frontend,backend,advanced", "Micro-Lending"),
    ("Frontend + Backend | Implement Decentralized Warranty Management with Automated Claims and Product Registration", "contract-development,commerce,frontend,backend,advanced", "Warranty Management"),
    ("Frontend + Backend | Build Decentralized Loyalty Rewards Program with Cross-Merchant Redemption and Points Analytics", "contract-development,commerce,frontend,backend,advanced", "Loyalty Rewards"),
    ("Frontend + Backend | Develop Decentralized Patent Registry with Invention Verification and Licensing Marketplace", "contract-development,intellectual-property,frontend,backend,expert", "Patent Registry"),
]

def generate_body(issue_name, labels):
    """Generate a comprehensive issue body"""
    difficulty = labels.split(",")[-1]
    
    return f"""## 📋 Description
Build a comprehensive {issue_name} system with smart contract, frontend interface, and backend integration.

## 🎯 Key Requirements

### Smart Contract (Soroban/Rust)
- Implement core business logic with security best practices
- Add comprehensive event emissions for tracking
- Include access control and authorization mechanisms
- Implement gas optimization techniques
- Add emergency pause and recovery mechanisms

### Frontend (React/Next.js + TypeScript)
- Build responsive user interface with real-time updates
- Create interactive dashboards with data visualization
- Implement WebSocket connections for live data
- Add comprehensive form validation and error handling
- Include accessibility features (WCAG 2.1 AA compliant)

### Backend (Node.js + Express)
- Create RESTful API endpoints for data management
- Implement caching strategies for performance
- Add comprehensive logging and monitoring
- Include rate limiting and security middleware
- Set up automated testing with high coverage

## 🔧 Technical Specifications

### Contract Architecture
- State variables with proper visibility modifiers
- Event definitions for all critical actions
- Modifier functions for access control
- Fallback and receive functions if needed
- Comprehensive error handling with custom errors

### Frontend Components
- Component-based architecture with reusable UI elements
- State management using React Context or Redux
- API integration with error boundaries
- Performance optimization with lazy loading
- Mobile-responsive design

### Backend Services
- Modular route organization
- Middleware chain for request processing
- Database integration with migrations
- Background job processing
- Health check endpoints

## ✅ Acceptance Criteria
- [ ] Smart contract deployed to testnet with all functions working
- [ ] Comprehensive test suite with >90% code coverage
- [ ] Frontend interface complete and responsive
- [ ] Backend API fully documented with OpenAPI/Swagger
- [ ] Integration tests passing for all critical paths
- [ ] Security audit completed with no critical vulnerabilities
- [ ] Performance benchmarks met (<2s page load, <500ms API response)
- [ ] Documentation complete (README, API docs, deployment guide)

## 📊 Analytics & Monitoring
- Real-time dashboard showing key metrics
- Transaction history with filtering and search
- User activity tracking and analytics
- Error tracking and alerting system
- Performance monitoring with alerts

## 🔒 Security Requirements
- Input validation on all user inputs
- Protection against common vulnerabilities (XSS, CSRF, SQL injection)
- Smart contract security patterns (checks-effects-interactions, pull over push)
- Rate limiting on API endpoints
- Secure key management and storage

## 📚 Documentation Deliverables
- Technical architecture diagram
- Smart contract documentation with NatSpec
- API documentation with examples
- User guide for end users
- Deployment and configuration guide
- Troubleshooting guide

## ⏱️ Timeline
**ETA: 2 days**

### Day 1: Core Implementation
- Morning: Smart contract development and testing
- Afternoon: Backend API development
- Evening: Initial frontend components

### Day 2: Integration & Polish
- Morning: Frontend-backend integration
- Afternoon: Testing and bug fixes
- Evening: Documentation and deployment

## 🎓 Difficulty Level
**{difficulty.title()}** - Requires deep understanding of:
- Soroban smart contract development
- React/Next.js advanced patterns
- Node.js backend architecture
- DeFi/Web3 concepts
- Security best practices

## 🤝 Support & Resources
- Review existing contracts in `/contracts` directory
- Check backend architecture in `/backend/src`
- Frontend patterns in `/frontend/src`
- Ask questions in issue comments
- Tag maintainers for code review

## 🏷️ Labels
`{labels}`

---

**Note to Contributors:** This is a complex issue requiring full-stack development skills. Please ensure you have experience with Soroban, React, and Node.js before attempting. Break down the work into smaller PRs for easier review."""

def create_issue(title, labels, issue_name, index):
    """Create a single GitHub issue"""
    body = generate_body(issue_name, labels)
    
    cmd = [
        "gh", "issue", "create",
        "--title", title,
        "--body", body,
        "--label", labels
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=30)
        print(f"✅ [{index+1}/50] Created: {title[:70]}...")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ [{index+1}/50] Failed: {title[:70]}...")
        print(f"   Error: {e.stderr[:200]}")
        return False
    except subprocess.TimeoutExpired:
        print(f"⏱️  [{index+1}/50] Timeout: {title[:70]}...")
        return False

def main():
    print("=" * 80)
    print("🚀 Creating 50 Complex GitHub Issues for Soroban Playground")
    print("=" * 80)
    print()
    
    success_count = 0
    fail_count = 0
    
    for i, (title, labels, issue_name) in enumerate(all_issues):
        if create_issue(title, labels, issue_name, i):
            success_count += 1
        else:
            fail_count += 1
        
        # Rate limiting - wait between requests
        if i < len(all_issues) - 1:
            time.sleep(3)
    
    print()
    print("=" * 80)
    print(f"📊 Summary:")
    print(f"   ✅ Successfully created: {success_count}/50")
    print(f"   ❌ Failed: {fail_count}/50")
    print("=" * 80)
    
    if fail_count > 0:
        print(f"\n⚠️  {fail_count} issues failed to create. You can retry them manually.")
        sys.exit(1)
    else:
        print(f"\n🎉 All 50 issues created successfully!")
        sys.exit(0)

if __name__ == "__main__":
    main()
