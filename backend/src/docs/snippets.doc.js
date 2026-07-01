// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @swagger
 * components:
 *   schemas:
 *     Snippet:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: a1b2c3d4
 *         code:
 *           type: string
 *           example: "#![no_std]\nuse soroban_sdk::..."
 *         language:
 *           type: string
 *           example: rust
 *         title:
 *           type: string
 *           example: Hello World Contract
 *         createdAt:
 *           type: string
 *           format: date-time
 *         shareUrl:
 *           type: string
 *           format: uri
 *           example: https://api.example.com/api/snippets/a1b2c3d4
 *
 *     DeployJob:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: job_a1b2c3d4
 *         wasmPath:
 *           type: string
 *         contractName:
 *           type: string
 *         network:
 *           type: string
 *           example: testnet
 *         status:
 *           type: string
 *           enum: [queued, running, done, failed]
 *         createdAt:
 *           type: string
 *           format: date-time
 *         startedAt:
 *           type: string
 *           format: date-time
 *         completedAt:
 *           type: string
 *           format: date-time
 *         result:
 *           $ref: '#/components/schemas/DeployJobResult'
 *         error:
 *           type: string
 *
 *     DeployJobResult:
 *       type: object
 *       properties:
 *         contractId:
 *           type: string
 *         contractName:
 *           type: string
 *         network:
 *           type: string
 *         wasmPath:
 *           type: string
 *         deployedAt:
 *           type: string
 *           format: date-time
 *         message:
 *           type: string
 *
 *     DeployQueueStats:
 *       type: object
 *       properties:
 *         queued:
 *           type: integer
 *         running:
 *           type: integer
 *         done:
 *           type: integer
 *         failed:
 *           type: integer
 *         total:
 *           type: integer
 */
