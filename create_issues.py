#!/usr/bin/env python3
"""
Script to create 50 complex GitHub issues for Soroban Playground
"""

import subprocess
import time
import json

# Issue data: (title, labels, description)
issues = [
    {
        "title": "Frontend + Backend | Implement Multi-Signature Wallet Contract with Time-Locked Transactions and Visual Approval Workflow",
        "labels": "contract-development,frontend,backend,security,advanced",
        "description": """## Description
Build a comprehensive multi-signature wallet system that requires multiple approvals for transactions with time-lock functionality.

## Requirements
- Create Soroban smart contract supporting configurable signer thresholds (2-of-3, 3-of-5, etc.)
- Implement time-lock mechanism for large transactions (configurable delay)
- Build frontend UI showing pending approvals with countdown timers
- Create backend API for transaction queue management
- Add email/webhook notifications for approval requests
- Implement transaction history with approval status tracking
- Add signer management interface (add/remove signers)
- Support emergency pause functionality

## Technical Details
- Contract should store signer list and required threshold
- Each transaction should have: proposer, amount, recipient, execution_time, approvals[]
- Frontend needs real-time updates via WebSocket
- Backend should track pending vs executed transactions

## Acceptance Criteria
- ✅ Multi-signature contract deployed and tested
- ✅ Time-lock mechanism working correctly
- ✅ Frontend approval workflow functional
- ✅ Backend queue management operational
- ✅ Notification system integrated

## ETA
2 days

## Difficulty
Advanced"""
    },
    {
        "title": "Frontend + Backend | Build Decentralized Exchange (DEX) with Automated Market Maker (AMM) and Liquidity Pool Dashboard",
        "labels": "contract-development,defi,frontend,backend,advanced",
        "description": """## Description
Develop a full-featured DEX using constant product formula (x*y=k) with comprehensive liquidity management.

## Requirements
- Implement AMM contract with swap, add liquidity, remove liquidity functions
- Calculate fees (0.3% per swap) and distribute to liquidity providers
- Build frontend trading interface with price charts
- Create liquidity pool dashboard showing TVL, APY, user positions
- Implement slippage protection and price impact warnings
- Add backend for tracking historical prices and volume
- Support for multiple token pairs
- Real-time price updates using geometric mean

## Technical Details
- Use constant product formula: `token_a_reserve * token_b_reserve = k`
- Price = `reserve_b / reserve_a`
- Fee calculation: `amount * 0.003`
- LP tokens represent share of pool

## Acceptance Criteria
- ✅ AMM contract deployed with swap functionality
- ✅ Liquidity pool management working
- ✅ Frontend trading interface complete
- ✅ Dashboard showing TVL and APY
- ✅ Slippage protection implemented

## ETA
2 days

## Difficulty
Advanced"""
    },
    {
        "title": "Frontend + Backend | Create Token Vesting Contract with Cliff Periods and Frontend Portfolio Tracker",
        "labels": "contract-development,tokenomics,frontend,backend,advanced",
        "description": """## Description
Build a token vesting system with customizable schedules, cliff periods, and comprehensive tracking dashboard.

## Requirements
- Smart contract supporting linear and milestone-based vesting
- Implement cliff period (no vesting until cliff ends)
- Build frontend showing vesting schedules with visual timelines
- Create portfolio tracker showing vested vs locked tokens
- Add backend for automated vesting calculations
- Support multiple beneficiaries per contract
- Implement early termination with penalty calculation
- Add notification system for vesting milestones

## Technical Details
- Store: start_time, cliff_duration, total_duration, total_amount
- Calculate vested: `if now < cliff: 0, else: (now - start) / total_duration * total_amount`
- Frontend needs Gantt chart visualization
- Backend should cron-check vesting events

## Acceptance Criteria
- ✅ Vesting contract with cliff periods
- ✅ Frontend portfolio tracker
- ✅ Visual timeline of vesting schedule
- ✅ Backend automated calculations
- ✅ Notification system working

## ETA
2 days

## Difficulty
Advanced"""
    },
]

def create_issue(issue_data, index):
    """Create a single GitHub issue"""
    title = issue_data["title"]
    labels = issue_data["labels"]
    body = issue_data["description"]
    
    cmd = [
        "gh", "issue", "create",
        "--title", title,
        "--body", body,
        "--label", labels
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print(f"✓ Created Issue #{index + 1}: {title[:60]}...")
        return True
    except subprocess.CalledProcessError as e:
        print(f"✗ Failed to create Issue #{index + 1}: {e.stderr}")
        return False

def main():
    print("Starting to create 50 complex GitHub issues...\n")
    
    success_count = 0
    for i, issue in enumerate(issues):
        if create_issue(issue, i):
            success_count += 1
        time.sleep(2)  # Rate limit avoidance
    
    print(f"\n✅ Successfully created {success_count}/{len(issues)} issues!")

if __name__ == "__main__":
    main()
