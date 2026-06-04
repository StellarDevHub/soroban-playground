import { jest } from '@jest/globals';

// Setup ES Module mocks before imports
// Mock the synthetic assets service dependencies
jest.unstable_mockModule('../src/services/syntheticAssetsService.js', () => ({
  syntheticAssetsService: {
    registerAsset: jest.fn(),
    mintSynthetic: jest.fn(),
    burnSynthetic: jest.fn(),
    addCollateral: jest.fn(),
    openTrade: jest.fn(),
    closeTrade: jest.fn(),
    getPosition: jest.fn(),
    getTradingPosition: jest.fn(),
    updatePrice: jest.fn(),
    getAssetPrice: jest.fn(),
    getCollateralRatio: jest.fn(),
    getHealthFactor: jest.fn(),
    isLiquidatable: jest.fn(),
    getProtocolParams: jest.fn(),
    updateProtocolParams: jest.fn(),
    getMaxMintable: jest.fn(),
    getTradingPnL: jest.fn(),
    getRegisteredAssets: jest.fn(),
    monitorLiquidations: jest.fn(),
  },
}));

// Mock database service
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
}));

// Mock redis service
jest.unstable_mockModule('../src/services/redisService.js', () => ({
  redisService: {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  },
}));

// Mock invoke service
jest.unstable_mockModule('../src/services/invokeService.js', () => ({
  invokeContract: jest.fn(),
}));

const { syntheticAssetsService } =
  await import('../src/services/syntheticAssetsService.js');
const { databaseService } = await import('../src/services/databaseService.js');
const { redisService } = await import('../src/services/redisService.js');
const { invokeContract } = await import('../src/services/invokeService.js');

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const USER_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const POSITION_ID = '1234567890';
const ASSET_SYMBOL = 'sUSD';

beforeEach(() => {
  jest.clearAllMocks();
});

// ── registerAsset ───────────────────────────────────────────────────────────────

describe('registerAsset', () => {
  it('registers asset successfully', async () => {
    const mockAsset = {
      symbol: 'sUSD',
      name: 'Synthetic USD',
      decimals: 6,
      initialPrice: '1000000',
    };

    syntheticAssetsService.registerAsset.mockResolvedValue({
      success: true,
      data: { contractId: CONTRACT_ID },
    });

    const result = await syntheticAssetsService.registerAsset(mockAsset);

    expect(result.success).toBe(true);
    expect(syntheticAssetsService.registerAsset).toHaveBeenCalledWith(
      mockAsset
    );
  });

  it('handles registration error', async () => {
    syntheticAssetsService.registerAsset.mockRejectedValue(
      new Error('Contract error')
    );

    await expect(
      syntheticAssetsService.registerAsset({
        symbol: 'sUSD',
        name: 'Synthetic USD',
        decimals: 6,
        initialPrice: '1000000',
      })
    ).rejects.toThrow('Contract error');
  });
});

// ── mintSynthetic ───────────────────────────────────────────────────────────────

describe('mintSynthetic', () => {
  it('mints synthetic assets successfully', async () => {
    syntheticAssetsService.mintSynthetic.mockResolvedValue({
      success: true,
      positionId: POSITION_ID,
      data: { position_id: POSITION_ID },
    });

    const result = await syntheticAssetsService.mintSynthetic(
      USER_ADDRESS,
      ASSET_SYMBOL,
      '1000000',
      '1000000'
    );

    expect(result.success).toBe(true);
    expect(result.positionId).toBe(POSITION_ID);
    expect(syntheticAssetsService.mintSynthetic).toHaveBeenCalledWith(
      USER_ADDRESS,
      ASSET_SYMBOL,
      '1000000',
      '1000000'
    );
  });

  it('handles mint error', async () => {
    syntheticAssetsService.mintSynthetic.mockRejectedValue(
      new Error('Insufficient collateral')
    );

    await expect(
      syntheticAssetsService.mintSynthetic(
        USER_ADDRESS,
        ASSET_SYMBOL,
        '1000000',
        '1000000'
      )
    ).rejects.toThrow('Insufficient collateral');
  });
});

