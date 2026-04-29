# REIT API Documentation

## Base URL
```
http://localhost:5000/api/reit
```

## Authentication
Most read endpoints are public. Write endpoints require wallet signature verification through the contract.

## Rate Limiting
- Standard endpoints: 100 requests per 15 minutes
- Contract invocation endpoints: 10 requests per minute

## Endpoints

### Properties

#### List Properties
```
GET /api/reit/properties
```

Query Parameters:
- `contractId` (required): Contract ID
- `status` (optional): Filter by status (Listed, Funded, Active, Suspended, Delisted)
- `minPrice` (optional): Minimum price per share
- `maxPrice` (optional): Maximum price per share
- `location` (optional): Location search term
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20, max: 100)

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "property_id": 1,
      "name": "Sunset Apartments",
      "description": "Luxury apartment complex",
      "location": "Miami, FL",
      "total_shares": 1000,
      "shares_sold": 750,
      "price_per_share": 10000000,
      "total_valuation": 10000000000,
      "status": "Listed",
      "target_yield_bps": 500,
      "created_at": 1704067200000,
      "updated_at": 1704067200000
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50,
    "totalPages": 3
  }
}
```

#### Get Property
```
GET /api/reit/properties/:id
```

Query Parameters:
- `contractId` (required): Contract ID

Response:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "property_id": 1,
    "name": "Sunset Apartments",
    "description": "Luxury apartment complex",
    "location": "Miami, FL",
    "total_shares": 1000,
    "shares_sold": 750,
    "price_per_share": 10000000,
    "total_valuation": 10000000000,
    "pending_dividend": 500000000,
    "total_dividend_distributed": 1500000000,
    "status": "Active",
    "target_yield_bps": 500,
    "metadata_uri": "ipfs://Qm...",
    "recent_distributions": []
  }
}
```

#### Get Property Statistics
```
GET /api/reit/properties/stats
```

Query Parameters:
- `contractId` (required): Contract ID

Response:
```json
{
  "success": true,
  "data": {
    "total_properties": 10,
    "listed_count": 3,
    "active_count": 5,
    "funded_count": 2,
    "total_valuation": 500000000000,
    "total_funded": 375000000000,
    "avg_yield_bps": 650
  }
}
```

### Investors

#### Get Investor
```
GET /api/reit/investors/:address
```

Parameters:
- `address` (required): Stellar address

Response:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "address": "GABC...",
    "total_properties": 3,
    "total_shares": 500,
    "total_invested": 5000000000,
    "total_dividends_claimed": 250000000,
    "first_investment_at": 1704067200000,
    "last_activity_at": 1706659200000,
    "is_blacklisted": false
  }
}
```

#### Get Investor Properties
```
GET /api/reit/investors/:address/properties
```

Query Parameters:
- `contractId` (required): Contract ID

Response:
```json
{
  "success": true,
  "data": {
    "properties": [
      {
        "id": 1,
        "property_id": 1,
        "investor_address": "GABC...",
        "shares": 100,
        "dividend_claimed": 50000000,
        "name": "Sunset Apartments",
        "location": "Miami, FL",
        "status": "Active",
        "price_per_share": 10000000
      }
    ],
    "portfolio_summary": {
      "property_count": 3,
      "total_shares": 500,
      "portfolio_value": 5000000000,
      "total_dividends": 250000000,
      "avg_yield_bps": 600
    }
  }
}
```

#### Get Claimable Dividends
```
GET /api/reit/investors/:address/claimable
```

Query Parameters:
- `contractId` (required): Contract ID

Response:
```json
{
  "success": true,
  "data": {
    "total_claimable": 75000000,
    "by_property": [
      {
        "property_id": 1,
        "property_name": "Sunset Apartments",
        "shares": 100,
        "claimable_amount": 25000000
      }
    ]
  }
}
```

### Transactions

#### List Transactions
```
GET /api/reit/transactions
```

Query Parameters:
- `contractId` (optional): Filter by contract
- `investor` (optional): Filter by investor address
- `type` (optional): Filter by type (buy_shares, transfer_shares, claim_dividends, deposit_dividends)
- `status` (optional): Filter by status (pending, success, failed)
- `startDate` (optional): Filter from timestamp
- `endDate` (optional): Filter to timestamp
- `page` (optional): Page number
- `limit` (optional): Items per page

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "tx_hash": "abc123...",
      "tx_type": "buy_shares",
      "property_id": 1,
      "investor_address": "GABC...",
      "amount": 1000000000,
      "shares": 100,
      "status": "success",
      "created_at": 1704067200000
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

#### Log Transaction
```
POST /api/reit/transactions
```

Request Body:
```json
{
  "contract_id": "CAC...",
  "tx_hash": "abc123...",
  "tx_type": "buy_shares",
  "property_id": 1,
  "investor_address": "GABC...",
  "amount": 1000000000,
  "shares": 100,
  "status": "pending"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "id": 123
  }
}
```

### Distributions

#### List Distributions
```
GET /api/reit/distributions
```

Query Parameters:
- `contractId` (required): Contract ID
- `propertyId` (optional): Filter by property
- `page` (optional): Page number
- `limit` (optional): Items per page

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "distribution_id": 1,
      "property_id": 1,
      "total_amount": 1000000000,
      "amount_per_share": 1000000,
      "distribution_type": "Quarterly",
      "distributed_at": 1704067200000
    }
  ]
}
```

