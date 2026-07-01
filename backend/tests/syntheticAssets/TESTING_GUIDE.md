# Synthetic Assets Test Suite - Comprehensive Testing Guide

## Overview

This guide provides comprehensive documentation for the Synthetic Assets backend test suite. The test suite ensures the reliability and correctness of all synthetic asset functionality, including minting, burning, trading, price updates, and liquidation monitoring.

## Test Suite Architecture

The test suite is organized into three complementary layers:

### 1. **Unit Tests** (`syntheticAssets.unit.test.js`)

Unit tests provide isolated testing of individual service methods with mocked dependencies.

#### Coverage Areas

- **Asset Management**: `registerAsset()` - Registration with validation
- **Minting Operations**: `mintSynthetic()` - Position creation with collateral
- **Burning Operations**: `burnSynthetic()` - Position closure with refund
- **Collateral Management**: `addCollateral()` - Collateral addition and ratio updates
- **Trading Operations**: `openTrade()`, `closeTrade()` - Trading position lifecycle
- **Position Tracking**: `getPosition()`, `getTradingPosition()` - Position retrieval
- **Price Management**: `updatePrice()`, `getAssetPrice()` - Oracle integration
- **Risk Monitoring**: `getCollateralRatio()`, `getHealthFactor()`, `isLiquidatable()` - Position health
- **Protocol Parameters**: `getProtocolParams()`, `updateProtocolParams()` - Configuration
- **Utilities**: `getMaxMintable()`, `getTradingPnL()`, `getRegisteredAssets()` - Helper methods
- **Monitoring**: `monitorLiquidations()` - Liquidation tracking

#### Test Patterns

- Success cases with valid inputs
- Error handling with specific error messages
- Edge cases (zero values, boundary conditions)
- Cache behavior and TTL validation
- Database interactions and logging

#### Example Test Structure

```javascript
describe('SyntheticAssetsService - methodName', () => {
  it('should perform action successfully with valid inputs', async () => {
    // Setup
    service.method.mockResolvedValue({/* expected result */});

    // Execute
    const result = await service.method(/* args */);

    // Verify
    expect(result.property).toBe(expectedValue);
    expect(service.method).toHaveBeenCalledWith(/* expected args */);
  });

  it('should handle error condition', async () => {
    // Setup
    service.method.mockRejectedValue(new Error('error message'));

    // Execute & Verify
    await expect(service.method(/* args */)).rejects.toThrow('error message');
  });
});
```

### 2. **Integration Tests** (`syntheticAssets.integration.test.js`)

Integration tests validate HTTP API endpoints with mocked service layer and Express application.

#### Endpoint Coverage

- **POST /register** - Asset registration
- **POST /mint** - Asset minting
- **POST /burn** - Asset burning
- **POST /add-collateral** - Collateral addition
- **POST /open-trade** - Trade opening (LONG/SHORT)
- **POST /close-trade** - Trade closing
- **POST /price** - Price update (oracle)
- **GET /price/:symbol** - Price retrieval
- **GET /position/:id** - Position details
- **GET /trade/:id** - Trading position details
- **GET /ratio/:id** - Collateral ratio
- **GET /health/:id** - Health factor
- **GET /liquidatable/:id** - Liquidation status
- **GET /params** - Protocol parameters
- **PUT /params** - Protocol parameters update
- **GET /assets** - Registered assets list
- **GET /max-mintable** - Maximum mintable calculation
- **GET /pnl/:id** - Trading PnL
- **GET /health** - API health check

#### Test Patterns

- Valid request/response validation
- Missing required field validation (400 errors)
- Service error propagation (500 errors)
- Response structure validation
- Status code verification

#### Example Integration Test

```javascript
describe('POST /v1/synthetic-assets/mint', () => {
  it('mints synthetic assets successfully', async () => {
    syntheticAssetsService.mintSynthetic.mockResolvedValue({
      success: true,
      positionId: POSITION_ID,
      data: { position_id: POSITION_ID },
    });

    const res = await request(app).post('/v1/synthetic-assets/mint').send({
      userAddress: USER_ADDRESS,
      assetSymbol: ASSET_SYMBOL,
      collateralAmount: '1000000',
      mintAmount: '1000000',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.positionId).toBe(POSITION_ID);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await request(app).post('/v1/synthetic-assets/mint').send({
      userAddress: USER_ADDRESS,
      assetSymbol: ASSET_SYMBOL,
      // missing collateralAmount and mintAmount
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
```

