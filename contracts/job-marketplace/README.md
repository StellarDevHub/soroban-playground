# Job Marketplace Contract with Escrow Payment and Skill Verification

## Overview

A comprehensive Job Marketplace system built on Stellar's Soroban smart contract platform with escrow payment functionality and skill verification. This full-stack application includes a Soroban smart contract, Node.js backend API, and React/Next.js frontend interface.

## Features

### Smart Contract (Soroban/Rust)
- ✅ Milestone-based escrow payments
- ✅ Skill verification and certification system
- ✅ Dispute resolution mechanism
- ✅ Emergency pause functionality
- ✅ Comprehensive event emissions
- ✅ Role-based access control
- ✅ Custom error handling
- ✅ Gas-optimized storage patterns

### Backend (Node.js + Express)
- ✅ RESTful API with comprehensive endpoints
- ✅ Caching strategies with Redis
- ✅ Request validation and error handling
- ✅ Database integration with PostgreSQL
- ✅ Rate limiting and security middleware
- ✅ Analytics and reporting endpoints
- ✅ Health check endpoints

### Frontend (React/Next.js + TypeScript)
- ✅ Responsive UI with TailwindCSS
- ✅ Job listing and filtering
- ✅ Job creation with milestone management
- ✅ Real-time status updates
- ✅ User-friendly forms with validation
- ✅ Component-based architecture
- ✅ Mobile-responsive design

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (Next.js)                       │
│  ┌──────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │Job Cards │  │Create Job    │  │User Dashboard       │   │
│  │& Filters │  │Form          │  │& Analytics          │   │
│  └──────────┘  └──────────────┘  └─────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │ REST API
┌────────────────────────▼────────────────────────────────────┐
│                  Backend (Express.js)                        │
│  ┌──────────────────┐  ┌──────────────────────────────┐    │
│  │Route Handlers    │  │Service Layer                 │    │
│  │- Jobs            │  │- Contract Integration        │    │
│  │- Skills          │  │- Database Operations         │    │
│  │- Disputes        │  │- Cache Management            │    │
│  │- Analytics       │  │- Event Processing            │    │
│  └──────────────────┘  └──────────────────────────────┘    │
└────────┬──────────────────────────────┬─────────────────────┘
         │                              │
┌────────▼────────┐          ┌──────────▼──────────────────┐
│  PostgreSQL DB  │          │  Soroban Smart Contract     │
│  - Jobs         │          │  - Job Management           │
│  - Milestones   │          │  - Escrow Payments          │
│  - Skills       │          │  - Skill Verification       │
│  - Disputes     │          │  - Dispute Resolution       │
│  - Certs        │          │  - Admin Controls           │
└─────────────────┘          └─────────────────────────────┘
```

## Smart Contract

### Core Functions

#### Job Management
- `create_job()` - Create a new job with escrow payment
- `accept_job()` - Accept a job as a freelancer
- `release_milestone()` - Release milestone payment to freelancer
- `cancel_job()` - Cancel an open job and refund escrow

#### Skill Verification
- `verify_skill()` - Verify a skill for a user (admin only)
- `get_user_skills()` - Get user's verified skills

#### Certification
- `issue_certification()` - Issue a certification to a user (admin only)
- `get_certification()` - Get certification details

#### Dispute Resolution
- `raise_dispute()` - Raise a dispute on a job
- `resolve_dispute()` - Resolve a dispute (admin only)

#### Admin Controls
- `pause()` - Pause the contract (emergency stop)
- `unpause()` - Unpause the contract
- `transfer_admin()` - Transfer admin rights

### Events

The contract emits the following events:
- `job_crtd` - Job created
- `job_accpt` - Job accepted
- `ms_rlsd` - Milestone released
- `job_cmplt` - Job completed
- `job_cncld` - Job cancelled
- `disp_rlsd` - Dispute raised
- `disp_rslv` - Dispute resolved
- `skill_vrf` - Skill verified
- `cert_iss` - Certification issued
- `paused` - Contract paused
- `unpause` - Contract unpaused

### Error Types

```rust
pub enum Error {
    AlreadyInitialized,
    ContractPaused,
    EmptyField,
    InvalidEscrowAmount,
    MilestoneSumMismatch,
    JobNotFound,
    JobNotOpen,
    JobNotInProgress,
    JobNotCompleted,
    ClientCannotBeFreelancer,
    FreelancerNotFound,
    Unauthorized,
    InvalidMilestoneIndex,
    MilestoneAlreadyReleased,
    CannotCancelJob,
    SkillNotVerified,
    InvalidSkillLevel,
    InvalidValidityPeriod,
    CertificationNotFound,
    DisputeNotFound,
    DisputeAlreadyResolved,
    InvalidRefundAmount,
}
```

## Backend API

### Base URL
```
http://localhost:5000/api/job-marketplace
```

### Endpoints

#### Jobs
- `GET /jobs` - Get all jobs with filtering and pagination
- `GET /jobs/:jobId` - Get job details
- `POST /jobs` - Create a new job
- `POST /jobs/:jobId/accept` - Accept a job
- `POST /jobs/:jobId/release-milestone` - Release milestone
- `POST /jobs/:jobId/cancel` - Cancel a job

#### Skills
- `GET /skills/:user` - Get user skills
- `POST /skills/verify` - Verify a skill (admin)

#### Certifications
- `GET /certifications/:user` - Get user certifications
- `POST /certifications/issue` - Issue certification (admin)

#### Disputes
- `GET /disputes/:disputeId` - Get dispute details
- `POST /disputes/raise` - Raise a dispute
- `POST /disputes/:disputeId/resolve` - Resolve dispute (admin)

#### Admin
- `POST /admin/pause` - Pause contract
- `POST /admin/unpause` - Unpause contract
- `GET /admin/status` - Get contract status

#### Analytics
- `GET /analytics/overview` - Get marketplace analytics
- `GET /analytics/user/:address` - Get user analytics

### Request/Response Examples

#### Create Job
```bash
POST /api/job-marketplace/jobs
Content-Type: application/json

