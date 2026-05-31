# Synthetic Assets Test Suite

This directory contains the comprehensive test suite for the Synthetic Assets feature in the Soroban Playground backend.

## Test Structure

The test suite is organized into three main categories:

### 1. Unit Tests (`syntheticAssets.unit.test.js`)
- Tests individual service methods in isolation
- Mocks all external dependencies (database, redis, contract interactions)
- Focuses on business logic correctness and edge case handling

### 2. Integration Tests (`syntheticAssets.integration.test.js`)
- Tests API routes with mocked service layer
- Validates HTTP request/response behavior
- Tests validation, error handling, and authentication flows

### 3. End-to-End Tests (`syntheticAssets.e2e.test.js`)
- Tests complete business flows across multiple endpoints
- Validates integration between different service methods
- Includes performance and edge case testing

## Test Infrastructure Requirements

The test suite requires the following infrastructure components:

- `babel-plugin-transform-import-meta`: Required for proper Jest execution with import.meta usage
- `@babel/plugin-syntax-import-meta`: Required for parsing import.meta syntax
- `@babel/plugin-transform-modules-commonjs`: Required for module transformation

These plugins are configured in `babel.config.cjs` and installed as dev dependencies in `package.json`.

## Running Tests

### Run all synthetic assets tests:
```bash
npm run test:synthetic
```

### Run specific test types:
```bash
# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# E2E tests only
npm run test:e2e

# All tests (unit + synthetic)
npm run test:all
```

### Run with coverage:
```bash
npm run test:coverage
```

## Test Coverage Goals

- ≥85% test coverage for synthetic assets service and routes
- 100% coverage for critical financial logic (liquidation, collateral ratio, health factor)
- Comprehensive coverage for all 20+ API endpoints
- Edge case coverage for all validation scenarios

## Test Data Conventions

- `CONTRACT_ID`: `'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'`
- `USER_ADDRESS`: `'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'`
- `POSITION_ID`: `'1234567890'`
- `ASSET_SYMBOL`: `'sUSD'`

## Contributing

When adding new synthetic assets functionality, please ensure corresponding tests are added to maintain coverage goals.

For more information about the synthetic assets architecture, see:
- [Service Implementation](../src/services/syntheticAssetsService.js)
- [API Routes](../src/routes/v1/synthetic-assets.js)
- [Database Schema](../migrations/V003__synthetic_assets.up.sql)
