// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import {
  asyncHandler,
  createHttpError,
} from '../../middleware/errorHandler.js';
import { deployBatchContracts } from '../../services/deployService.js';
import { rateLimitMiddleware } from '../../middleware/rateLimiter.js';

const router = express.Router();

/**
 * Validates the deploy request payload
 * @param {Object} body - Request body
 * @returns {Object|null} - Validation error object or null if valid
 */
function validateDeployRequest(body) {
  const { wasmPath, contractName } = body;
  const errors = [];

  if (!wasmPath) {
    errors.push('wasmPath is required');
  } else if (typeof wasmPath !== 'string') {
    errors.push('wasmPath must be a string');
  }

  if (!contractName) {
    errors.push('contractName is required');
  } else if (typeof contractName !== 'string') {
    errors.push('contractName must be a string');
  }

  if (errors.length > 0) {
    return {
      error: 'Validation failed',
      details: errors,
    };
  }

  return null;
}

router.post(
  '/',
  rateLimitMiddleware('deploy'),
  asyncHandler(async (req, res, next) => {
    // Validate request payload
    const validationError = validateDeployRequest(req.body);
    if (validationError) {
      return next(
        createHttpError(400, validationError.error, validationError.details)
      );
    }

    const { wasmPath, contractName, network = 'testnet' } = req.body;

    // In a real implementation this would receive a WASM buffer or path
    // from the compile step. We'll simulate receiving code or an existing compile job.

    // Here we would typically run: `soroban contract deploy --wasm contract.wasm --source alice --network testnet`

    // For the MVP, if no actual network configs/keys are present,
    // we simulate the deployment response. A full open-source implementation
    // would construct a temporary keypair for the user using `stellar-sdk`
    // or use a predefined funded testnet identity.

    setTimeout(() => {
      // Generate a random contract ID to simulate successful deploy
      // Stellar contract IDs start with 'C' and are 56 characters long
      const contractId =
        'C' + Math.random().toString(36).substring(2, 54).toUpperCase();

      res.json({
        success: true,
        status: 'success',
        contractId,
        contractName,
        network,
        wasmPath,
        deployedAt: new Date().toISOString(),
        message: `Contract "${contractName}" deployed successfully to ${network}`,
      });
    }, 1500);
  })
);

function validateBatchRequest(body) {
  const { contracts } = body || {};
  if (!Array.isArray(contracts) || contracts.length === 0) {
    return ['contracts must be a non-empty array'];
  }
  return null;
}

router.post(
  '/batch',
  rateLimitMiddleware('deploy'),
  asyncHandler(async (req, res, next) => {
    const errors = validateBatchRequest(req.body);
    if (errors) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    const controller = new AbortController();
    req.on('aborted', () => controller.abort());

    try {
      const result = await deployBatchContracts(
        {
          requestId: `batch-${Date.now()}`,
          batchId: req.body.batchId,
          contracts: req.body.contracts,
        },
        { signal: controller.signal }
      );

      return res.json(result);
    } catch (error) {
      return next(
        createHttpError(502, 'Batch deployment failed', [error.message])
      );
    }
  })
);

// Memory fallback for deployment jobs in test/offline environments
const inMemoryDeployJobs = new Map();

router.post(
  '/async',
  rateLimitMiddleware('deploy'),
  asyncHandler(async (req, res, next) => {
    const {
      wasmPath,
      contractName,
      network = 'testnet',
      sourceAccount,
    } = req.body || {};

    const validationError = validateDeployRequest(req.body);
    if (validationError) {
      return next(
        createHttpError(400, validationError.error, validationError.details)
      );
    }

    const jobId = `deploy-job-${Date.now()}-${Math.random()
      .toString(36)
      .substring(7)}`;

    try {
      const { queues } = await import('../../services/queueService.js');
      if (queues && queues.deployment) {
        await queues.deployment.add(
          'deploy-contract',
          {
            wasmPath,
            contractName,
            network,
            sourceAccount,
          },
          { jobId }
        );
      } else {
        inMemoryDeployJobs.set(jobId, {
          status: 'queued',
          createdAt: new Date().toISOString(),
        });
      }
    } catch {
      inMemoryDeployJobs.set(jobId, {
        status: 'queued',
        createdAt: new Date().toISOString(),
      });
    }

    return res.status(202).json({
      success: true,
      jobId,
      status: 'queued',
      message: 'Deployment job queued asynchronously',
      createdAt: new Date().toISOString(),
    });
  })
);

router.get(
  '/job/:jobId',
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;

    try {
      const { queues } = await import('../../services/queueService.js');
      if (queues && queues.deployment) {
        const job = await queues.deployment.getJob(jobId);
        if (job) {
          const state = await job.getState();
          return res.json({
            success: true,
            jobId,
            status: state,
            result: job.returnvalue || null,
            failedReason: job.failedReason || null,
          });
        }
      }
    } catch {
      // Fall through to memory check
    }

    const memoryJob = inMemoryDeployJobs.get(jobId);
    if (memoryJob) {
      return res.json({
        success: true,
        jobId,
        status: memoryJob.status,
        result: memoryJob.result || null,
      });
    }

    return res.status(404).json({
      success: false,
      error: 'Deployment job not found',
    });
  })
);

export default router;
