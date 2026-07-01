import { HttpError } from './errorHandler.js';
import signatureValidationService from '../services/signatureValidationService.js';

const REQUIRED_FIELDS = [
  'callerAddress',
  'contractId',
  'method',
  'nonce',
  'expiry',
  'signature',
];

/**
 * Express middleware that validates a Stellar ED25519 signature on the request body.
 *
 * On success: attaches req.signerAddress and calls next().
 * On failure: calls next(HttpError 400) for missing fields or next(HttpError 401) for
 *             invalid/expired/replayed signatures with a machine-readable `reason` field.
 *
 * Expected request body fields:
 *   callerAddress, contractId, method, params?, nonce, expiry, signature
 */
export function validateStellarSignature(req, res, next) {
  const missing = REQUIRED_FIELDS.filter((f) => req.body[f] == null);
  if (missing.length) {
    return next(
      new HttpError(400, `Missing required fields: ${missing.join(', ')}`)
    );
  }

  const {
    callerAddress,
    contractId,
    method,
    params,
    nonce,
    expiry,
    signature,
  } = req.body;

  signatureValidationService
    .verify({
      callerAddress,
      contractId,
      method,
      params,
      nonce,
      expiry,
      signature,
    })
    .then((result) => {
      if (!result.valid) {
        return next(
          new HttpError(401, 'Invalid signature', { reason: result.reason })
        );
      }
      req.signerAddress = callerAddress;
      next();
    })
    .catch(next);
}