{
  "client": "GABC123...",
  "title": "Smart Contract Developer",
  "description": "Build a Soroban DeFi contract",
  "paymentToken": "CDXM456...",
  "totalEscrow": "1000000000",
  "milestones": [
    {
      "description": "Design and planning",
      "amount": "300000000"
    },
    {
      "description": "Implementation",
      "amount": "500000000"
    },
    {
      "description": "Testing and deployment",
      "amount": "200000000"
    }
  ],
  "requiredSkills": ["RUST", "SOROBAN", "DEFI"]
}
```

#### Response
```json
{
  "success": true,
  "data": {
    "id": 1,
    "client": "GABC123...",
    "title": "Smart Contract Developer",
    "status": "Open",
    "total_escrow": "1000000000",
    "created_at": "2026-04-29T10:00:00.000Z"
  }
}
```

## Frontend

### Pages

- `/job-marketplace` - Job listing page with filters
- `/job-marketplace/jobs/:id` - Job details page
- `/job-marketplace/create` - Create job page
- `/job-marketplace/profile` - User profile with skills and certifications

### Components

- `JobCard` - Display job information
- `CreateJobForm` - Form for creating new jobs
- `JobFilters` - Filter and search jobs
- `MilestoneManager` - Manage job milestones
- `SkillBadge` - Display skill verification
- `DisputeModal` - Raise and view disputes

### Technologies

- Next.js 14+
- React 18+
- TypeScript
- TailwindCSS
- React Hooks
- Fetch API

## Database Schema

### Tables

#### jobs
- `id` - Job ID (primary key)
- `client` - Client address
- `freelancer` - Freelancer address
- `title` - Job title
- `description` - Job description
- `payment_token` - Token contract address
- `total_escrow` - Total escrow amount
- `released_amount` - Released amount
- `status` - Job status
- `required_skills` - Required skills (JSON)
- `created_at` - Creation timestamp
- `accepted_at` - Acceptance timestamp
- `completed_at` - Completion timestamp

#### job_milestones
- `id` - Milestone ID (primary key)
- `job_id` - Job ID (foreign key)
- `description` - Milestone description
- `amount` - Milestone amount
- `is_released` - Release status
- `milestone_index` - Milestone order

#### user_skills
- `id` - Skill ID (primary key)
- `user_address` - User address
- `skill` - Skill name
- `level` - Skill level (1-5)
- `verified_at` - Verification timestamp
- `verified_by` - Verifier address

#### user_certifications
- `id` - Certification ID (primary key)
- `user_address` - User address
- `name` - Certification name
- `issuer` - Issuer name
- `issued_at` - Issue timestamp
- `valid_until` - Expiry timestamp

#### disputes
- `id` - Dispute ID (primary key)
- `job_id` - Job ID (foreign key)
- `raised_by` - User who raised dispute
- `reason` - Dispute reason
- `created_at` - Creation timestamp
- `resolved_at` - Resolution timestamp
- `resolution` - Resolution details
- `resolved_by` - Resolver address

## Setup and Installation

### Prerequisites

- Rust and Cargo (for smart contract)
- Node.js 18+ and npm
- PostgreSQL database
- Soroban CLI

### Smart Contract

```bash
# Navigate to contract directory
cd contracts/job-marketplace