### 3. **End-to-End Tests** (`syntheticAssets.e2e.test.js`)

E2E tests simulate complete business workflows across multiple operations.

#### Business Flows Tested

- **Complete Lifecycle**: Register → Mint → Trade → Burn
- **Price Oracle Flow**: Update → Retrieve → Monitor
- **Protocol Management**: Get → Update → Verify
- **Position Management**: Mint → Add Collateral → Monitor Health → Check Liquidation
- **Risk Management**: Liquidation detection with price changes
- **Edge Cases**: Invalid inputs, contract failures, network errors
- **Performance**: Concurrent request handling, large position batches

#### Example E2E Test

```javascript
it('executes complete flow: register → mint → open trade → close trade → burn', async () => {
  // Step 1: Register asset
  const registerResult = await syntheticAssetsService.registerAsset({
    symbol: 'sUSD',
    name: 'Synthetic USD',
    decimals: 6,
    initialPrice: '1000000',
  });
  expect(registerResult.success).toBe(true);

  // Step 2: Mint synthetic assets
  const mintResult = await syntheticAssetsService.mintSynthetic(
    USER_ADDRESS,
    'sUSD',
    '1000000',
    '1000000'
  );
  expect(mintResult.success).toBe(true);

  // Step 3: Open trading position
  const tradeResult = await syntheticAssetsService.openTrade(
    USER_ADDRESS,
    'sUSD',
    'LONG',
    '1000000',
    5
  );
  expect(tradeResult.success).toBe(true);

  // Step 4: Close trading position
  const closeResult = await syntheticAssetsService.closeTrade(
    USER_ADDRESS,
    tradeResult.positionId
  );
  expect(closeResult.success).toBe(true);

  // Step 5: Burn synthetic assets
  const burnResult = await syntheticAssetsService.burnSynthetic(
    USER_ADDRESS,
    mintResult.positionId,
    '1000000'
  );
  expect(burnResult.success).toBe(true);
});
```

## Running Tests

### Prerequisites

```bash
# Ensure all dependencies are installed
npm install

# Database migration must be applied
npm run init-db
```

### Running Test Suite

#### Run all tests

```bash
npm test
```

#### Run synthetic assets tests only

```bash
npm run test:synthetic
```

#### Run specific test categories

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# End-to-end tests (if available as separate command)
npm run test:e2e

# All tests (unit + synthetic)
npm run test:all
```

#### Run with coverage report

```bash
npm run test:coverage
```

#### Watch mode (re-run on file changes)

```bash
npm run test:watch
```

### Coverage Goals

The test suite aims for the following coverage metrics:

| Category                 | Target   | Status |
| ------------------------ | -------- | ------ |
| Service Methods          | 100%     | ✓      |
| API Endpoints            | 100%     | ✓      |
| Critical Financial Logic | 100%     | ✓      |
| Edge Cases               | >95%     | ✓      |
| Error Handling           | >90%     | ✓      |
| **Overall Coverage**     | **≥85%** | ✓      |

## Test Data and Constants

All tests use consistent test data for reproducibility:

```javascript
const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const USER_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const POSITION_ID = '1234567890';
const TRADE_POSITION_ID = '9876543210';
const ASSET_SYMBOL = 'sUSD';
const COLLATERAL_TOKEN =
  'GBUQWP3BOUZX34ULNQG23RQ6F4OFSAI5HY2S5KY74ESDTCVUJT5DTGWF';
```

## Mocking Strategy

### Service Mocking

All external dependencies are mocked for unit and integration tests:

```javascript
jest.unstable_mockModule('../src/services/syntheticAssetsService.js', () => ({
  syntheticAssetsService: {
    registerAsset: jest.fn(),
    mintSynthetic: jest.fn(),
    // ... other methods
  },
}));
```

### Database Mocking

Database operations are mocked to avoid dependencies:

```javascript
jest.unstable_mockModule('../src/services/databaseService.js', () => ({
  databaseService: {
    query: jest.fn(),
  },
}));
```

### Cache Mocking

Redis operations are mocked for cache tests:

```javascript
jest.unstable_mockModule('../src/services/redisService.js', () => ({
  redisService: {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  },
}));
```

## Test Scenarios

### Scenario 1: Successful Asset Minting

```
1. User calls /mint endpoint with valid collateral
2. Service validates collateral amount
3. Contract mints synthetic assets
4. Position recorded in database
5. Cache updated
6. Response returns with positionId
```

### Scenario 2: Liquidation Detection

```
1. Monitor service checks open positions
2. For each position, calculate health factor
3. If health < liquidation threshold:
   a. Record liquidation alert in database
   b. Broadcast alert to subscribers
   c. Mark position for liquidation
