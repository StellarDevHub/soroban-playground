// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Job Marketplace API Routes
 * 
 * Provides RESTful endpoints for interacting with the Job Marketplace smart contract
 */

import express from 'express';
import jobMarketplaceService from '../services/jobMarketplaceService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validation.js';
import { body, param, query } from 'express-validator';

const router = express.Router();

// ── Job Management Routes ─────────────────────────────────────────────────────

/**
 * GET /api/job-marketplace/jobs
 * Get all jobs with filtering and pagination
 */
router.get('/jobs', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['Open', 'InProgress', 'Completed', 'Disputed', 'Cancelled']),
  query('client').optional().isString(),
  query('freelancer').optional().isString(),
], asyncHandler(async (req, res) => {
  const filters = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20,
    status: req.query.status,
    client: req.query.client,
    freelancer: req.query.freelancer,
  };

  const result = await jobMarketplaceService.getJobs(filters);
  res.json({
    success: true,
    data: result,
  });
}));

/**
 * GET /api/job-marketplace/jobs/:jobId
 * Get job details by ID
 */
router.get('/jobs/:jobId', [
  param('jobId').isInt({ min: 1 }),
], asyncHandler(async (req, res) => {
  const jobId = parseInt(req.params.jobId);
  const job = await jobMarketplaceService.getJob(jobId);
  
  res.json({
    success: true,
    data: job,
  });
}));

/**
 * POST /api/job-marketplace/jobs
 * Create a new job with escrow
 */
router.post('/jobs', [
  body('client').isString().notEmpty(),
  body('title').isString().notEmpty().isLength({ max: 255 }),
  body('description').isString().notEmpty(),
  body('paymentToken').isString().notEmpty(),
  body('totalEscrow').isString().notEmpty(),
  body('milestones').isArray({ min: 1 }),
  body('milestones.*.description').isString().notEmpty(),
  body('milestones.*.amount').isString().notEmpty(),
  body('requiredSkills').optional().isArray(),
], asyncHandler(async (req, res) => {
  const jobData = req.body;
  const result = await jobMarketplaceService.createJob(jobData);
  
  res.status(201).json({
    success: true,
    data: result,
  });
}));

/**
 * POST /api/job-marketplace/jobs/:jobId/accept
 * Accept a job as freelancer
 */
router.post('/jobs/:jobId/accept', [
  param('jobId').isInt({ min: 1 }),
  body('freelancer').isString().notEmpty(),
], asyncHandler(async (req, res) => {
  const jobId = parseInt(req.params.jobId);
  const { freelancer } = req.body;
  
  const result = await jobMarketplaceService.acceptJob(jobId, freelancer);
  
  res.json({
    success: true,
    data: result,
  });
}));

/**
 * POST /api/job-marketplace/jobs/:jobId/release-milestone
 * Release milestone payment
 */
router.post('/jobs/:jobId/release-milestone', [
  param('jobId').isInt({ min: 1 }),
  body('client').isString().notEmpty(),
  body('milestoneIndex').isInt({ min: 0 }),
], asyncHandler(async (req, res) => {
  const jobId = parseInt(req.params.jobId);
  const { client, milestoneIndex } = req.body;
  
  const result = await jobMarketplaceService.releaseMilestone(jobId, client, milestoneIndex);
  
  res.json({
    success: true,
    data: result,
  });
}));

/**
 * POST /api/job-marketplace/jobs/:jobId/cancel
 * Cancel an open job
 */
router.post('/jobs/:jobId/cancel', [
  param('jobId').isInt({ min: 1 }),
  body('client').isString().notEmpty(),
], asyncHandler(async (req, res) => {
  const jobId = parseInt(req.params.jobId);
  const { client } = req.body;
  
  const result = await jobMarketplaceService.cancelJob(jobId, client);
  
  res.json({
    success: true,
    data: result,
  });
}));

// ── Skill Verification Routes ─────────────────────────────────────────────────

/**
 * GET /api/job-marketplace/skills/:user
 * Get user's verified skills
 */
router.get('/skills/:user', asyncHandler(async (req, res) => {
  const user = req.params.user;
  const skills = await jobMarketplaceService.getUserSkills(user);
  
  res.json({
    success: true,
    data: skills,
  });
}));

/**
 * POST /api/job-marketplace/skills/verify
 * Verify a skill for a user (admin only)
 */
router.post('/skills/verify', [
  body('admin').isString().notEmpty(),
  body('user').isString().notEmpty(),
  body('skill').isString().notEmpty(),
  body('level').isInt({ min: 1, max: 5 }),
], asyncHandler(async (req, res) => {
  const { admin, user, skill, level } = req.body;
  
  const result = await jobMarketplaceService.verifySkill(admin, user, skill, level);
  
  res.json({
    success: true,
    data: result,
  });
}));

