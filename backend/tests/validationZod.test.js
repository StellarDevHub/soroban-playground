import { z } from 'zod';
import { validateRequest, validateInput, commonSchemas } from '../src/middleware/validation.js';

describe('Zod Validation Middleware', () => {
  test('validateInput works as a pass-through middleware', () => {
    const req = {};
    const res = {};
    const next = jest.fn();
    validateInput(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('validateRequest passes valid payloads', () => {
    const middleware = validateRequest({
      body: z.object({
        amount: z.number().positive(),
      }),
    });

    const req = { body: { amount: 100 } };
    const res = {};
    const next = jest.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ amount: 100 });
  });

  test('validateRequest rejects invalid payloads with 422', () => {
    const middleware = validateRequest({
      body: z.object({
        amount: z.number().positive(),
      }),
    });

    const req = { body: { amount: -50 } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: 'Unprocessable Entity',
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('commonSchemas.stellarAddress validates Stellar public keys', () => {
    const valid = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';
    expect(commonSchemas.stellarAddress.safeParse(valid).success).toBe(true);
    expect(commonSchemas.stellarAddress.safeParse('invalid').success).toBe(false);
  });
});
