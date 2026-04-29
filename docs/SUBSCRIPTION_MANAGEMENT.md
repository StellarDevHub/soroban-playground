# Subscription Management System

A comprehensive subscription management system built with Soroban smart contracts, Node.js backend, and React frontend.

## Overview

This system provides a complete subscription management solution with:

- **Smart Contract**: Soroban-based subscription management with plan creation, subscription lifecycle management, and admin controls
- **Backend API**: RESTful API with real-time WebSocket updates, caching, and monitoring
- **Frontend**: React-based dashboard with real-time updates and comprehensive UI components
- **Security**: Multi-layered security with input validation, rate limiting, and access control
- **Monitoring**: Comprehensive metrics collection, health checks, and alerting

## Architecture

```
Frontend (React/Next.js)
    |
    v
Backend API (Node.js/Express)
    |
    v
Smart Contract (Soroban/Rust)
```

## Features

### Smart Contract Features
- Plan management (create, update, delete subscription plans)
- Subscription lifecycle (create, renew, cancel, auto-renew)
- Admin controls (pause contract, update fees, transfer admin)
- Access control and authorization
- Event emission for real-time updates

### Backend API Features
- RESTful endpoints for all subscription operations
- Real-time WebSocket updates
- Caching for performance optimization
- Rate limiting and security middleware
- Comprehensive monitoring and analytics
- Health checks and alerting

### Frontend Features
- Interactive subscription dashboard
- Real-time updates via WebSocket
- Plan management interface
- Subscription lifecycle management
- Admin controls and analytics
- Responsive design with modern UI

## Quick Start

### Prerequisites

- Node.js 18+
- Rust and Cargo
- Soroban CLI
- Docker (optional)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd soroban-playground
```

2. Install backend dependencies:
```bash
cd backend
npm install
```

3. Install frontend dependencies:
```bash
cd ../frontend
npm install
```

4. Build the smart contract:
```bash
cd ../contracts/subscription-management
cargo build --target wasm32-unknown-unknown --release
```

### Deployment

1. Deploy the smart contract:
```bash
chmod +x ../scripts/deploy-contract.sh
../scripts/deploy-contract.sh all
```

2. Start the backend:
```bash
cd backend
npm start
```

3. Start the frontend:
```bash
cd frontend
npm run dev
```

## API Documentation

### Authentication

All API endpoints require authentication via JWT token:

```http
Authorization: Bearer <token>
```

### Endpoints

#### Plan Management

- `GET /api/subscription/plans` - Get all subscription plans
- `GET /api/subscription/plans/:planId` - Get specific plan
- `POST /api/subscription/plans` - Create new plan
- `PUT /api/subscription/plans/:planId` - Update plan
- `DELETE /api/subscription/plans/:planId` - Delete plan

#### Subscription Management

- `GET /api/subscription/subscriptions` - Get user subscriptions
- `GET /api/subscription/subscriptions/:subscriptionId` - Get specific subscription
- `POST /api/subscription/subscriptions` - Create subscription
- `POST /api/subscription/subscriptions/:subscriptionId/cancel` - Cancel subscription
- `POST /api/subscription/subscriptions/:subscriptionId/renew` - Renew subscription
- `POST /api/subscription/subscriptions/:subscriptionId/auto-renew` - Toggle auto-renew

#### Admin Functions

- `GET /api/subscription/stats` - Get subscription statistics
- `POST /api/subscription/admin/pause` - Pause/unpause contract
- `POST /api/subscription/admin/platform-fee` - Update platform fee
- `POST /api/subscription/admin/transfer-admin` - Transfer admin rights

### WebSocket Events

Real-time events are emitted via WebSocket at `/ws/subscription`:

- `PLAN_CREATED` - New plan created
- `PLAN_UPDATED` - Plan updated
- `SUBSCRIPTION_CREATED` - New subscription created
- `SUBSCRIPTION_CANCELLED` - Subscription cancelled
- `STATS_UPDATED` - Statistics updated

## Smart Contract API

### Functions

#### `initialize(admin: Address, platform_fee_bps: u32)`
Initialize the subscription management system.

#### `create_plan(caller: Address, plan_id: String, name: String, price_per_period: i128, billing_period: u64)`
Create a new subscription plan.

#### `get_plan_details(plan_id: String) -> (String, i128, u64, bool)`
Get details of a specific plan.

#### `set_pause(caller: Address, paused: bool)`
Pause or unpause the contract.

### Events

- `init` - Contract initialization
- `plan_created` - Plan creation
- `pause` - Contract pause status change

## Configuration

### Environment Variables

#### Backend
```bash
# Server
PORT=3001
NODE_ENV=development

