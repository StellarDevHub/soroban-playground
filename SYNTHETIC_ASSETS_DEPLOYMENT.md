# Synthetic Assets Deployment & Configuration Guide

## Quick Start

### Prerequisites

- Node.js v18+
- Rust 1.70+
- Soroban CLI
- PostgreSQL 13+
- Redis 6+

### Local Development Setup

#### 1. Clone and Install

```bash
git clone https://github.com/your-org/soroban-playground.git
cd soroban-playground
npm install
```

#### 2. Setup Environment Files

**backend/.env**
```env
# Blockchain
STELLAR_NETWORK=testnet
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SYNTHETIC_ASSETS_CONTRACT_ID=CAAAA...
COLLATERAL_TOKEN=GBUQW...
ORACLE_ADDRESS=GABC...

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/synthetic_assets
DB_POOL_SIZE=10

# Cache
REDIS_URL=redis://localhost:6379

# API
PORT=3000
NODE_ENV=development
JWT_SECRET=your-secret-key-here

# Rate Limiting
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=debug
LOG_FILE=./logs/app.log
```

**frontend/.env.local**
```env
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

#### 3. Start Services

```bash
# Terminal 1: Database & Redis
docker-compose up -d

# Terminal 2: Backend
cd backend
npm run migrate
npm run dev

# Terminal 3: Frontend
cd frontend
npm run dev
```

Visit http://localhost:3000 for the frontend.

## Testnet Deployment

### 1. Deploy Smart Contract

```bash
cd contracts/synthetic-assets

# Compile to WASM
cargo build --release --target wasm32-unknown-unknown

# Deploy to Stellar Testnet
soroban contract deploy \
  --network testnet \
  --source-account YOUR_STELLAR_ADDRESS \
  --wasm target/wasm32-unknown-unknown/release/synthetic_assets.wasm

# Note the contract ID (CAAAA...)
```

### 2. Deploy Backend

```bash
# Build Docker image
docker build -t synthetic-assets-backend:latest ./backend

# Run container
docker run -d \
  --name synthetic-assets-backend \
  -p 3000:3000 \
  --env-file backend/.env.prod \
  synthetic-assets-backend:latest

# Run migrations
docker exec synthetic-assets-backend npm run migrate
```

### 3. Deploy Frontend

```bash
# Build Next.js app
cd frontend
npm run build

# Deploy to Vercel
vercel deploy --prod

# Or use Docker
docker build -t synthetic-assets-frontend:latest ./frontend
docker run -d \
  --name synthetic-assets-frontend \
  -p 80:3000 \
  --env-file frontend/.env.prod \
  synthetic-assets-frontend:latest
```

## Mainnet Deployment Checklist

- [ ] Contract security audit completed
- [ ] All tests passing (coverage >90%)
- [ ] Rate limiting configured
- [ ] Database backups enabled
- [ ] Redis persistence enabled
- [ ] Logging and monitoring set up
- [ ] DNS and SSL configured
- [ ] Load balancing configured
- [ ] Disaster recovery plan documented
- [ ] Admin keys secured in vault

## Configuration Reference

### Contract Parameters

```javascript
const CONFIG = {
  MIN_COLLATERAL_RATIO: 15000,      // 150%
  LIQUIDATION_THRESHOLD: 12000,     // 120%
  LIQUIDATION_BONUS: 500,           // 5%
  FEE_PERCENTAGE: 100,              // 1%
  MAX_PRICE_AGE: 300,               // 5 minutes
  MIN_PRICE_CONFIDENCE: 50,         // 50%
};
```

### Backend Configuration

```javascript
const BACKEND_CONFIG = {
  API_TIMEOUT: 30000,               // 30 seconds
  CACHE_TTL: {
    POSITION: 30,                   // 30 seconds
    ASSET_PRICE: 5,                 // 5 seconds
    LIQUIDATION_CHECK: 10,          // 10 seconds
    PROTOCOL_PARAMS: 300,           // 5 minutes
  },
  RATE_LIMITS: {
    COMPILE: { window: 60000, max: 10 },
    DEPLOY: { window: 60000, max: 5 },
    MINT: { window: 60000, max: 50 },
    TRADE: { window: 60000, max: 100 },
  },
  MONITORING_INTERVAL: 30000,       // 30 seconds
};
```

### WebSocket Configuration

```javascript
const WS_CONFIG = {
  RECONNECT_INTERVAL: 3000,
  MAX_RECONNECT_ATTEMPTS: 10,
  HEARTBEAT_INTERVAL: 30000,
  MESSAGE_QUEUE_SIZE: 1000,
};
```

## Monitoring & Observability

### Set up Prometheus Metrics

```bash
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'synthetic-assets'
    static_configs:
      - targets: ['localhost:3000']