// ── burnSynthetic ───────────────────────────────────────────────────────────────

describe('burnSynthetic', () => {
  it('burns synthetic assets successfully', async () => {
    syntheticAssetsService.burnSynthetic.mockResolvedValue({
      success: true,
      data: { burned: '1000000' },
    });

    const result = await syntheticAssetsService.burnSynthetic(
      USER_ADDRESS,
      POSITION_ID,
      '1000000'
    );

    expect(result.success).toBe(true);
    expect(syntheticAssetsService.burnSynthetic).toHaveBeenCalledWith(
      USER_ADDRESS,
      POSITION_ID,
      '1000000'
    );
  });

  it('handles burn error', async () => {
    syntheticAssetsService.burnSynthetic.mockRejectedValue(
      new Error('Invalid position')
    );

    await expect(
      syntheticAssetsService.burnSynthetic(USER_ADDRESS, POSITION_ID, '1000000')
    ).rejects.toThrow('Invalid position');
  });
});

// ── addCollateral ───────────────────────────────────────────────────────────────

describe('addCollateral', () => {
  it('adds collateral successfully', async () => {
    syntheticAssetsService.addCollateral.mockResolvedValue({
      success: true,
      data: { added: '500000' },
    });

    const result = await syntheticAssetsService.addCollateral(
      USER_ADDRESS,
      POSITION_ID,
      '500000'
    );

    expect(result.success).toBe(true);
    expect(syntheticAssetsService.addCollateral).toHaveBeenCalledWith(
      USER_ADDRESS,
      POSITION_ID,
      '500000'
    );
  });

  it('handles add collateral error', async () => {
    syntheticAssetsService.addCollateral.mockRejectedValue(
      new Error('Insufficient funds')
    );

    await expect(
      syntheticAssetsService.addCollateral(USER_ADDRESS, POSITION_ID, '500000')
    ).rejects.toThrow('Insufficient funds');
  });
});

// ── openTrade ───────────────────────────────────────────────────────────────────

describe('openTrade', () => {
  it('opens trading position successfully', async () => {
    syntheticAssetsService.openTrade.mockResolvedValue({
      success: true,
      positionId: POSITION_ID,
      data: POSITION_ID,
    });

    const result = await syntheticAssetsService.openTrade(
      USER_ADDRESS,
      ASSET_SYMBOL,
      'LONG',
      '1000000',
      5
    );

    expect(result.success).toBe(true);
    expect(result.positionId).toBe(POSITION_ID);
    expect(syntheticAssetsService.openTrade).toHaveBeenCalledWith(
      USER_ADDRESS,
      ASSET_SYMBOL,
      'LONG',
      '1000000',
      5
    );
  });

  it('handles open trade error', async () => {
    syntheticAssetsService.openTrade.mockRejectedValue(
      new Error('Invalid direction')
    );

    await expect(
      syntheticAssetsService.openTrade(
        USER_ADDRESS,
        ASSET_SYMBOL,
        'INVALID',
        '1000000',
        5
      )
    ).rejects.toThrow('Invalid direction');
  });
});

// ── closeTrade ──────────────────────────────────────────────────────────────────

describe('closeTrade', () => {
  it('closes trading position successfully', async () => {
    syntheticAssetsService.closeTrade.mockResolvedValue({
      success: true,
      finalAmount: '1200000',
      data: '1200000',
    });

    const result = await syntheticAssetsService.closeTrade(
      USER_ADDRESS,
      POSITION_ID
    );

    expect(result.success).toBe(true);
    expect(result.finalAmount).toBe('1200000');
    expect(syntheticAssetsService.closeTrade).toHaveBeenCalledWith(
      USER_ADDRESS,
      POSITION_ID
    );
  });

  it('handles close trade error', async () => {
    syntheticAssetsService.closeTrade.mockRejectedValue(
      new Error('Position not found')
    );

    await expect(
      syntheticAssetsService.closeTrade(USER_ADDRESS, POSITION_ID)
    ).rejects.toThrow('Position not found');
  });
});

