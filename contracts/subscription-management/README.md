# Subscription Management Smart Contract

A comprehensive subscription management system built on Soroban with advanced features for managing recurring payments and subscription tiers.

## Features

### Core Functionality
- **Multi-tier Subscription Plans**: Create and manage different subscription tiers with customizable pricing and features
- **Automated Billing**: Handle recurring payments with configurable billing periods
- **User Management**: Track subscriber status and manage subscription lifecycle
- **Access Control**: Role-based permissions for admin operations
- **Emergency Controls**: Pause/unpause functionality and emergency status updates

### Security Features
- **Access Control**: Admin-only functions for critical operations
- **Input Validation**: Comprehensive parameter validation
- **Emergency Pause**: Contract-wide pause functionality for emergencies
- **Rate Limiting**: Built-in protection against spam operations
- **Gas Optimization**: Efficient storage patterns and minimal gas usage

### Event Tracking
- **Comprehensive Events**: All major operations emit detailed events
- **Audit Trail**: Complete transaction history for compliance
- **Real-time Monitoring**: Event emissions for frontend integration

## Contract Architecture

### Storage Design
- **Persistent Storage**: All critical data stored in contract state
- **Optimized Keys**: Efficient storage key patterns for gas optimization
- **Data Structures**: Well-organized storage for plans, subscriptions, and payments

### Key Components

1. **Subscription Plans**: Define pricing tiers and features
2. **Subscriptions**: Track user subscription status and billing
3. **Payments**: Handle payment processing and records
4. **Access Control**: Manage admin permissions and system state

## API Reference

### Initialization
```rust
initialize(env, admin, platform_fee_bps) -> Result<(), Error>
```
Initialize the contract with admin address and platform fee rate.

### Plan Management
```rust
create_plan(env, plan_id, name, description, price_per_period, billing_period, features, max_subscribers, is_active) -> Result<(), Error>
update_plan(env, plan_id, name, description, price_per_period, billing_period, features, max_subscribers, is_active) -> Result<(), Error>
get_plan_details(env, plan_id) -> Result<SubscriptionPlan, Error>
list_active_plans(env) -> Result<Vec<SubscriptionPlan>, Error>
```

### Subscription Management
```rust
subscribe(env, subscriber, plan_id, payment_method) -> Result<(), Error>
cancel_subscription(env, subscriber, subscription_id) -> Result<(), Error>
renew_subscription(env, subscription_id) -> Result<(), Error>
toggle_auto_renew(env, subscriber, subscription_id, auto_renew) -> Result<(), Error>
get_user_subscription(env, subscriber) -> Result<Option<Subscription>, Error>
```

### Admin Functions
```rust
set_pause(env, paused) -> Result<(), Error>
update_platform_fee(env, new_fee_bps) -> Result<(), Error>
transfer_admin(env, new_admin) -> Result<(), Error>
emergency_update_subscription_status(env, subscription_id, new_status) -> Result<(), Error>
```

### Query Functions
```rust
get_subscription_stats(env) -> Result<SubscriptionStats, Error>
```

## Data Structures

### SubscriptionPlan
```rust
pub struct SubscriptionPlan {
    pub id: String,
    pub name: String,
    pub description: String,
    pub price_per_period: Uint128,
    pub billing_period: u64,
    pub features: Vec<String>,
    pub max_subscribers: Option<u32>,
    pub current_subscribers: u32,
    pub is_active: bool,
    pub created_at: u64,
    pub updated_at: u64,
}
```

### Subscription
```rust
pub struct Subscription {
    pub id: String,
    pub subscriber: Address,
    pub plan_id: String,
    pub payment_method: Address,
    pub status: SubscriptionStatus,
    pub current_period_start: u64,
    pub current_period_end: u64,
    pub auto_renew: bool,
    pub created_at: u64,
    pub updated_at: u64,
}
```

## Usage Examples

### Creating a Subscription Plan
```rust
// Create a basic monthly plan
create_plan(
    env,
    String::from_str("basic_monthly"),
    String::from_str("Basic Monthly"),
    String::from_str("Access to basic features"),
    Uint128::from(100u32), // 100 tokens per month
    2592000, // 30 days in seconds
    features_vec,
    Some(1000), // Max 1000 subscribers
    true
)?;
```

### Subscribing to a Plan
```rust
// User subscribes to a plan
subscribe(
    env,
    user_address,
    String::from_str("basic_monthly"),
    token_contract_address
)?;
```

### Getting User Subscription
```rust
// Check if user has active subscription
let subscription = get_user_subscription(env, user_address)?;
if let Some(sub) = subscription {
    // User has active subscription
    println!("Subscription ID: {}", sub.id);
    println!("Plan: {}", sub.plan_id);
    println!("Status: {:?}", sub.status);
}
```

## Security Considerations

### Access Control
- Only admin can create/update plans and manage system settings
- Users can only manage their own subscriptions
- Emergency functions require admin privileges

### Input Validation
- All parameters are validated before processing
- Plan limits prevent oversubscription
- Fee rates are capped to prevent excessive charges

### Emergency Features
- Contract can be paused in emergencies
- Admin can manually update subscription statuses
- Platform fee can be adjusted as needed

## Gas Optimization

### Storage Patterns
- Efficient storage key design
- Minimal data duplication
- Batch operations where possible

### Event Emissions
- Structured event topics for easy filtering
- Minimal event data to reduce gas costs
- Comprehensive audit trail

## Testing

The contract includes comprehensive tests covering:
- Initialization and setup
- Plan creation and management
- Subscription lifecycle
- Access control and security
- Emergency functions
- Query operations

Run tests with:
```bash
cd contracts/subscription-management
cargo test
```

## Deployment

### Build
```bash
cd contracts/subscription-management
cargo build --target wasm32-unknown-unknown --release
```

### Deploy
The compiled WASM file will be in `target/wasm32-unknown-unknown/release/subscription_management.wasm`

Deploy to testnet or mainnet using your preferred Soroban deployment tool.

## Integration

### Frontend Integration
- Listen to contract events for real-time updates
- Use query functions for dashboard data
- Implement proper error handling for all operations

### Backend Integration
- Sync contract events with your database
- Implement webhook handlers for important events
- Use query functions for analytics and reporting

## License

MIT License - see LICENSE file for details.