### Analytics

#### Dashboard Data
```
GET /api/reit/analytics/dashboard
```

Query Parameters:
- `contractId` (required): Contract ID

Response:
```json
{
  "success": true,
  "data": {
    "reit_info": {
      "name": "Stellar REIT",
      "symbol": "SREIT",
      "total_properties": 10,
      "total_investors": 50,
      "total_value_locked": 500000000000
    },
    "property_stats": {
      "total_properties": 10,
      "listed_count": 3,
      "active_count": 5,
      "total_valuation": 500000000000
    },
    "performance_30d": {
      "new_investors": 15,
      "total_invested": 100000000000,
      "total_dividends": 25000000000,
      "total_transactions": 200
    },
    "yield_analytics": [
      {
        "property_id": 1,
        "name": "Sunset Apartments",
        "target_yield_bps": 500,
        "actual_yield_bps": 475
      }
    ]
  }
}
```

#### Performance Metrics
```
GET /api/reit/analytics/performance
```

Query Parameters:
- `contractId` (required): Contract ID
- `period` (optional): Time period (7d, 30d, 90d, 1y) - default: 30d

Response:
```json
{
  "success": true,
  "data": {
    "new_investors": 15,
    "total_invested": 100000000000,
    "total_dividends": 25000000000,
    "total_transactions": 200
  }
}
```

#### Yield Analytics
```
GET /api/reit/analytics/yield
```

Query Parameters:
- `contractId` (required): Contract ID

Response:
```json
{
  "success": true,
  "data": [
    {
      "property_id": 1,
      "name": "Sunset Apartments",
      "target_yield_bps": 500,
      "total_valuation": 100000000000,
      "distribution_count": 4,
      "total_distributed": 4750000000,
      "actual_yield_bps": 475
    }
  ]
}
```

### REIT Configuration

#### Get Configuration
```
GET /api/reit/config
```

Query Parameters:
- `contractId` (required): Contract ID

Response:
```json
{
  "success": true,
  "data": {
    "contract_id": "CAC...",
    "name": "Stellar REIT",
    "symbol": "SREIT",
    "admin_address": "GABC...",
    "total_properties": 10,
    "total_investors": 50,
    "total_value_locked": 500000000000,
    "total_dividends_distributed": 125000000000,
    "platform_fee_bps": 100,
    "min_investment": 10000000,
    "max_investment_per_property": 100000000000,
    "is_paused": false
  }
}
```

### Contract Invocation (Admin/Investor)