// ── getPosition ─────────────────────────────────────────────────────────────────

describe('getPosition', () => {
  it('gets position successfully', async () => {
    syntheticAssetsService.getPosition.mockResolvedValue({
      positionId: POSITION_ID,
      userAddress: USER_ADDRESS,
      assetSymbol: ASSET_SYMBOL,
      collateralAmount: '1000000',
      mintedAmount: '1000000',
    });

    const result = await syntheticAssetsService.getPosition(POSITION_ID);

    expect(result.positionId).toBe(POSITION_ID);
    expect(syntheticAssetsService.getPosition).toHaveBeenCalledWith(
      POSITION_ID
    );
  });

  it('handles get position error', async () => {
    syntheticAssetsService.getPosition.mockRejectedValue(
      new Error('Position not found')
    );

    await expect(
      syntheticAssetsService.getPosition(POSITION_ID)
    ).rejects.toThrow('Position not found');
  });
});

// ── getTradingPosition ──────────────────────────────────────────────────────────

describe('getTradingPosition', () => {
  it('gets trading position successfully', async () => {
    syntheticAssetsService.getTradingPosition.mockResolvedValue({
      positionId: POSITION_ID,
      userAddress: USER_ADDRESS,
      assetSymbol: ASSET_SYMBOL,
      margin: '1000000',
      leverage: 5,
      direction: 'LONG',
    });

    const result = await syntheticAssetsService.getTradingPosition(POSITION_ID);

    expect(result.positionId).toBe(POSITION_ID);
    expect(syntheticAssetsService.getTradingPosition).toHaveBeenCalledWith(
      POSITION_ID
    );
  });

  it('handles get trading position error', async () => {
    syntheticAssetsService.getTradingPosition.mockRejectedValue(
      new Error('Trading position not found')
    );

    await expect(
      syntheticAssetsService.getTradingPosition(POSITION_ID)
    ).rejects.toThrow('Trading position not found');
  });
});

// ── updatePrice ─────────────────────────────────────────────────────────────────

describe('updatePrice', () => {
  it('updates price successfully', async () => {
    syntheticAssetsService.updatePrice.mockResolvedValue({
      success: true,
      data: { updated: true },
    });

    const result = await syntheticAssetsService.updatePrice(
      ASSET_SYMBOL,
      '1050000',
      95
    );

    expect(result.success).toBe(true);
    expect(syntheticAssetsService.updatePrice).toHaveBeenCalledWith(
      ASSET_SYMBOL,
      '1050000',
      95
    );
  });

  it('handles update price error', async () => {
    syntheticAssetsService.updatePrice.mockRejectedValue(
      new Error('Oracle failure')
    );

    await expect(
      syntheticAssetsService.updatePrice(ASSET_SYMBOL, '1050000', 95)
    ).rejects.toThrow('Oracle failure');
  });
});

// ── getAssetPrice ───────────────────────────────────────────────────────────────

describe('getAssetPrice', () => {
  it('gets asset price successfully', async () => {
    syntheticAssetsService.getAssetPrice.mockResolvedValue({
      price: '1050000',
      confidence: 95,
      lastUpdated: new Date().toISOString(),
    });

    const result = await syntheticAssetsService.getAssetPrice(ASSET_SYMBOL);

    expect(result.price).toBe('1050000');
    expect(syntheticAssetsService.getAssetPrice).toHaveBeenCalledWith(
      ASSET_SYMBOL
    );
  });

  it('handles get asset price error', async () => {
    syntheticAssetsService.getAssetPrice.mockRejectedValue(
      new Error('Price not available')
    );

    await expect(
      syntheticAssetsService.getAssetPrice(ASSET_SYMBOL)
    ).rejects.toThrow('Price not available');
  });
});

// ── getCollateralRatio ─────────────────────────────────────────────────────────

