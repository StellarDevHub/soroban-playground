import express from 'express';
import { asyncHandler, createHttpError } from '../../middleware/errorHandler.js';
import { invokeSorobanContract } from '../../services/invokeService.js';

const router = express.Router();

const CONTRACT_ID_RE = /^C[A-Z0-9]{55}$/;

function validateContractId(contractId, errors) {
  if (!contractId) {
    errors.push('contractId is required');
  } else if (typeof contractId !== 'string' || !CONTRACT_ID_RE.test(contractId)) {
    errors.push('contractId must be a valid Stellar contract ID');
  }
}

function validateRequiredString(field, value, errors) {
  if (!value) {
    errors.push(`${field} is required`);
  } else if (typeof value !== 'string') {
    errors.push(`${field} must be a string`);
  }
}

function parseIntField(field, value, errors) {
  if (value === undefined || value === null || value === '') {
    errors.push(`${field} is required`);
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    errors.push(`${field} must be a valid number`);
    return null;
  }
  return parsed;
}

async function invokeAndRespond(req, res, next, payload) {
  const requestId = `identity-${payload.functionName}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 8)}`;
  const controller = new AbortController();
  req.on('aborted', () => controller.abort());

  try {
    const result = await invokeSorobanContract(
      {
        requestId,
        contractId: payload.contractId,
        functionName: payload.functionName,
        args: payload.args,
        network: payload.network,
        sourceAccount: payload.sourceAccount,
      },
      { signal: controller.signal }
    );

    return res.json({
      success: true,
      status: 'success',
      contractId: result.contractId,
      functionName: result.functionName,
      args: payload.args,
      output: result.parsed,
      stdout: result.stdout,
      stderr: result.stderr,
      message: `Function "${result.functionName}" invoked successfully`,
      invokedAt: result.endedAt,
    });
  } catch (error) {
    const details = [
      error?.message || 'Soroban invocation failed',
      error?.stderr ? `stderr: ${error.stderr}` : null,
    ].filter(Boolean);
    return next(createHttpError(502, 'Invocation failed', details));
  }
}

router.post(
  '/register',
  asyncHandler(async (req, res, next) => {
    const { contractId, owner, did, metadataHash, network, sourceAccount } =
      req.body || {};
    const errors = [];
    validateContractId(contractId, errors);
    validateRequiredString('owner', owner, errors);
    validateRequiredString('did', did, errors);
    const metadata = parseIntField('metadataHash', metadataHash, errors);

    if (errors.length) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    return invokeAndRespond(req, res, next, {
      contractId,
      functionName: 'register_identity',
      args: {
        owner,
        did,
        metadata_hash: String(metadata),
      },
      network,
      sourceAccount,
    });
  })
);

router.post(
  '/metadata',
  asyncHandler(async (req, res, next) => {
    const { contractId, owner, metadataHash, network, sourceAccount } =
      req.body || {};
    const errors = [];
    validateContractId(contractId, errors);
    validateRequiredString('owner', owner, errors);
    const metadata = parseIntField('metadataHash', metadataHash, errors);

    if (errors.length) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    return invokeAndRespond(req, res, next, {
      contractId,
      functionName: 'update_metadata',
      args: {
        owner,
        metadata_hash: String(metadata),
      },
      network,
      sourceAccount,
    });
  })
);

router.post(
  '/deactivate',
  asyncHandler(async (req, res, next) => {
    const { contractId, owner, network, sourceAccount } = req.body || {};
    const errors = [];
    validateContractId(contractId, errors);
    validateRequiredString('owner', owner, errors);

    if (errors.length) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    return invokeAndRespond(req, res, next, {
      contractId,
      functionName: 'deactivate_identity',
      args: { owner },
      network,
      sourceAccount,
    });
  })
);

router.post(
  '/credentials/issue',
  asyncHandler(async (req, res, next) => {
    const {
      contractId,
      issuer,
      subject,
      schemaHash,
      dataHash,
      expiresAt,
      network,
      sourceAccount,
    } = req.body || {};
    const errors = [];
    validateContractId(contractId, errors);
    validateRequiredString('issuer', issuer, errors);
    validateRequiredString('subject', subject, errors);
    const schema = parseIntField('schemaHash', schemaHash, errors);
    const data = parseIntField('dataHash', dataHash, errors);
    const expiry = parseIntField('expiresAt', expiresAt, errors);

    if (errors.length) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    return invokeAndRespond(req, res, next, {
      contractId,
      functionName: 'issue_credential',
      args: {
        issuer,
        subject,
        schema_hash: String(schema),
        data_hash: String(data),
        expires_at: String(expiry),
      },
      network,
      sourceAccount,
    });
  })
);

router.post(
  '/credentials/revoke',
  asyncHandler(async (req, res, next) => {
    const { contractId, credentialId, network, sourceAccount } =
      req.body || {};
    const errors = [];
    validateContractId(contractId, errors);
    const credential = parseIntField('credentialId', credentialId, errors);

    if (errors.length) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    return invokeAndRespond(req, res, next, {
      contractId,
      functionName: 'revoke_credential',
      args: { credential_id: String(credential) },
      network,
      sourceAccount,
    });
  })
);

router.post(
  '/reputation/adjust',
  asyncHandler(async (req, res, next) => {
    const { contractId, subject, delta, network, sourceAccount } =
      req.body || {};
    const errors = [];
    validateContractId(contractId, errors);
    validateRequiredString('subject', subject, errors);
    const deltaValue = parseIntField('delta', delta, errors);

    if (errors.length) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    return invokeAndRespond(req, res, next, {
      contractId,
      functionName: 'adjust_reputation',
      args: { subject, delta: String(deltaValue) },
      network,
      sourceAccount,
    });
  })
);

router.get(
  '/:owner',
  asyncHandler(async (req, res, next) => {
    const { contractId, network, sourceAccount } = req.query || {};
    const { owner } = req.params;
    const errors = [];
    validateContractId(contractId, errors);
    validateRequiredString('owner', owner, errors);

    if (errors.length) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    return invokeAndRespond(req, res, next, {
      contractId,
      functionName: 'get_identity',
      args: { owner },
      network,
      sourceAccount,
    });
  })
);

router.get(
  '/credentials/:credentialId',
  asyncHandler(async (req, res, next) => {
    const { contractId, network, sourceAccount } = req.query || {};
    const { credentialId } = req.params;
    const errors = [];
    validateContractId(contractId, errors);
    const credential = parseIntField('credentialId', credentialId, errors);

    if (errors.length) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    return invokeAndRespond(req, res, next, {
      contractId,
      functionName: 'get_credential',
      args: { credential_id: String(credential) },
      network,
      sourceAccount,
    });
  })
);

export default router;