#### Buy Shares
```
POST /api/reit/invoke/buy-shares
```

Rate Limit: 10 requests per minute

Request Body:
```json
{
  "contractId": "CAC...",
  "source": "GABC...",
  "propertyId": 1,
  "shares": 100
}
```

Response:
```json
{
  "success": true,
  "data": {
    "transaction_id": 123,
    "status": "pending",
    "message": "Transaction recorded, awaiting blockchain confirmation"
  }
}
```

#### Claim Dividends
```
POST /api/reit/invoke/claim-dividends
```

Rate Limit: 10 requests per minute

Request Body:
```json
{
  "contractId": "CAC...",
  "source": "GABC...",
  "propertyId": 1
}
```

Response:
```json
{
  "success": true,
  "data": {
    "transaction_id": 124,
    "status": "pending",
    "message": "Claim request recorded, awaiting blockchain confirmation"
  }
}
```

### Events

#### List Events
```
GET /api/reit/events
```

Query Parameters:
- `contractId` (required): Contract ID
- `eventType` (optional): Filter by event type
- `startLedger` (optional): Starting ledger sequence
- `endLedger` (optional): Ending ledger sequence
- `page` (optional): Page number
- `limit` (optional): Items per page

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "event_type": "prop_listed",
      "event_data": {
        "property_id": 1,
        "total_shares": 1000,
        "price_per_share": 10000000
      },
      "ledger_sequence": 5000000,
      "transaction_hash": "abc123...",
      "created_at": 1704067200000
    }
  ]
}
```

### Cache Management (Admin)

#### Clear Cache
```
POST /api/reit/cache/clear
```

Rate Limit: 10 requests per minute

Response:
```json
{
  "success": true,
  "message": "REIT caches cleared successfully"
}
```

#### Get Cache Stats
```
GET /api/reit/cache/stats
```

Response:
```json
{
  "success": true,
  "data": {
    "properties": {
      "size": 50,
      "hits": 1000,
      "misses": 100
    },
    "investors": {
      "size": 200,
      "hits": 5000,
      "misses": 500
    },
    "stats": {
      "size": 5,
      "hits": 10000,
      "misses": 50
    }
  }
}
```

## WebSocket Events

Connect to WebSocket at: `ws://localhost:5000/ws`

### Event Types

#### Property Updates
```json
{
  "type": "reit-property",
  "propertyId": 1,
  "data": {
    "shares_sold": 750,
    "status": "Funded"
  }
}
```

#### Transaction Updates
```json
{
  "type": "reit-transaction",
  "txHash": "abc123...",
  "status": "success"
}
```

#### Dividend Distribution
```json
{
  "type": "reit-dividend",
  "propertyId": 1,
  "amount": 1000000000
}
```

#### Stats Update
```json
{
  "type": "reit-stats",
  "stats": {
    "total_investors": 51,
    "total_value_locked": 510000000000
  }
}
```

## Error Responses

All errors follow this format:

```json
{
  "success": false,
  "error": "Error message",
  "details": "Additional details (optional)"
}
```

HTTP Status Codes:
- 200: Success
- 400: Bad Request (validation error)
- 404: Not Found
- 429: Rate Limited
- 500: Internal Server Error

## Data Types

### Property Status
- `Listed` - Accepting investments
- `Funded` - Funding goal reached
- `Active` - Generating returns
- `Suspended` - Temporarily paused
- `Delisted` - Permanently removed

### Transaction Types
- `buy_shares` - Share purchase
- `transfer_shares` - Share transfer
- `claim_dividends` - Dividend claim
- `deposit_dividends` - Admin dividend deposit
- `list_property` - New property listing

### Transaction Status
- `pending` - Awaiting confirmation
- `success` - Confirmed on blockchain
- `failed` - Failed/reverted

### Distribution Types
- `Quarterly` - Regular quarterly distribution
- `Special` - Special dividend
- `SaleProceeds` - Property sale proceeds
- `RentalIncome` - Rental income distribution
