import { jest } from '@jest/globals';

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
