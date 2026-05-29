import { jest } from '@jest/globals';

// Setup ES Module mocks before imports
jest.unstable_mockModule('../src/services/databaseService.js', () => ({
  databaseService: {
    query: jest.fn(),
  },
  default: jest.fn(),
}));

const mockRedisService = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
jest.unstable_mockModule('../src/services/redisService.js', () => ({
  redisService: mockRedisService,
  default: mockRedisService,
}));

jest.unstable_mockModule('../src/services/invokeService.js', () => ({
  invokeContract: jest.fn(),
  invokeSorobanContract: jest.fn(),
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

let syntheticAssetsService, databaseService, redisService, invokeContract, logger;

beforeAll(async () => {
  const mod1 = await import('../src/services/syntheticAssetsService.js');
  const mod2 = await import('../src/services/databaseService.js');
  const mod3 = await import('../src/services/redisService.js');
  const mod4 = await import('../src/services/invokeService.js');
  const mod5 = await import('../src/utils/logger.js');
  syntheticAssetsService = mod1.syntheticAssetsService;
  databaseService = mod2.databaseService;
  redisService = mod3.redisService;
  invokeContract = mod4.invokeContract;
  logger = mod5.logger;
});

describe('SyntheticAssetsService Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SYNTHETIC_ASSETS_CONTRACT_ID = 'test-contract-id';
    process.env.COLLATERAL_TOKEN = 'test-collateral';
    process.env.ORACLE_ADDRESS = 'test-oracle';
  });

  describe('registerAsset', () => {
    it('registers asset metadata successfully', async () => {
      const asset = { symbol: 'sTSLA', name: 'Synthetic Tesla', decimals: 7, initialPrice: 100 };
      invokeContract.mockResolvedValue({ txHash: '0x123' });
      redisService.set.mockResolvedValue('OK');
      databaseService.query.mockResolvedValue({ changes: 1 });

      const result = await syntheticAssetsService.registerAsset(asset);

      expect(result.success).toBe(true);
      expect(invokeContract).toHaveBeenCalledWith({
        contractId: 'test-contract-id',
        method: 'register_synthetic_asset',
        params: ['sTSLA', 'Synthetic Tesla', 7, 100],
        auth: true,
      });
      expect(redisService.set).toHaveBeenCalledWith('asset:sTSLA', JSON.stringify(asset), 300);
      expect(databaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO synthetic_asset_events'),
        expect.arrayContaining(['REGISTER', 'sTSLA'])
      );
    });

    it('handles and propagates registration failures', async () => {
      const asset = { symbol: 'sTSLA', name: 'Synthetic Tesla', decimals: 7, initialPrice: 100 };
      invokeContract.mockRejectedValue(new Error('Contract invocation failed'));

      await expect(syntheticAssetsService.registerAsset(asset)).rejects.toThrow('Contract invocation failed');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('mintSynthetic', () => {
    it('mints synthetic asset and records position', async () => {
      invokeContract.mockResolvedValue({ position_id: 'pos-123' });
      databaseService.query.mockResolvedValue({ changes: 1 });

      const result = await syntheticAssetsService.mintSynthetic('user-addr', 'sTSLA', 1000, 500);

      expect(result.success).toBe(true);
      expect(result.positionId).toBe('pos-123');
      expect(invokeContract).toHaveBeenCalledWith({
        contractId: 'test-contract-id',
        method: 'mint_synthetic',
        params: ['user-addr', 'sTSLA', 1000, 500],
        auth: true,
      });
      expect(databaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO positions'),
        ['pos-123', 'user-addr', 'sTSLA', 1000, 500, undefined, undefined, undefined, 'COLLATERAL', 'OPEN']
      );
      expect(databaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO synthetic_asset_events'),
        ['MINT', 'sTSLA', JSON.stringify({ user: 'user-addr', collateral: 1000, minted: 500 })]
      );
    });

    it('propagates failure on mint error', async () => {
      invokeContract.mockRejectedValue(new Error('Mint failed'));

      await expect(syntheticAssetsService.mintSynthetic('user-addr', 'sTSLA', 1000, 500)).rejects.toThrow('Mint failed');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('burnSynthetic', () => {
    it('burns synthetic asset and closes position', async () => {
      invokeContract.mockResolvedValue({ txHash: '0x321' });
      databaseService.query.mockResolvedValue({ changes: 1 });

      const result = await syntheticAssetsService.burnSynthetic('user-addr', 'pos-123', 500);

      expect(result.success).toBe(true);
      expect(invokeContract).toHaveBeenCalledWith({
        contractId: 'test-contract-id',
        method: 'burn_synthetic',
        params: ['user-addr', 'pos-123', 500],
        auth: true,
      });
      expect(databaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE positions SET status = $2'),
        ['pos-123', 'CLOSED']
      );
    });
  });

  describe('addCollateral', () => {
    it('adds collateral to an existing position and invalidates cache', async () => {
      invokeContract.mockResolvedValue({ txHash: '0x456' });
      databaseService.query.mockResolvedValue({ changes: 1 });
      redisService.delete.mockResolvedValue(1);

      const result = await syntheticAssetsService.addCollateral('user-addr', 'pos-123', 200);

      expect(result.success).toBe(true);
      expect(invokeContract).toHaveBeenCalledWith({
        contractId: 'test-contract-id',
        method: 'add_collateral',
        params: ['user-addr', 'pos-123', 200],
        auth: true,
      });
      expect(databaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE positions SET collateralAdded = $2'),
        expect.arrayContaining(['pos-123', 200])
      );
      expect(redisService.delete).toHaveBeenCalledWith('position:pos-123');
    });
  });

  describe('openTrade', () => {
    it('opens trading position successfully', async () => {
      invokeContract.mockResolvedValue('trade-123');
      databaseService.query.mockResolvedValue({ changes: 1 });

      const result = await syntheticAssetsService.openTrade('user-addr', 'sTSLA', 'LONG', 500, 3);

      expect(result.success).toBe(true);
      expect(result.positionId).toBe('trade-123');
      expect(invokeContract).toHaveBeenCalledWith({
        contractId: 'test-contract-id',
        method: 'open_trade',
        params: ['user-addr', 'sTSLA', 'LONG', 500, 3],
        auth: true,
      });
      expect(databaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO positions'),
        ['trade-123', 'user-addr', 'sTSLA', undefined, undefined, 500, 3, 'LONG', 'TRADING', 'OPEN']
      );
    });
  });

  describe('closeTrade', () => {
    it('closes trade successfully and clears cache', async () => {
      invokeContract.mockResolvedValue(600); // returns finalAmount
      databaseService.query.mockResolvedValue({ changes: 1 });
      redisService.delete.mockResolvedValue(1);

      const result = await syntheticAssetsService.closeTrade('user-addr', 'trade-123');

      expect(result.success).toBe(true);
      expect(result.finalAmount).toBe(600);
      expect(invokeContract).toHaveBeenCalledWith({
        contractId: 'test-contract-id',
        method: 'close_trade',
        params: ['user-addr', 'trade-123'],
        auth: true,
      });
      expect(databaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE positions SET status = $2'),
        ['trade-123', 'CLOSED']
      );
      expect(redisService.delete).toHaveBeenCalledWith('trade:trade-123');
    });
  });

  describe('getPosition', () => {
    it('returns cached position if present', async () => {
      const mockCached = { position_id: 'pos-123', user: 'user-addr' };
      redisService.get.mockResolvedValue(JSON.stringify(mockCached));

      const result = await syntheticAssetsService.getPosition('pos-123');

      expect(result).toEqual(mockCached);
      expect(redisService.get).toHaveBeenCalledWith('position:pos-123');
      expect(invokeContract).not.toHaveBeenCalled();
    });

    it('fetches from contract and caches on cache miss', async () => {
      const mockResult = { position_id: 'pos-123', user: 'user-addr' };
      redisService.get.mockResolvedValue(null);
      invokeContract.mockResolvedValue(mockResult);
      redisService.set.mockResolvedValue('OK');

      const result = await syntheticAssetsService.getPosition('pos-123');

      expect(result).toEqual(mockResult);
      expect(redisService.get).toHaveBeenCalledWith('position:pos-123');
      expect(invokeContract).toHaveBeenCalledWith({
        contractId: 'test-contract-id',
        method: 'get_position',
        params: ['pos-123'],
        auth: false,
      });
      expect(redisService.set).toHaveBeenCalledWith('position:pos-123', JSON.stringify(mockResult), 30);
    });
  });

  describe('getTradingPosition', () => {
    it('returns cached trading position if present', async () => {
      const mockCached = { position_id: 'trade-123', user: 'user-addr' };
      redisService.get.mockResolvedValue(JSON.stringify(mockCached));

      const result = await syntheticAssetsService.getTradingPosition('trade-123');

      expect(result).toEqual(mockCached);
      expect(redisService.get).toHaveBeenCalledWith('trade:trade-123');
      expect(invokeContract).not.toHaveBeenCalled();
    });

    it('fetches and caches trading position on cache miss', async () => {
      const mockResult = { position_id: 'trade-123', user: 'user-addr' };
      redisService.get.mockResolvedValue(null);
      invokeContract.mockResolvedValue(mockResult);

      const result = await syntheticAssetsService.getTradingPosition('trade-123');

      expect(result).toEqual(mockResult);
      expect(redisService.set).toHaveBeenCalledWith('trade:trade-123', JSON.stringify(mockResult), 30);
    });
  });

  describe('updatePrice', () => {
    it('updates asset price, invalidates cache, and broadcasts update', async () => {
      invokeContract.mockResolvedValue({ tx: '0xprice' });
      redisService.delete.mockResolvedValue(1);
      databaseService.query.mockResolvedValue({ changes: 1 });

      global.priceUpdateSubscribers = [jest.fn()];

      const result = await syntheticAssetsService.updatePrice('sTSLA', 150, 95);

      expect(result.success).toBe(true);
      expect(invokeContract).toHaveBeenCalledWith({
        contractId: 'test-contract-id',
        method: 'update_price',
        params: ['sTSLA', 150, 95],
        auth: true,
      });
      expect(redisService.delete).toHaveBeenCalledWith('price:sTSLA');
      expect(global.priceUpdateSubscribers[0]).toHaveBeenCalledWith({ assetSymbol: 'sTSLA', price: 150 });
    });
  });

  describe('getAssetPrice', () => {
    it('returns cached price if available', async () => {
      redisService.get.mockResolvedValue('150');

      const price = await syntheticAssetsService.getAssetPrice('sTSLA');

      expect(price).toBe(150);
      expect(redisService.get).toHaveBeenCalledWith('price:sTSLA');
      expect(invokeContract).not.toHaveBeenCalled();
    });

    it('queries contract on price cache miss', async () => {
      redisService.get.mockResolvedValue(null);
      invokeContract.mockResolvedValue(120);

      const price = await syntheticAssetsService.getAssetPrice('sTSLA');

      expect(price).toBe(120);
      expect(redisService.set).toHaveBeenCalledWith('price:sTSLA', '120', 5);
    });
  });

  describe('getCollateralRatio', () => {
    it('returns collateral ratio from contract', async () => {
      invokeContract.mockResolvedValue(180);

      const ratio = await syntheticAssetsService.getCollateralRatio('pos-123');

      expect(ratio).toBe(180);
      expect(invokeContract).toHaveBeenCalledWith({
        contractId: 'test-contract-id',
        method: 'get_collateral_ratio',
        params: ['pos-123'],
        auth: false,
      });
    });
  });

  describe('getHealthFactor', () => {
    it('returns health factor from contract', async () => {
      invokeContract.mockResolvedValue(150);

      const hf = await syntheticAssetsService.getHealthFactor('pos-123');

      expect(hf).toBe(150);
    });
  });

  describe('isLiquidatable', () => {
    it('reads cached liquidatable status if present', async () => {
      redisService.get.mockResolvedValue('true');

      const isLiq = await syntheticAssetsService.isLiquidatable('pos-123');

      expect(isLiq).toBe(true);
      expect(invokeContract).not.toHaveBeenCalled();
    });

    it('queries contract on cache miss and caches response', async () => {
      redisService.get.mockResolvedValue(null);
      invokeContract.mockResolvedValue(false);

      const isLiq = await syntheticAssetsService.isLiquidatable('pos-123');

      expect(isLiq).toBe(false);
      expect(redisService.set).toHaveBeenCalledWith('liquidatable:pos-123', 'false', 10);
    });
  });

  describe('getProtocolParams', () => {
    it('reads cached params', async () => {
      const mockParams = { fee: 5 };
      redisService.get.mockResolvedValue(JSON.stringify(mockParams));

      const result = await syntheticAssetsService.getProtocolParams();

      expect(result).toEqual(mockParams);
    });

    it('queries contract on cache miss', async () => {
      const mockParams = { fee: 5 };
      redisService.get.mockResolvedValue(null);
      invokeContract.mockResolvedValue(mockParams);

      const result = await syntheticAssetsService.getProtocolParams();

      expect(result).toEqual(mockParams);
      expect(redisService.set).toHaveBeenCalledWith('protocol:params', JSON.stringify(mockParams), 300);
    });
  });

  describe('updateProtocolParams', () => {
    it('updates params, clears cache and logs events', async () => {
      invokeContract.mockResolvedValue({ success: true });
      redisService.delete.mockResolvedValue(1);
      databaseService.query.mockResolvedValue({ changes: 1 });

      const result = await syntheticAssetsService.updateProtocolParams(150, 120, 10, 1);

      expect(result.success).toBe(true);
      expect(invokeContract).toHaveBeenCalledWith({
        contractId: 'test-contract-id',
        method: 'update_protocol_params',
        params: [150, 120, 10, 1],
        auth: true,
      });
      expect(redisService.delete).toHaveBeenCalledWith('protocol:params');
    });
  });

  describe('getMaxMintable', () => {
    it('calculates max mintable amount', async () => {
      invokeContract.mockResolvedValue(600);

      const max = await syntheticAssetsService.getMaxMintable('sTSLA', 1000);

      expect(max).toBe(600);
    });
  });

  describe('getTradingPnL', () => {
    it('gets PnL from contract', async () => {
      invokeContract.mockResolvedValue(150);

      const pnl = await syntheticAssetsService.getTradingPnL('trade-123');

      expect(pnl).toBe(150);
    });
  });

  describe('getRegisteredAssets', () => {
    it('gets cached assets', async () => {
      redisService.get.mockResolvedValue(JSON.stringify(['sTSLA', 'sAAPL']));

      const assets = await syntheticAssetsService.getRegisteredAssets();

      expect(assets).toEqual(['sTSLA', 'sAAPL']);
    });
  });

  describe('monitorLiquidations', () => {
    it('queries open positions and alerts if liquidatable', async () => {
      databaseService.query.mockResolvedValue({
        rows: [{ position_id: 'pos-1' }, { position_id: 'pos-2' }],
      });
      // pos-1 liquidatable, pos-2 not
      redisService.get.mockResolvedValue(null);
      invokeContract
        .mockResolvedValueOnce(true)  // is_liquidatable pos-1
        .mockResolvedValueOnce(false); // is_liquidatable pos-2

      global.liquidationAlertSubscribers = [jest.fn()];

      await syntheticAssetsService.monitorLiquidations();

      expect(databaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT position_id'),
        ['OPEN', 'COLLATERAL']
      );
      // Alerts created for pos-1
      expect(databaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO liquidation_alerts'),
        ['pos-1']
      );
      expect(global.liquidationAlertSubscribers[0]).toHaveBeenCalledWith({ positionId: 'pos-1' });
    });

    it('handles errors during monitoring gracefully', async () => {
      databaseService.query.mockRejectedValue(new Error('DB failure'));

      await expect(syntheticAssetsService.monitorLiquidations()).resolves.not.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
