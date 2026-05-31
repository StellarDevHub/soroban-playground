import { jest } from '@jest/globals';

// Import the real database service instead of mocking
import DatabaseService from '../src/services/databaseService.js';
import { syntheticAssetsService } from '../src/services/syntheticAssetsService.js';

// Mock only the external dependencies we can't test directly
jest.unstable_mockModule('../src/services/invokeService.js', () => ({
  invokeContract: jest.fn(),
}));

jest.unstable_mockModule('../src/services/redisService.js', () => ({
  redisService: {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  },
}));

const { invokeContract } = await import('../src/services/invokeService.js');
const { redisService } = await import('../src/services/redisService.js');

// Use in-memory SQLite database for testing
const TEST_DB_PATH = ':memory:';

let databaseService;

beforeAll(async () => {
  // Initialize database service with in-memory database
  databaseService = new DatabaseService(TEST_DB_PATH);
  await databaseService.connect();
  
  // Run migrations to set up schema
  try {
    // Import and run the synthetic assets migration
    const migrationSQL = await import('../../migrations/V003__synthetic_assets.up.sql');
    // In practice, we'd execute the migration SQL here
    // For now, we'll create the tables manually
    await databaseService.run(`
      CREATE TABLE IF NOT EXISTS positions (
        position_id TEXT PRIMARY KEY,
        user_address TEXT NOT NULL,
        asset_symbol TEXT NOT NULL,
        collateral_amount TEXT,
        minted_amount TEXT,
        margin TEXT,
        leverage INTEGER,
        direction TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS synthetic_asset_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        subject TEXT NOT NULL,
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS liquidation_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id TEXT NOT NULL,
        alerted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (error) {
    console.warn('Could not import migration, creating tables manually:', error);
    // Fallback to manual table creation
  }
});

afterAll(async () => {
  if (databaseService) {
    await databaseService.close();
  }
});

beforeEach(async () => {
  // Clean database before each test
  await databaseService.run('DELETE FROM positions');
  await databaseService.run('DELETE FROM synthetic_asset_events');
  await databaseService.run('DELETE FROM liquidation_alerts');
});

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const USER_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const POSITION_ID = '1234567890';
const ASSET_SYMBOL = 'sUSD';

// Mock contract calls to return expected data
invokeContract.mockResolvedValue({
  position_id: POSITION_ID,
  success: true,
});

redisService.get.mockResolvedValue(null);
redisService.set.mockResolvedValue(true);
redisService.delete.mockResolvedValue(true);

// ── Database Integration Tests ───────────────────────────────────────────────────────

describe('Synthetic Assets Database Integration Tests', () => {
  describe('Position Management', () => {
    it('should record position in database when minting', async () => {
      // Arrange
      const mockResult = {
        position_id: POSITION_ID,
        success: true,
      };
      invokeContract.mockResolvedValue(mockResult);

      // Act
      const result = await syntheticAssetsService.mintSynthetic(
        USER_ADDRESS,
        ASSET_SYMBOL,
        '1000000',
        '1000000'
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.positionId).toBe(POSITION_ID);
      
      // Verify position was saved to database
      const positions = await databaseService.all(
        'SELECT * FROM positions WHERE position_id = $1',
        [POSITION_ID]
      );
      expect(positions).toHaveLength(1);
      expect(positions[0].user_address).toBe(USER_ADDRESS);
      expect(positions[0].asset_symbol).toBe(ASSET_SYMBOL);
      expect(positions[0].collateral_amount).toBe('1000000');
      expect(positions[0].minted_amount).toBe('1000000');
      expect(positions[0].status).toBe('OPEN');
    });

    it('should update position status when burning', async () => {
      // First create a position
      await databaseService.run(
        'INSERT INTO positions (position_id, user_address, asset_symbol, collateral_amount, minted_amount, type, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [POSITION_ID, USER_ADDRESS, ASSET_SYMBOL, '1000000', '1000000', 'COLLATERAL', 'OPEN']
      );

      // Mock contract call
      invokeContract.mockResolvedValue({
        success: true,
        burned: '1000000',
      });

      // Act
      const result = await syntheticAssetsService.burnSynthetic(
        USER_ADDRESS,
        POSITION_ID,
        '1000000'
      );

      // Assert
      expect(result.success).toBe(true);
      
      // Verify position status was updated
      const positions = await databaseService.all(
        'SELECT * FROM positions WHERE position_id = $1',
        [POSITION_ID]
      );
      expect(positions).toHaveLength(1);
      expect(positions[0].status).toBe('CLOSED');
    });

    it('should record liquidation alerts when position is liquidatable', async () => {
      // First create a position
      await databaseService.run(
        'INSERT INTO positions (position_id, user_address, asset_symbol, collateral_amount, minted_amount, type, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [POSITION_ID, USER_ADDRESS, ASSET_SYMBOL, '1000000', '1000000', 'COLLATERAL', 'OPEN']
      );

      // Mock contract call to return true for liquidatable
      invokeContract.mockResolvedValue(true);

      // Act
      await syntheticAssetsService.monitorLiquidations();

      // Assert
      const alerts = await databaseService.all(
        'SELECT * FROM liquidation_alerts WHERE position_id = $1',
        [POSITION_ID]
      );
      expect(alerts).toHaveLength(1);
      expect(alerts[0].position_id).toBe(POSITION_ID);
    });
  });

  describe('Event Logging', () => {
    it('should log asset events in database', async () => {
      // Mock contract call
      invokeContract.mockResolvedValue({
        success: true,
        data: { contractId: CONTRACT_ID },
      });

      // Act
      const result = await syntheticAssetsService.registerAsset({
        symbol: 'sUSD',
        name: 'Synthetic USD',
        decimals: 6,
        initialPrice: '1000000',
      });

      // Assert
      expect(result.success).toBe(true);
      
      // Verify event was logged
      const events = await databaseService.all(
        'SELECT * FROM synthetic_asset_events WHERE event_type = $1 AND subject = $2',
        ['REGISTER', 'sUSD']
      );
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('REGISTER');
      expect(events[0].subject).toBe('sUSD');
      expect(events[0].details).toContain('sUSD');
    });
  });

  describe('Database Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      // Mock database service to throw error
      const originalRun = databaseService.run.bind(databaseService);
      databaseService.run = jest.fn().mockRejectedValue(new Error('Database connection failed'));

      // Act & Assert
      await expect(
        syntheticAssetsService.mintSynthetic(
          USER_ADDRESS,
          ASSET_SYMBOL,
          '1000000',
          '1000000'
        )
      ).rejects.toThrow('Database connection failed');

      // Restore original method
      databaseService.run = originalRun;
    });
  });
});
