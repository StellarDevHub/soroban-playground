import express from 'express';
import { asyncHandler, createHttpError } from '../../middleware/errorHandler.js';
import { invokeSorobanContract } from '../../services/invokeService.js';

const router = express.Router();

const CONTRACT_ID_RE = /^C[A-Z0-9]{55}$/;

function validateContractId(contractId, errors) {
  if (!contractId) {
    errors.push('contract_id is required');
  } else if (typeof contractId !== 'string' || !CONTRACT_ID_RE.test(contractId)) {
    errors.push('contract_id must be a valid Stellar contract ID');
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
      contract_id: result.contractId,
      function_name: result.functionName,
      args: payload.args,
      output: result.parsed,
      stdout: result.stdout,
      stderr: result.stderr,
      message: `Function "${result.functionName}" invoked successfully`,
      invoked_at: result.endedAt,
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
    const {
      contract_id,
      owner,
      did,
      metadata_hash,
      network,
      source_account,
    } = req.body || {};
    const errors = [];
    validateContractId(contract_id, errors);
    validateRequiredString('owner', owner, errors);
    validateRequiredString('did', did, errors);
    const metadata = parseIntField('metadata_hash', metadata_hash, errors);

    if (errors.length) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    return invokeAndRespond(req, res, next, {
      contractId: contract_id,
      functionName: 'register_identity',
      args: {
        owner,
        did,
        metadata_hash: String(metadata),
      },
      network,
      sourceAccount: source_account,
    });
  })
);

router.post(
  '/metadata',
  asyncHandler(async (req, res, next) => {
    const { contract_id, owner, metadata_hash, network, source_account } =
      req.body || {};
    const errors = [];
    validateContractId(contract_id, errors);
    validateRequiredString('owner', owner, errors);
    const metadata = parseIntField('metadata_hash', metadata_hash, errors);

    if (errors.length) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    return invokeAndRespond(req, res, next, {
      contractId: contract_id,
      functionName: 'update_metadata',
      args: {
        owner,
        metadata_hash: String(metadata),
      },
      network,
      sourceAccount: source_account,
    });
  })
);

router.post(
  '/deactivate',
  asyncHandler(async (req, res, next) => {
    const { contract_id, owner, network, source_account } = req.body || {};
    const errors = [];
    validateContractId(contract_id, errors);
    validateRequiredString('owner', owner, errors);

    if (errors.length) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    return invokeAndRespond(req, res, next, {
      contractId: contract_id,
      functionName: 'deactivate_identity',
      args: { owner },
      network,
      sourceAccount: source_account,
    });
  })
);

router.post(
  '/credentials/issue',
  asyncHandler(async (req, res, next) => {
    const {
      contract_id,
      issuer,
      subject,
      schema_hash,
      data_hash,
      expires_at,
      network,
      source_account,
    } = req.body || {};
    const errors = [];
    validateContractId(contract_id, errors);
    validateRequiredString('issuer', issuer, errors);
    validateRequiredString('subject', subject, errors);
    const schema = parseIntField('schema_hash', schema_hash, errors);
    const data = parseIntField('data_hash', data_hash, errors);
    const expiry = parseIntField('expires_at', expires_at, errors);

    if (errors.length) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    return invokeAndRespond(req, res, next, {
      contractId: contract_id,
      functionName: 'issue_credential',
      args: {
        issuer,
        subject,
        schema_hash: String(schema),
        data_hash: String(data),
        expires_at: String(expiry),
      },
      network,
      sourceAccount: source_account,
    });
  })
);

router.post(
  '/credentials/revoke',
  asyncHandler(async (req, res, next) => {
    const { contract_id, credential_id, network, source_account } =
      req.body || {};
    const errors = [];
    validateContractId(contract_id, errors);
    const credential = parseIntField('credential_id', credential_id, errors);

    if (errors.length) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    return invokeAndRespond(req, res, next, {
      contractId: contract_id,
      functionName: 'revoke_credential',
      args: { credential_id: String(credential) },
      network,
      sourceAccount: source_account,
    });
  })
);

router.post(
  '/reputation/adjust',
  asyncHandler(async (req, res, next) => {
    const { contract_id, subject, delta, network, source_account } =
      req.body || {};
    const errors = [];
    validateContractId(contract_id, errors);
    validateRequiredString('subject', subject, errors);
    const deltaValue = parseIntField('delta', delta, errors);

    if (errors.length) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    return invokeAndRespond(req, res, next, {
      contractId: contract_id,
      functionName: 'adjust_reputation',
      args: { subject, delta: String(deltaValue) },
      network,
      sourceAccount: source_account,
    });
  })
);

router.get(
  '/:owner',
  asyncHandler(async (req, res, next) => {
    const { contract_id, network, source_account } = req.query || {};
    const { owner } = req.params;
    const errors = [];
    validateContractId(contract_id, errors);
    validateRequiredString('owner', owner, errors);

    if (errors.length) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    return invokeAndRespond(req, res, next, {
      contractId: contract_id,
      functionName: 'get_identity',
      args: { owner },
      network,
      sourceAccount: source_account,
    });
  })
);

router.get(
  '/credentials/:credentialId',
  asyncHandler(async (req, res, next) => {
    const { contract_id, network, source_account } = req.query || {};
    const { credentialId } = req.params;
    const errors = [];
    validateContractId(contract_id, errors);
    const credential = parseIntField('credential_id', credentialId, errors);

    if (errors.length) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    return invokeAndRespond(req, res, next, {
      contractId: contract_id,
      functionName: 'get_credential',
      args: { credential_id: String(credential) },
      network,
      sourceAccount: source_account,
    });
  })
);

export default router;
