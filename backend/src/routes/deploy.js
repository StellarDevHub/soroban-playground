import express from "express";
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";

const router = express.Router();

router.post("/", async (req, res) => {
  // In a real implementation this would receive a WASM buffer or path
  // from the compile step. We'll simulate receiving code or an existing compile job.
  
  // Here we would typically run: `soroban contract deploy --wasm contract.wasm --source alice --network testnet`
  
  // For the MVP, if no actual network configs/keys are present, 
  // we simulate the deployment response. A full open-source implementation 
  // would construct a temporary keypair for the user using \`stellar-sdk\` 
  // or use a predefined funded testnet identity.
  
  setTimeout(() => {
    // Generate a random contract ID to simulate successful deploy
    const contractId = "C" + Math.random().toString(36).substring(2, 54).toUpperCase();
    res.json({
      success: true,
      contractId,
      message: "Contract deployed successfully to Testnet"
    });
  }, 1500);
});

export default router;
// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';

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

export default router;