```

### Key Metrics to Monitor

- API response times (p50, p95, p99)
- Database query times
- Cache hit/miss ratio
- WebSocket connection count
- Transaction throughput
- Error rate by endpoint
- Liquidation events per hour

### Set up Alerts

```yaml
groups:
  - name: synthetic-assets
    rules:
      - alert: HighAPILatency
        expr: http_request_duration_seconds > 1
        for: 5m
      - alert: HighErrorRate
        expr: rate(errors_total[5m]) > 0.05
      - alert: CacheMissRate
        expr: cache_miss_ratio > 0.5
      - alert: DatabaseDown
        expr: up{job="postgres"} == 0
```

## Backup & Recovery

### Database Backups

```bash
# Daily automated backups
0 2 * * * pg_dump -U postgres synthetic_assets | gzip > /backups/db-$(date +%Y%m%d).sql.gz

# Restore from backup
zcat /backups/db-20240115.sql.gz | psql -U postgres synthetic_assets
```

### State Snapshots

```bash
# Capture contract state
soroban contract invoke \
  --network testnet \
  --id CAAAA... \
  --method get_state

# Store snapshot to S3
aws s3 cp state-snapshot.json s3://backups/state-$(date +%Y%m%d-%H%M%S).json
```

## Performance Tuning

### Database Optimization

```sql
-- Create indexes for common queries
CREATE INDEX CONCURRENTLY idx_positions_status ON positions(status);
CREATE INDEX CONCURRENTLY idx_positions_user_date ON positions(user_address, created_at DESC);
CREATE INDEX CONCURRENTLY idx_events_time ON synthetic_asset_events(created_at DESC);

-- Analyze query plans
EXPLAIN ANALYZE SELECT * FROM positions WHERE user_address = $1 AND status = 'OPEN';
```

### Redis Optimization

```bash
# Maxmemory policy
CONFIG SET maxmemory-policy allkeys-lru

# Enable persistence
CONFIG SET save "900 1 300 10 60 10000"

# Monitor performance
INFO stats
INFO memory
```

### Application Optimization

```javascript
// Enable gzip compression
app.use(compression());

// Set appropriate cache headers
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    res.set('Cache-Control', 'private, max-age=5');
  }
  next();
});

// Connection pooling
const pool = new Pool({
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

## Troubleshooting Deployment

### Smart Contract Issues

**Contract Deploy Fails**
```bash
# Check contract compilation
cargo build --release --target wasm32-unknown-unknown --verbose

# Check account balance
soroban account balance YOUR_ACCOUNT --network testnet

# Check contract ID format
# Should start with 'C' and be 56 characters
```

**Transaction Timeout**
```bash
# Increase timeout in config
soroban container invoke \
  --network testnet \
  --timeout 30 \
  ...
```

### Backend Issues

**Port Already in Use**
```bash
# Find process using port 3000
lsof -i :3000

# Kill and restart
kill -9 <PID>
npm run dev
```

**Database Connection Error**
```bash
# Check PostgreSQL is running
pg_isready -h localhost -p 5432

# Check credentials
psql -U postgres -d synthetic_assets -h localhost

# Check pool settings in backend/.env
DATABASE_URL=postgresql://user:password@localhost:5432/synthetic_assets?sslmode=disable
```

**Redis Connection Error**
```bash
# Check Redis is running
redis-cli ping

# Check Redis port and password
redis-cli -h 127.0.0.1 -p 6379 ping

# Check REDIS_URL format
REDIS_URL=redis://:password@hostname:6379/0
```

### Frontend Issues

**WebSocket Connection Fails**
```javascript
// Check WebSocket URL
NEXT_PUBLIC_API_URL=http://localhost:3000

// Verify server is running
curl http://localhost:3000/health

// Check network tab in browser DevTools
```

**Build Fails**
```bash
# Clear cache and rebuild
rm -rf .next
npm run build -- --verbose

# Check environment variables
cat .env.local
```

## Maintenance

### Regular Tasks

- **Daily**: Monitor error rates and performance metrics
- **Weekly**: Review database index usage and query performance
- **Monthly**: Run security scans and dependency updates
- **Quarterly**: Load test and capacity planning review
- **Yearly**: Security audit and disaster recovery drill

### Updates & Patches

```bash
# Check for vulnerabilities
npm audit

# Update dependencies
npm update

# Update Rust
rustup update

# Update Soroban CLI
cargo install soroban-cli --force
```

## Support Contacts

- **Technical Support**: support@example.com
- **Security Issues**: security@example.com
- **Emergency Contact**: +1-555-0123 (on-call)

## Additional Resources

- [Stellar Documentation](https://developers.stellar.org)
- [Soroban Documentation](https://soroban.stellar.org)
- [Node.js Best Practices](https://nodejs.org/en/docs/guides/)
- [React/Next.js Documentation](https://nextjs.org/docs)