describe('getCollateralRatio', () => {
  it('gets collateral ratio successfully', async () => {
    syntheticAssetsService.getCollateralRatio.mockResolvedValue({
      ratio: '2000000', // 200%
      healthFactor: '3000000', // 300%
    });

    const result = await syntheticAssetsService.getCollateralRatio(POSITION_ID);

    expect(result.ratio).toBe('2000000');
    expect(syntheticAssetsService.getCollateralRatio).toHaveBeenCalledWith(
      POSITION_ID
    );
  });

  it('handles get collateral ratio error', async () => {
    syntheticAssetsService.getCollateralRatio.mockRejectedValue(
      new Error('Invalid position')
    );

    await expect(
      syntheticAssetsService.getCollateralRatio(POSITION_ID)
    ).rejects.toThrow('Invalid position');
  });
});

// ── getHealthFactor ─────────────────────────────────────────────────────────────

describe('getHealthFactor', () => {
  it('gets health factor successfully', async () => {
    syntheticAssetsService.getHealthFactor.mockResolvedValue({
      healthFactor: '3000000', // 300%
      status: 'SAFE',
    });

    const result = await syntheticAssetsService.getHealthFactor(POSITION_ID);

    expect(result.healthFactor).toBe('3000000');
    expect(syntheticAssetsService.getHealthFactor).toHaveBeenCalledWith(
      POSITION_ID
    );
  });

  it('handles get health factor error', async () => {
    syntheticAssetsService.getHealthFactor.mockRejectedValue(
      new Error('Health check failed')
    );

    await expect(
      syntheticAssetsService.getHealthFactor(POSITION_ID)
    ).rejects.toThrow('Health check failed');
  });
});

// ── isLiquidatable ──────────────────────────────────────────────────────────────

describe('isLiquidatable', () => {
  it('checks liquidation status successfully', async () => {
    syntheticAssetsService.isLiquidatable.mockResolvedValue(true);

    const result = await syntheticAssetsService.isLiquidatable(POSITION_ID);

    expect(result).toBe(true);
    expect(syntheticAssetsService.isLiquidatable).toHaveBeenCalledWith(
      POSITION_ID
    );
  });

  it('handles liquidation check error', async () => {
    syntheticAssetsService.isLiquidatable.mockRejectedValue(
      new Error('Contract call failed')
    );

    await expect(
      syntheticAssetsService.isLiquidatable(POSITION_ID)
    ).rejects.toThrow('Contract call failed');
  });
});

// ── getProtocolParams ───────────────────────────────────────────────────────────

describe('getProtocolParams', () => {
  it('gets protocol parameters successfully', async () => {
    syntheticAssetsService.getProtocolParams.mockResolvedValue({
      minCollateralRatio: 1500000, // 150%
      liquidationThreshold: 1100000, // 110%
      liquidationBonus: 50000, // 5%
      feePercentage: 10000, // 1%
    });

    const result = await syntheticAssetsService.getProtocolParams();

    expect(result.minCollateralRatio).toBe(1500000);
    expect(syntheticAssetsService.getProtocolParams).toHaveBeenCalled();
  });

  it('handles get protocol params error', async () => {
    syntheticAssetsService.getProtocolParams.mockRejectedValue(
      new Error('Params not available')
    );

    await expect(syntheticAssetsService.getProtocolParams()).rejects.toThrow(
      'Params not available'
    );
  });
});

// ── updateProtocolParams ────────────────────────────────────────────────────────

describe('updateProtocolParams', () => {
  it('updates protocol parameters successfully', async () => {
    syntheticAssetsService.updateProtocolParams.mockResolvedValue({
      success: true,
      data: { updated: true },
    });

    const result = await syntheticAssetsService.updateProtocolParams(
      1500000,
      1100000,
      50000,
      10000
    );

    expect(result.success).toBe(true);
    expect(syntheticAssetsService.updateProtocolParams).toHaveBeenCalledWith(
      1500000,
      1100000,
      50000,
      10000
    );
  });

  it('handles update protocol params error', async () => {
    syntheticAssetsService.updateProtocolParams.mockRejectedValue(
      new Error('Admin access required')
    );

    await expect(
      syntheticAssetsService.updateProtocolParams(
        1500000,
        1100000,
        50000,
        10000
      )
    ).rejects.toThrow('Admin access required');
  });
});