# Database (if applicable)
DATABASE_URL=your-database-url

# JWT
JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=24h

# Stellar
STELLAR_NETWORK=testnet
SUBSCRIPTION_CONTRACT_ID=your-contract-id

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:3001

# Rate Limiting
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX=100

# Monitoring
ENABLE_MONITORING=true
METRICS_INTERVAL=60000
```

#### Frontend
```bash
# API
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXT_PUBLIC_WS_URL=ws://localhost:3001

# Authentication
NEXT_PUBLIC_JWT_SECRET=your-jwt-secret
```

## Security

### Authentication & Authorization
- JWT-based authentication
- Role-based access control (admin/user)
- API key authentication for service-to-service

### Input Validation
- Comprehensive input validation on all endpoints
- Stellar address validation
- SQL injection prevention
- XSS protection

### Rate Limiting
- Different limits for different endpoint types
- IP-based rate limiting
- User-based rate limiting

### Other Security Measures
- CORS configuration
- Security headers (Helmet)
- Request size limits
- Request timeouts
- Audit logging

## Monitoring

### Metrics Collection
- Application metrics (requests, errors, response times)
- System metrics (CPU, memory, disk)
- Business metrics (subscriptions, revenue, churn)
- Custom metrics via API

### Health Checks
- API health check
- Database connectivity check
- Memory usage check
- WebSocket connectivity check

### Alerting
- Error rate alerts
- Response time alerts
- System resource alerts
- Health check failure alerts

### Dashboard
- Real-time metrics visualization
- Performance graphs
- Health status overview
- Alert management

## Testing

### Smart Contract Tests
```bash
cd contracts/subscription-management
cargo test
```

### Backend Tests
```bash
cd backend
npm test
```

### Frontend Tests
```bash
cd frontend
npm test
```

### Integration Tests
```bash
cd frontend
npm run test:integration
```

## Development

### Smart Contract Development
1. Make changes to the contract in `contracts/subscription-management/src/`
2. Build with `cargo build --target wasm32-unknown-unknown --release`
3. Test with `cargo test`
4. Deploy with the deployment script

### Backend Development
1. Make changes to the backend code
2. Test with `npm test`
3. Start development server with `npm run dev`

### Frontend Development
1. Make changes to the frontend code
2. Test with `npm test`
3. Start development server with `npm run dev`

## Deployment

### Smart Contract Deployment
Use the provided deployment script:
```bash
./scripts/deploy-contract.sh all
```

### Backend Deployment
```bash
cd backend
npm run build
npm start
```

### Frontend Deployment
```bash
cd frontend
npm run build
npm start
```

## Troubleshooting

### Common Issues

#### Smart Contract Compilation Errors
- Ensure Rust and Soroban CLI are installed
- Check for syntax errors in contract code
- Verify all dependencies are properly imported

#### Backend API Errors
- Check environment variables
- Verify database connection
- Check logs for detailed error messages

#### Frontend Connection Issues
- Verify API URL configuration
- Check WebSocket connection
- Ensure authentication tokens are valid

### Debugging

#### Smart Contract Debugging
- Use `soroban contract invoke` for manual testing
- Check transaction logs
- Use Stellar Explorer for transaction details

#### Backend Debugging
- Enable debug logging
- Use monitoring dashboard
- Check health endpoints

#### Frontend Debugging
- Use browser developer tools
- Check network requests
- Verify WebSocket connection

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For support and questions:
- Create an issue in the repository
- Check the documentation
- Review existing issues and discussions

## Roadmap

### Phase 1 (Current)
- Basic subscription management
- Smart contract implementation
- Backend API
- Frontend dashboard

### Phase 2 (Planned)
- Advanced analytics
- Multi-currency support
- Mobile app
- Enhanced security features

### Phase 3 (Future)
- AI-powered insights
- Advanced automation
- Enterprise features
- Global deployment