# Build the contract
soroban contract build

# Run tests
cargo test

# Deploy to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/job_marketplace.wasm \
  --source your_alias \
  --network testnet
```

### Backend

```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
npm run migrate up

# Start the server
npm run dev
```

### Frontend

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Set up environment variables
cp .env.local.example .env.local
# Edit .env.local with your configuration

# Start the development server
npm run dev
```

## Environment Variables

### Backend (.env)
```env
PORT=5000
DATABASE_URL=postgresql://user:password@localhost:5432/soroban_playground
REDIS_URL=redis://localhost:6379
JOB_MARKETPLACE_CONTRACT_ID=your_contract_id
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

### Frontend (.env.local)
```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api
NEXT_PUBLIC_JOB_MARKETPLACE_CONTRACT_ID=your_contract_id
```

## Testing

### Smart Contract Tests

```bash
cd contracts/job-marketplace
cargo test
```

### Backend Tests

```bash
cd backend
npm test
```

### Integration Tests

```bash
cd backend
npm run test:integration
```

## Security Considerations

### Smart Contract
- ✅ Checks-effects-interactions pattern
- ✅ Pull over push payment pattern
- ✅ Input validation on all functions
- ✅ Access control modifiers
- ✅ Emergency pause mechanism
- ✅ Reentrancy protection

### Backend
- ✅ Input validation with express-validator
- ✅ Rate limiting on all endpoints
- ✅ SQL injection prevention (parameterized queries)
- ✅ XSS protection
- ✅ CORS configuration
- ✅ Error handling middleware

### Frontend
- ✅ Input sanitization
- ✅ CSRF protection
- ✅ Secure HTTP headers
- ✅ Wallet signature verification

## Performance Optimization

### Smart Contract
- Optimized storage patterns
- Minimal on-chain data
- Efficient event emissions
- Gas-optimized computations

### Backend
- Redis caching for frequently accessed data
- Database query optimization
- Connection pooling
- Index optimization

### Frontend
- Component lazy loading
- Image optimization
- Code splitting
- Efficient re-rendering

## Monitoring and Analytics

### Metrics Tracked
- Total jobs created
- Active jobs
- Completed jobs
- Total volume locked
- Average job completion time
- Dispute rate
- User activity

### Real-time Dashboard
- Job statistics
- Volume analytics
- Top skills
- User rankings
- Dispute resolution time

## Deployment Guide

### Smart Contract Deployment

1. Build the contract:
```bash
soroban contract build
```

2. Deploy to testnet:
```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/job_marketplace.wasm \
  --source your_alias \
  --network testnet
```

3. Initialize the contract:
```bash
soroban contract invoke \
  --id CONTRACT_ID \
  --source your_alias \
  --network testnet \
  -- \
  initialize \
  --admin YOUR_ADMIN_ADDRESS
```

### Backend Deployment

1. Set up PostgreSQL database
2. Configure environment variables
3. Run migrations:
```bash
npm run migrate up
```

4. Start the server:
```bash
npm start
```

### Frontend Deployment

1. Configure environment variables
2. Build the application:
```bash
npm run build
```

3. Start the production server:
```bash
npm start
```

## Troubleshooting

### Common Issues

**Contract deployment fails**
- Ensure you have sufficient testnet XLM
- Check Soroban CLI version compatibility
- Verify network configuration

**Database connection errors**
- Verify DATABASE_URL is correct
- Ensure PostgreSQL is running
- Check database permissions

**API returns 500 errors**
- Check backend logs
- Verify contract ID configuration
- Ensure all services are running

**Frontend doesn't load data**
- Check API URL configuration
- Verify backend is accessible
- Check browser console for errors

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions:
- Open an issue on GitHub
- Contact the development team
- Check existing documentation

## Roadmap

- [ ] WebSocket integration for real-time updates
- [ ] Advanced search and filtering
- [ ] Rating and review system
- [ ] Automated milestone verification
- [ ] Multi-token support
- [ ] Mobile application
- [ ] Advanced analytics dashboard
- [ ] Integration with Stellar wallets

## Acknowledgments

- Stellar Development Foundation
- Soroban team
- Open source contributors