// ── Certification Routes ──────────────────────────────────────────────────────

/**
 * GET /api/job-marketplace/certifications/:user
 * Get user's certifications
 */
router.get('/certifications/:user', asyncHandler(async (req, res) => {
  const user = req.params.user;
  const certifications = await jobMarketplaceService.getUserCertifications(user);
  
  res.json({
    success: true,
    data: certifications,
  });
}));

/**
 * POST /api/job-marketplace/certifications/issue
 * Issue a certification (admin only)
 */
router.post('/certifications/issue', [
  body('admin').isString().notEmpty(),
  body('user').isString().notEmpty(),
  body('certificationName').isString().notEmpty(),
  body('issuer').isString().notEmpty(),
  body('validUntil').isInt({ min: 1 }),
], asyncHandler(async (req, res) => {
  const { admin, user, certificationName, issuer, validUntil } = req.body;
  
  const result = await jobMarketplaceService.issueCertification(
    admin, user, certificationName, issuer, validUntil
  );
  
  res.json({
    success: true,
    data: result,
  });
}));

// ── Dispute Resolution Routes ─────────────────────────────────────────────────

/**
 * GET /api/job-marketplace/disputes/:disputeId
 * Get dispute details
 */
router.get('/disputes/:disputeId', [
  param('disputeId').isInt({ min: 1 }),
], asyncHandler(async (req, res) => {
  const disputeId = parseInt(req.params.disputeId);
  const dispute = await jobMarketplaceService.getDispute(disputeId);
  
  res.json({
    success: true,
    data: dispute,
  });
}));

/**
 * POST /api/job-marketplace/disputes/raise
 * Raise a dispute on a job
 */
router.post('/disputes/raise', [
  body('caller').isString().notEmpty(),
  body('jobId').isInt({ min: 1 }),
  body('reason').isString().notEmpty().isLength({ max: 1000 }),
], asyncHandler(async (req, res) => {
  const { caller, jobId, reason } = req.body;
  
  const result = await jobMarketplaceService.raiseDispute(caller, jobId, reason);
  
  res.status(201).json({
    success: true,
    data: result,
  });
}));

/**
 * POST /api/job-marketplace/disputes/:disputeId/resolve
 * Resolve a dispute (admin only)
 */
router.post('/disputes/:disputeId/resolve', [
  param('disputeId').isInt({ min: 1 }),
  body('admin').isString().notEmpty(),
  body('refundClient').isString().notEmpty(),
  body('releaseToFreelancer').isString().notEmpty(),
], asyncHandler(async (req, res) => {
  const disputeId = parseInt(req.params.disputeId);
  const { admin, refundClient, releaseToFreelancer } = req.body;
  
  const result = await jobMarketplaceService.resolveDispute(
    disputeId, admin, refundClient, releaseToFreelancer
  );
  
  res.json({
    success: true,
    data: result,
  });
}));

// ── Admin Routes ──────────────────────────────────────────────────────────────

/**
 * POST /api/job-marketplace/admin/pause
 * Pause the contract (emergency stop)
 */
router.post('/admin/pause', [
  body('admin').isString().notEmpty(),
], asyncHandler(async (req, res) => {
  const { admin } = req.body;
  
  const result = await jobMarketplaceService.pauseContract(admin);
  
  res.json({
    success: true,
    data: result,
  });
}));

/**
 * POST /api/job-marketplace/admin/unpause
 * Unpause the contract
 */
router.post('/admin/unpause', [
  body('admin').isString().notEmpty(),
], asyncHandler(async (req, res) => {
  const { admin } = req.body;
  
  const result = await jobMarketplaceService.unpauseContract(admin);
  
  res.json({
    success: true,
    data: result,
  });
}));

/**
 * GET /api/job-marketplace/admin/status
 * Get contract status
 */
router.get('/admin/status', asyncHandler(async (req, res) => {
  const status = await jobMarketplaceService.getContractStatus();
  
  res.json({
    success: true,
    data: status,
  });
}));

// ── Analytics Routes ──────────────────────────────────────────────────────────

/**
 * GET /api/job-marketplace/analytics/overview
 * Get marketplace analytics overview
 */
router.get('/analytics/overview', asyncHandler(async (req, res) => {
  const analytics = await jobMarketplaceService.getAnalyticsOverview();
  
  res.json({
    success: true,
    data: analytics,
  });
}));

/**
 * GET /api/job-marketplace/analytics/user/:address
 * Get user activity analytics
 */
router.get('/analytics/user/:address', asyncHandler(async (req, res) => {
  const address = req.params.address;
  const analytics = await jobMarketplaceService.getUserAnalytics(address);
  
  res.json({
    success: true,
    data: analytics,
  });
}));

export default router;