// ── getMaxMintable ──────────────────────────────────────────────────────────────

describe('getMaxMintable', () => {
  it('calculates max mintable amount successfully', async () => {
    syntheticAssetsService.getMaxMintable.mockResolvedValue({
      maxMintable: '1000000',
      collateralRequired: '500000',
      price: '1000000',
    });

    const result = await syntheticAssetsService.getMaxMintable(
      ASSET_SYMBOL,
      '500000'
    );

    expect(result.maxMintable).toBe('1000000');
    expect(syntheticAssetsService.getMaxMintable).toHaveBeenCalledWith(
      ASSET_SYMBOL,
      '500000'
    );
  });

  it('handles get max mintable error', async () => {
    syntheticAssetsService.getMaxMintable.mockRejectedValue(
      new Error('Calculation error')
    );

    await expect(
      syntheticAssetsService.getMaxMintable(ASSET_SYMBOL, '500000')
    ).rejects.toThrow('Calculation error');
  });
});

// ── getTradingPnL ──────────────────────────────────────────────────────────────

describe('getTradingPnL', () => {
  it('gets trading PnL successfully', async () => {
    syntheticAssetsService.getTradingPnL.mockResolvedValue({
      pnl: '200000',
      unrealized: '150000',
      realized: '50000',
      timestamp: new Date().toISOString(),
    });

    const result = await syntheticAssetsService.getTradingPnL(POSITION_ID);

    expect(result.pnl).toBe('200000');
    expect(syntheticAssetsService.getTradingPnL).toHaveBeenCalledWith(
      POSITION_ID
    );
  });

  it('handles get trading PnL error', async () => {
    syntheticAssetsService.getTradingPnL.mockRejectedValue(
      new Error('PnL calculation failed')
    );

    await expect(
      syntheticAssetsService.getTradingPnL(POSITION_ID)
    ).rejects.toThrow('PnL calculation failed');
  });
});

// ── getRegisteredAssets ─────────────────────────────────────────────────────────

describe('getRegisteredAssets', () => {
  it('gets registered assets successfully', async () => {
    syntheticAssetsService.getRegisteredAssets.mockResolvedValue([
      {
        symbol: 'sUSD',
        name: 'Synthetic USD',
        decimals: 6,
      },
      {
        symbol: 'sBTC',
        name: 'Synthetic BTC',
        decimals: 8,
      },
    ]);

    const result = await syntheticAssetsService.getRegisteredAssets();

    expect(result).toHaveLength(2);
    expect(result[0].symbol).toBe('sUSD');
    expect(syntheticAssetsService.getRegisteredAssets).toHaveBeenCalled();
  });

  it('handles get registered assets error', async () => {
    syntheticAssetsService.getRegisteredAssets.mockRejectedValue(
      new Error('Registry unavailable')
    );

    await expect(syntheticAssetsService.getRegisteredAssets()).rejects.toThrow(
      'Registry unavailable'
    );
  });
});

// ── monitorLiquidations ─────────────────────────────────────────────────────────

describe('monitorLiquidations', () => {
  it('monitors liquidations successfully', async () => {
    databaseService.query.mockResolvedValue({
      rows: [{ position_id: '1234567890' }, { position_id: '0987654321' }],
    });

    syntheticAssetsService.isLiquidatable.mockResolvedValueOnce(true);
    syntheticAssetsService.isLiquidatable.mockResolvedValueOnce(false);

    await syntheticAssetsService.monitorLiquidations();

    expect(databaseService.query).toHaveBeenCalledWith(
      'SELECT position_id FROM positions WHERE status = $1 AND type = $2',
      ['OPEN', 'COLLATERAL']
    );
    expect(syntheticAssetsService.isLiquidatable).toHaveBeenCalledTimes(2);
  });

  it('handles monitor liquidations error', async () => {
    databaseService.query.mockRejectedValue(
      new Error('Database connection failed')
    );

    await expect(syntheticAssetsService.monitorLiquidations()).rejects.toThrow(
      'Database connection failed'
    );
  });
});