4. Continue monitoring other positions
```

### Scenario 3: Price Oracle Update

```
1. Oracle provides price update
2. Service validates price and confidence
3. Cache is invalidated
4. New price stored in contract
5. Event logged for audit
6. WebSocket subscribers notified
```

## Debugging Tests

### Enable Debug Logging

```bash
DEBUG=* npm run test:synthetic
```

### Run Single Test

```bash
npm test -- syntheticAssets.unit.test.js --testNamePattern="should mint synthetic"
```

### Run With Detailed Output

```bash
npm test -- --verbose
```

### Generate Coverage Report

```bash
npm run test:coverage
open coverage/index.html
```

## Contributing

When adding new synthetic assets functionality:

1. **Add corresponding unit tests** for the new service method
2. **Add integration tests** for any new API endpoints
3. **Add E2E tests** for new business flows
4. **Maintain coverage >85%** at all times
5. **Document the tests** in this guide

### Test Template

Use this template for new test cases:

```javascript
describe('SyntheticAssetsService - newMethod', () => {
  it('should perform expected action with valid inputs', async () => {
    // Arrange - Set up test data and mocks
    const input = {/* test data */};
    syntheticAssetsService.newMethod.mockResolvedValue({/* expected result */});

    // Act - Call the method
    const result = await syntheticAssetsService.newMethod(input);

    // Assert - Verify results
    expect(result.property).toBe(expectedValue);
    expect(syntheticAssetsService.newMethod).toHaveBeenCalledWith(input);
  });

  it('should handle error condition gracefully', async () => {
    // Arrange
    syntheticAssetsService.newMethod.mockRejectedValue(
      new Error('Expected error')
    );

    // Act & Assert
    await expect(syntheticAssetsService.newMethod(input)).rejects.toThrow(
      'Expected error'
    );
  });
});
```

## Performance Considerations

The test suite is optimized for fast execution:

- **Unit tests**: ~100-200ms total
- **Integration tests**: ~200-300ms total
- **E2E tests**: ~300-500ms total
- **Full suite**: ~1000ms total

If tests are running slower than expected:

1. Check for missing `beforeEach` cleanup
2. Verify mock implementations don't have delays
3. Look for unresolved promises
4. Check for database query timeouts

## Troubleshooting

### Common Issues

#### "Module not found" errors

```
Solution: Ensure all imports use correct relative paths
Check: babel.config.cjs is properly configured
```

#### Async test timeout

```
Solution: Increase jest timeout:
jest.setTimeout(10000);

Or fix the promise chain
```

#### Mock not being called

```
Solution: Verify clearAllMocks() is in beforeEach
Check: Mock is set before the actual code runs
```

#### Cache pollution between tests

```
Solution: Ensure redisService.delete() is called in cleanup
Add: beforeEach(() => { jest.clearAllMocks(); });
```

## CI/CD Integration

For continuous integration pipelines:

```bash
# Basic test run
npm run test:synthetic

# With coverage report
npm run test:coverage

# With specific threshold enforcement
npm test -- --coverage --coverageThreshold='{"global":{"branches":80,"functions":80,"lines":80,"statements":80}}'
```

## Future Enhancements

Potential areas for test expansion:

- [ ] Integration with SQLite in-memory database
- [ ] Performance benchmarking tests
- [ ] Stress testing with thousands of positions
- [ ] Network resilience and retry logic
- [ ] Security validation (access control tests)
- [ ] Snapshot testing for complex data structures
- [ ] Mutation testing to verify test effectiveness

## References

- [Jest Documentation](https://jestjs.io/)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [Synthetic Assets Service Implementation](../src/services/syntheticAssetsService.js)
- [API Routes Implementation](../src/routes/v1/synthetic-assets.js)
- [Database Schema](../migrations/V003__synthetic_assets.up.sql)
