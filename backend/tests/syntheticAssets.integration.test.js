import { jest } from '@jest/globals';

// Mock the synthetic assets service
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
  },
}));

// Mock auth middleware
jest.unstable_mockModule('../src/middleware/auth.js', () => ({
  requireAuth: (_req, _res, next) => next(),
}));

// Mock validation middleware
jest.unstable_mockModule('../src/middleware/validation.js', () => ({
  validateInput: (_req, _res, next) => next(),
}));

const { syntheticAssetsService } =
  await import('../src/services/syntheticAssetsService.js');
const { default: syntheticAssetsRouter } =
  await import('../src/routes/v1/synthetic-assets.js');

import express from 'express';
import request from 'supertest';

const app = express();
app.use(express.json());
app.use('/v1/synthetic-assets', syntheticAssetsRouter);

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const USER_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const POSITION_ID = '1234567890';
const ASSET_SYMBOL = 'sUSD';

beforeEach(() => {
  jest.clearAllMocks();
});

// ── POST /register ──────────────────────────────────────────────────────────────

describe('POST /v1/synthetic-assets/register', () => {
  it('registers new synthetic asset successfully', async () => {
    syntheticAssetsService.registerAsset.mockResolvedValue({
      success: true,
      data: { contractId: CONTRACT_ID },
    });

    const res = await request(app).post('/v1/synthetic-assets/register').send({
      symbol: 'sUSD',
      name: 'Synthetic USD',
      decimals: 6,
      initialPrice: '1000000',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contractId).toBe(CONTRACT_ID);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await request(app).post('/v1/synthetic-assets/register').send({
      symbol: 'sUSD',
      name: 'Synthetic USD',
      // missing decimals and initialPrice
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Missing required fields/);
  });

  it('returns 500 on service error', async () => {
    syntheticAssetsService.registerAsset.mockRejectedValue(
      new Error('Contract deployment failed')
    );

    const res = await request(app).post('/v1/synthetic-assets/register').send({
      symbol: 'sUSD',
      name: 'Synthetic USD',
      decimals: 6,
      initialPrice: '1000000',
    });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Contract deployment failed');
  });
});

// ── POST /mint ─────────────────────────────────────────────────────────────────

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

  it('returns 500 on service error', async () => {
    syntheticAssetsService.mintSynthetic.mockRejectedValue(
      new Error('Insufficient collateral')
    );

    const res = await request(app).post('/v1/synthetic-assets/mint').send({
      userAddress: USER_ADDRESS,
      assetSymbol: ASSET_SYMBOL,
      collateralAmount: '1000000',
      mintAmount: '1000000',
    });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient collateral');
  });
});

// ── POST /burn ──────────────────────────────────────────────────────────────────

describe('POST /v1/synthetic-assets/burn', () => {
  it('burns synthetic assets successfully', async () => {
    syntheticAssetsService.burnSynthetic.mockResolvedValue({
      success: true,
      data: { burned: '1000000' },
    });

    const res = await request(app).post('/v1/synthetic-assets/burn').send({
      userAddress: USER_ADDRESS,
      positionId: POSITION_ID,
      burnAmount: '1000000',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.burned).toBe('1000000');
  });

  it('returns 400 for missing required fields', async () => {
    const res = await request(app).post('/v1/synthetic-assets/burn').send({
      userAddress: USER_ADDRESS,
      positionId: POSITION_ID,
      // missing burnAmount
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 500 on service error', async () => {
    syntheticAssetsService.burnSynthetic.mockRejectedValue(
      new Error('Invalid position')
    );

    const res = await request(app).post('/v1/synthetic-assets/burn').send({
      userAddress: USER_ADDRESS,
      positionId: POSITION_ID,
      burnAmount: '1000000',
    });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Invalid position');
  });
});

// ── POST /add-collateral ────────────────────────────────────────────────────────

describe('POST /v1/synthetic-assets/add-collateral', () => {
  it('adds collateral successfully', async () => {
    syntheticAssetsService.addCollateral.mockResolvedValue({
      success: true,
      data: { added: '500000' },
    });

    const res = await request(app)
      .post('/v1/synthetic-assets/add-collateral')
      .send({
        userAddress: USER_ADDRESS,
        positionId: POSITION_ID,
        additionalCollateral: '500000',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.added).toBe('500000');
  });

  it('returns 400 for missing required fields', async () => {
    const res = await request(app)
      .post('/v1/synthetic-assets/add-collateral')
      .send({
        userAddress: USER_ADDRESS,
        positionId: POSITION_ID,
        // missing additionalCollateral
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 500 on service error', async () => {
    syntheticAssetsService.addCollateral.mockRejectedValue(
      new Error('Insufficient funds')
    );

    const res = await request(app)
      .post('/v1/synthetic-assets/add-collateral')
      .send({
        userAddress: USER_ADDRESS,
        positionId: POSITION_ID,
        additionalCollateral: '500000',
      });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient funds');
  });
});

// ── POST /open-trade ────────────────────────────────────────────────────────────

describe('POST /v1/synthetic-assets/open-trade', () => {
  it('opens trading position successfully', async () => {
    syntheticAssetsService.openTrade.mockResolvedValue({
      success: true,
      positionId: POSITION_ID,
      data: POSITION_ID,
    });

    const res = await request(app)
      .post('/v1/synthetic-assets/open-trade')
      .send({
        userAddress: USER_ADDRESS,
        assetSymbol: ASSET_SYMBOL,
        direction: 'LONG',
        margin: '1000000',
        leverage: 5,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBe(POSITION_ID);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await request(app)
      .post('/v1/synthetic-assets/open-trade')
      .send({
        userAddress: USER_ADDRESS,
        assetSymbol: ASSET_SYMBOL,
        direction: 'LONG',
        // missing margin and leverage
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 500 on service error', async () => {
    syntheticAssetsService.openTrade.mockRejectedValue(
      new Error('Invalid direction')
    );

    const res = await request(app)
      .post('/v1/synthetic-assets/open-trade')
      .send({
        userAddress: USER_ADDRESS,
        assetSymbol: ASSET_SYMBOL,
        direction: 'INVALID',
        margin: '1000000',
        leverage: 5,
      });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Invalid direction');
  });
});

// ── POST /close-trade ───────────────────────────────────────────────────────────

describe('POST /v1/synthetic-assets/close-trade', () => {
  it('closes trading position successfully', async () => {
    syntheticAssetsService.closeTrade.mockResolvedValue({
      success: true,
      finalAmount: '1200000',
      data: '1200000',
    });

    const res = await request(app)
      .post('/v1/synthetic-assets/close-trade')
      .send({
        userAddress: USER_ADDRESS,
        positionId: POSITION_ID,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBe('1200000');
  });

  it('returns 400 for missing required fields', async () => {
    const res = await request(app)
      .post('/v1/synthetic-assets/close-trade')
      .send({
        userAddress: USER_ADDRESS,
        // missing positionId
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 500 on service error', async () => {
    syntheticAssetsService.closeTrade.mockRejectedValue(
      new Error('Position not found')
    );

    const res = await request(app)
      .post('/v1/synthetic-assets/close-trade')
      .send({
        userAddress: USER_ADDRESS,
        positionId: POSITION_ID,
      });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Position not found');
  });
});

// ── POST /price ─────────────────────────────────────────────────────────────────

describe('POST /v1/synthetic-assets/price', () => {
  it('updates asset price successfully', async () => {
    syntheticAssetsService.updatePrice.mockResolvedValue({
      success: true,
      data: { updated: true },
    });

    const res = await request(app).post('/v1/synthetic-assets/price').send({
      assetSymbol: ASSET_SYMBOL,
      newPrice: '1050000',
      confidence: 95,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await request(app).post('/v1/synthetic-assets/price').send({
      assetSymbol: ASSET_SYMBOL,
      // missing newPrice and confidence
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 500 on service error', async () => {
    syntheticAssetsService.updatePrice.mockRejectedValue(
      new Error('Oracle failure')
    );

    const res = await request(app).post('/v1/synthetic-assets/price').send({
      assetSymbol: ASSET_SYMBOL,
      newPrice: '1050000',
      confidence: 95,
    });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Oracle failure');
  });
});

// ── GET /price/:symbol ──────────────────────────────────────────────────────────

describe('GET /v1/synthetic-assets/price/:symbol', () => {
  it('gets asset price successfully', async () => {
    syntheticAssetsService.getAssetPrice.mockResolvedValue({
      price: '1050000',
      confidence: 95,
      lastUpdated: new Date().toISOString(),
    });

    const res = await request(app).get(
      `/v1/synthetic-assets/price/${ASSET_SYMBOL}`
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.price).toBe('1050000');
  });

  it('returns 500 on service error', async () => {
    syntheticAssetsService.getAssetPrice.mockRejectedValue(
      new Error('Price not available')
    );

    const res = await request(app).get(
      `/v1/synthetic-assets/price/${ASSET_SYMBOL}`
    );

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Price not available');
  });
});

// ── GET /position/:id ───────────────────────────────────────────────────────────

describe('GET /v1/synthetic-assets/position/:id', () => {
  it('gets position details successfully', async () => {
    syntheticAssetsService.getPosition.mockResolvedValue({
      positionId: POSITION_ID,
      userAddress: USER_ADDRESS,
      assetSymbol: ASSET_SYMBOL,
      collateralAmount: '1000000',
      mintedAmount: '1000000',
    });

    const res = await request(app).get(
      `/v1/synthetic-assets/position/${POSITION_ID}`
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.positionId).toBe(POSITION_ID);
  });

  it('returns 500 on service error', async () => {
    syntheticAssetsService.getPosition.mockRejectedValue(
      new Error('Position not found')
    );

    const res = await request(app).get(
      `/v1/synthetic-assets/position/${POSITION_ID}`
    );

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Position not found');
  });
});

// ── GET /trade/:id ───────────────────────────────────────────────────────────────

describe('GET /v1/synthetic-assets/trade/:id', () => {
  it('gets trading position successfully', async () => {
    syntheticAssetsService.getTradingPosition.mockResolvedValue({
      positionId: POSITION_ID,
      userAddress: USER_ADDRESS,
      assetSymbol: ASSET_SYMBOL,
      margin: '1000000',
      leverage: 5,
      direction: 'LONG',
    });

    const res = await request(app).get(
      `/v1/synthetic-assets/trade/${POSITION_ID}`
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.positionId).toBe(POSITION_ID);
  });

  it('returns 500 on service error', async () => {
    syntheticAssetsService.getTradingPosition.mockRejectedValue(
      new Error('Trading position not found')
    );

    const res = await request(app).get(
      `/v1/synthetic-assets/trade/${POSITION_ID}`
    );

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Trading position not found');
  });
});

// ── GET /ratio/:id ───────────────────────────────────────────────────────────────

describe('GET /v1/synthetic-assets/ratio/:id', () => {
  it('gets collateral ratio successfully', async () => {
    syntheticAssetsService.getCollateralRatio.mockResolvedValue({
      ratio: '2000000', // 200%
      healthFactor: '3000000', // 300%
    });

    const res = await request(app).get(
      `/v1/synthetic-assets/ratio/${POSITION_ID}`
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ratio).toBe('2000000');
  });

  it('returns 500 on service error', async () => {
    syntheticAssetsService.getCollateralRatio.mockRejectedValue(
      new Error('Invalid position')
    );

    const res = await request(app).get(
      `/v1/synthetic-assets/ratio/${POSITION_ID}`
    );

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Invalid position');
  });
});

// ── GET /health/:id ───────────────────────────────────────────────────────────────

describe('GET /v1/synthetic-assets/health/:id', () => {
  it('gets health factor successfully', async () => {
    syntheticAssetsService.getHealthFactor.mockResolvedValue({
      healthFactor: '3000000', // 300%
      status: 'SAFE',
    });

    const res = await request(app).get(
      `/v1/synthetic-assets/health/${POSITION_ID}`
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.healthFactor).toBe('3000000');
  });

  it('returns 500 on service error', async () => {
    syntheticAssetsService.getHealthFactor.mockRejectedValue(
      new Error('Health check failed')
    );

    const res = await request(app).get(
      `/v1/synthetic-assets/health/${POSITION_ID}`
    );

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Health check failed');
  });
});

// ── GET /liquidatable/:id ───────────────────────────────────────────────────────

describe('GET /v1/synthetic-assets/liquidatable/:id', () => {
  it('checks liquidation status successfully', async () => {
    syntheticAssetsService.isLiquidatable.mockResolvedValue(true);

    const res = await request(app).get(
      `/v1/synthetic-assets/liquidatable/${POSITION_ID}`
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isLiquidatable).toBe(true);
  });

  it('returns 500 on service error', async () => {
    syntheticAssetsService.isLiquidatable.mockRejectedValue(
      new Error('Contract call failed')
    );

    const res = await request(app).get(
      `/v1/synthetic-assets/liquidatable/${POSITION_ID}`
    );

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Contract call failed');
  });
});

// ── GET /params ─────────────────────────────────────────────────────────────────

describe('GET /v1/synthetic-assets/params', () => {
  it('gets protocol parameters successfully', async () => {
    syntheticAssetsService.getProtocolParams.mockResolvedValue({
      minCollateralRatio: 1500000, // 150%
      liquidationThreshold: 1100000, // 110%
      liquidationBonus: 50000, // 5%
      feePercentage: 10000, // 1%
    });

    const res = await request(app).get('/v1/synthetic-assets/params');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.minCollateralRatio).toBe(1500000);
  });

  it('returns 500 on service error', async () => {
    syntheticAssetsService.getProtocolParams.mockRejectedValue(
      new Error('Params not available')
    );

    const res = await request(app).get('/v1/synthetic-assets/params');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Params not available');
  });
});

// ── PUT /params ─────────────────────────────────────────────────────────────────

describe('PUT /v1/synthetic-assets/params', () => {
  it('updates protocol parameters successfully', async () => {
    syntheticAssetsService.updateProtocolParams.mockResolvedValue({
      success: true,
      data: { updated: true },
    });

    const res = await request(app).put('/v1/synthetic-assets/params').send({
      minCollateralRatio: 1500000,
      liquidationThreshold: 1100000,
      liquidationBonus: 50000,
      feePercentage: 10000,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 for missing required parameters', async () => {
    const res = await request(app).put('/v1/synthetic-assets/params').send({
      minCollateralRatio: 1500000,
      liquidationThreshold: 1100000,
      // missing liquidationBonus and feePercentage
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 500 on service error', async () => {
    syntheticAssetsService.updateProtocolParams.mockRejectedValue(
      new Error('Admin access required')
    );

    const res = await request(app).put('/v1/synthetic-assets/params').send({
      minCollateralRatio: 1500000,
      liquidationThreshold: 1100000,
      liquidationBonus: 50000,
      feePercentage: 10000,
    });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Admin access required');
  });
});

// ── GET /assets ─────────────────────────────────────────────────────────────────

describe('GET /v1/synthetic-assets/assets', () => {
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

    const res = await request(app).get('/v1/synthetic-assets/assets');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
  });

  it('returns 500 on service error', async () => {
    syntheticAssetsService.getRegisteredAssets.mockRejectedValue(
      new Error('Registry unavailable')
    );

    const res = await request(app).get('/v1/synthetic-assets/assets');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Registry unavailable');
  });
});

// ── GET /max-mintable ───────────────────────────────────────────────────────────

describe('GET /v1/synthetic-assets/max-mintable', () => {
  it('calculates max mintable amount successfully', async () => {
    syntheticAssetsService.getMaxMintable.mockResolvedValue({
      maxMintable: '1000000',
      collateralRequired: '500000',
      price: '1000000',
    });

    const res = await request(app)
      .get('/v1/synthetic-assets/max-mintable')
      .query({
        assetSymbol: ASSET_SYMBOL,
        collateralAmount: '500000',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.maxMintable).toBe('1000000');
  });

  it('returns 400 for missing required query parameters', async () => {
    const res = await request(app)
      .get('/v1/synthetic-assets/max-mintable')
      .query({
        assetSymbol: ASSET_SYMBOL,
        // missing collateralAmount
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 500 on service error', async () => {
    syntheticAssetsService.getMaxMintable.mockRejectedValue(
      new Error('Calculation error')
    );

    const res = await request(app)
      .get('/v1/synthetic-assets/max-mintable')
      .query({
        assetSymbol: ASSET_SYMBOL,
        collateralAmount: '500000',
      });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Calculation error');
  });
});

// ── GET /pnl/:id ────────────────────────────────────────────────────────────────

describe('GET /v1/synthetic-assets/pnl/:id', () => {
  it('gets trading PnL successfully', async () => {
    syntheticAssetsService.getTradingPnL.mockResolvedValue({
      pnl: '200000',
      unrealized: '150000',
      realized: '50000',
      timestamp: new Date().toISOString(),
    });

    const res = await request(app).get(
      `/v1/synthetic-assets/pnl/${POSITION_ID}`
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.pnl).toBe('200000');
  });

  it('returns 500 on service error', async () => {
    syntheticAssetsService.getTradingPnL.mockRejectedValue(
      new Error('PnL calculation failed')
    );

    const res = await request(app).get(
      `/v1/synthetic-assets/pnl/${POSITION_ID}`
    );

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('PnL calculation failed');
  });
});

// ── GET /health ───────────────────────────────────────────────────────────────────

describe('GET /v1/synthetic-assets/health', () => {
  it('returns health check successfully', async () => {
    const res = await request(app).get('/v1/synthetic-assets/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Synthetic Assets API is running');
  });
});
