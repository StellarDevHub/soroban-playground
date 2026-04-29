// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Job Marketplace Service
 * 
 * Business logic layer for interacting with the Job Marketplace smart contract
 */

import { SorobanRpc } from '@stellar/stellar-sdk';
import { getContractInstance, executeContractMethod, parseContractEvent } from '../utils/contractHelper.js';
import { getDbConnection } from '../database/connection.js';
import cacheService from './cacheService.js';
import logger from '../utils/logger.js';

const JOB_MARKETPLACE_CONTRACT_ID = process.env.JOB_MARKETPLACE_CONTRACT_ID;

class JobMarketplaceService {
  constructor() {
    this.contractId = JOB_MARKETPLACE_CONTRACT_ID;
  }

  // ── Job Management ───────────────────────────────────────────────────────────

  /**
   * Get all jobs with filtering and pagination
   */
  async getJobs(filters = {}) {
    const cacheKey = `jobs:${JSON.stringify(filters)}`;
    const cached = await cacheService.get(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      const db = await getDbConnection();
      const { page = 1, limit = 20, status, client, freelancer } = filters;
      const offset = (page - 1) * limit;

      let query = 'SELECT * FROM jobs WHERE 1=1';
      const params = [];

      if (status) {
        query += ' AND status = $' + (params.length + 1);
        params.push(status);
      }

      if (client) {
        query += ' AND client = $' + (params.length + 1);
        params.push(client);
      }

      if (freelancer) {
        query += ' AND freelancer = $' + (params.length + 1);
        params.push(freelancer);
      }

      query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
      params.push(limit, offset);

      const jobs = await db.query(query, params);

      // Get total count for pagination
      let countQuery = 'SELECT COUNT(*) FROM jobs WHERE 1=1';
      const countParams = [];

      if (status) {
        countQuery += ' AND status = $' + (countParams.length + 1);
        countParams.push(status);
      }

      if (client) {
        countQuery += ' AND client = $' + (countParams.length + 1);
        countParams.push(client);
      }

      if (freelancer) {
        countQuery += ' AND freelancer = $' + (countParams.length + 1);
        countParams.push(freelancer);
      }

      const countResult = await db.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].count);

      const result = {
        jobs: jobs.rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };

      // Cache for 2 minutes
      await cacheService.set(cacheKey, result, 120);

      return result;
    } catch (error) {
      logger.error('Error fetching jobs:', error);
      throw new Error('Failed to fetch jobs');
    }
  }

  /**
   * Get job details by ID
   */
  async getJob(jobId) {
    const cacheKey = `job:${jobId}`;
    const cached = await cacheService.get(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      const db = await getDbConnection();
      const result = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);

      if (result.rows.length === 0) {
        throw new Error('Job not found');
      }

      const job = result.rows[0];

      // Fetch milestones
      const milestonesResult = await db.query(
        'SELECT * FROM job_milestones WHERE job_id = $1 ORDER BY id',
        [jobId]
      );
      job.milestones = milestonesResult.rows;

      // Cache for 5 minutes
      await cacheService.set(cacheKey, job, 300);

      return job;
    } catch (error) {
      logger.error(`Error fetching job ${jobId}:`, error);
      throw new Error('Failed to fetch job');
    }
  }

  /**
   * Create a new job with escrow
   */
  async createJob(jobData) {
    try {
      const {
        client,
        title,
        description,
        paymentToken,
        totalEscrow,
        milestones,
        requiredSkills = [],
      } = jobData;

      // Call smart contract
      const contractResult = await executeContractMethod(
        this.contractId,
        'create_job',
        [client, title, description, paymentToken, totalEscrow, milestones, requiredSkills]
      );

      const jobId = contractResult.result;

      // Store in database
      const db = await getDbConnection();
      await db.query('BEGIN');

      try {
        // Insert job
        const jobResult = await db.query(
          `INSERT INTO jobs (id, client, title, description, payment_token, total_escrow, status, required_skills, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'Open', $7, NOW())
           RETURNING *`,
          [jobId, client, title, description, paymentToken, totalEscrow, JSON.stringify(requiredSkills)]
        );

        const job = jobResult.rows[0];

        // Insert milestones
        const milestoneInserts = milestones.map((m, index) => ({
          job_id: jobId,
          description: m.description,
          amount: m.amount,
          is_released: false,
          milestone_index: index,
        }));

        if (milestoneInserts.length > 0) {
          const values = milestoneInserts
            .map((_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`)
            .join(', ');

          const flatValues = milestoneInserts.flatMap(m => [
            m.job_id,
            m.description,
            m.amount,
            m.is_released,
            m.milestone_index,
          ]);

          await db.query(
            `INSERT INTO job_milestones (job_id, description, amount, is_released, milestone_index)
             VALUES ${values}`,
            flatValues
          );
        }

        await db.query('COMMIT');

        // Clear cache
        await cacheService.deletePattern('jobs:*');

        logger.info(`Job ${jobId} created by ${client}`);

        return job;
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      logger.error('Error creating job:', error);
      throw new Error('Failed to create job');
    }
  }

  /**
   * Accept a job as freelancer
   */
  async acceptJob(jobId, freelancer) {
    try {
      // Call smart contract
      await executeContractMethod(
        this.contractId,
        'accept_job',
        [freelancer, jobId]
      );

      // Update database
      const db = await getDbConnection();
      await db.query(
        `UPDATE jobs 
         SET freelancer = $1, status = 'InProgress', accepted_at = NOW()
         WHERE id = $2`,
        [freelancer, jobId]
      );

      // Clear cache
      await cacheService.delete(`job:${jobId}`);
      await cacheService.deletePattern('jobs:*');

      logger.info(`Job ${jobId} accepted by ${freelancer}`);

      return { jobId, freelancer, status: 'InProgress' };
    } catch (error) {
      logger.error(`Error accepting job ${jobId}:`, error);
      throw new Error('Failed to accept job');
    }
  }

  /**
   * Release milestone payment
   */
  async releaseMilestone(jobId, client, milestoneIndex) {
    try {
      // Call smart contract
      await executeContractMethod(
        this.contractId,
        'release_milestone',
        [client, jobId, milestoneIndex]
      );

      // Update database
      const db = await getDbConnection();
      await db.query(
        `UPDATE job_milestones 
         SET is_released = true 
         WHERE job_id = $1 AND milestone_index = $2`,
        [jobId, milestoneIndex]
      );

      // Check if all milestones are released
      const milestoneResult = await db.query(
        `SELECT COUNT(*) as total, 
                SUM(CASE WHEN is_released THEN 1 ELSE 0 END) as released
         FROM job_milestones 
         WHERE job_id = $1`,
        [jobId]
      );

      const { total, released } = milestoneResult.rows[0];
      let status = 'InProgress';

      if (parseInt(released) === parseInt(total)) {
        status = 'Completed';
        await db.query(
          `UPDATE jobs SET status = 'Completed', completed_at = NOW() WHERE id = $1`,
          [jobId]
        );
      }

      // Update released amount
      const amountResult = await db.query(
        `SELECT SUM(amount) as released_amount 
         FROM job_milestones 
         WHERE job_id = $1 AND is_released = true`,
        [jobId]
      );

      await db.query(
        `UPDATE jobs SET released_amount = $1 WHERE id = $2`,
        [amountResult.rows[0].released_amount, jobId]
      );

      // Clear cache
      await cacheService.delete(`job:${jobId}`);
      await cacheService.deletePattern('jobs:*');

      logger.info(`Milestone ${milestoneIndex} released for job ${jobId}`);

      return { jobId, milestoneIndex, status };
    } catch (error) {
      logger.error(`Error releasing milestone for job ${jobId}:`, error);
      throw new Error('Failed to release milestone');
    }
  }

  /**
   * Cancel an open job
   */
  async cancelJob(jobId, client) {
    try {
      // Call smart contract
      await executeContractMethod(
        this.contractId,
        'cancel_job',
        [client, jobId]
      );

      // Update database
      const db = await getDbConnection();
      await db.query(
        `UPDATE jobs SET status = 'Cancelled' WHERE id = $1 AND client = $2`,
        [jobId, client]
      );

      // Clear cache
      await cacheService.delete(`job:${jobId}`);
      await cacheService.deletePattern('jobs:*');

      logger.info(`Job ${jobId} cancelled by ${client}`);

      return { jobId, status: 'Cancelled' };
    } catch (error) {
      logger.error(`Error cancelling job ${jobId}:`, error);
      throw new Error('Failed to cancel job');
    }
  }

  // ── Skill Verification ───────────────────────────────────────────────────────

  /**
   * Get user's verified skills
   */
  async getUserSkills(user) {
    const cacheKey = `skills:${user}`;
    const cached = await cacheService.get(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      const db = await getDbConnection();
      const result = await db.query(
        'SELECT * FROM user_skills WHERE user_address = $1 ORDER BY level DESC',
        [user]
      );

      const skills = result.rows;

      // Cache for 10 minutes
      await cacheService.set(cacheKey, skills, 600);

      return skills;
    } catch (error) {
      logger.error(`Error fetching skills for ${user}:`, error);
      throw new Error('Failed to fetch skills');
    }
  }

  /**
   * Verify a skill for a user (admin only)
   */
  async verifySkill(admin, user, skill, level) {
    try {
      // Call smart contract
      await executeContractMethod(
        this.contractId,
        'verify_skill',
        [admin, user, skill, level]
      );

      // Store in database
      const db = await getDbConnection();
      await db.query(
        `INSERT INTO user_skills (user_address, skill, level, verified_at, verified_by)
         VALUES ($1, $2, $3, NOW(), $4)
         ON CONFLICT (user_address, skill) 
         DO UPDATE SET level = $3, verified_at = NOW(), verified_by = $4`,
        [user, skill, level, admin]
      );

      // Clear cache
      await cacheService.delete(`skills:${user}`);

      logger.info(`Skill ${skill} verified for ${user} at level ${level}`);

      return { user, skill, level };
    } catch (error) {
      logger.error('Error verifying skill:', error);
      throw new Error('Failed to verify skill');
    }
  }

  // ── Certification ────────────────────────────────────────────────────────────

  /**
   * Get user's certifications
   */
  async getUserCertifications(user) {
    const cacheKey = `certifications:${user}`;
    const cached = await cacheService.get(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      const db = await getDbConnection();
      const result = await db.query(
        'SELECT * FROM user_certifications WHERE user_address = $1 ORDER BY issued_at DESC',
        [user]
      );

      const certifications = result.rows;

      // Cache for 10 minutes
      await cacheService.set(cacheKey, certifications, 600);

      return certifications;
    } catch (error) {
      logger.error(`Error fetching certifications for ${user}:`, error);
      throw new Error('Failed to fetch certifications');
    }
  }

  /**
   * Issue a certification (admin only)
   */
  async issueCertification(admin, user, certificationName, issuer, validUntil) {
    try {
      // Call smart contract
      await executeContractMethod(
        this.contractId,
        'issue_certification',
        [admin, user, certificationName, issuer, validUntil]
      );

      // Store in database
      const db = await getDbConnection();
      await db.query(
        `INSERT INTO user_certifications (user_address, name, issuer, issued_at, valid_until)
         VALUES ($1, $2, $3, NOW(), to_timestamp($4))`,
        [user, certificationName, issuer, validUntil]
      );

      // Clear cache
      await cacheService.delete(`certifications:${user}`);

      logger.info(`Certification ${certificationName} issued to ${user}`);

      return { user, certificationName, issuer, validUntil };
    } catch (error) {
      logger.error('Error issuing certification:', error);
      throw new Error('Failed to issue certification');
    }
  }

  // ── Dispute Resolution ───────────────────────────────────────────────────────

  /**
   * Get dispute details
   */
  async getDispute(disputeId) {
    const cacheKey = `dispute:${disputeId}`;
    const cached = await cacheService.get(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      const db = await getDbConnection();
      const result = await db.query(
        'SELECT * FROM disputes WHERE id = $1',
        [disputeId]
      );

      if (result.rows.length === 0) {
        throw new Error('Dispute not found');
      }

      const dispute = result.rows[0];

      // Cache for 5 minutes
      await cacheService.set(cacheKey, dispute, 300);

      return dispute;
    } catch (error) {
      logger.error(`Error fetching dispute ${disputeId}:`, error);
      throw new Error('Failed to fetch dispute');
    }
  }

  /**
   * Raise a dispute on a job
   */
  async raiseDispute(caller, jobId, reason) {
    try {
      // Call smart contract
      const contractResult = await executeContractMethod(
        this.contractId,
        'raise_dispute',
        [caller, jobId, reason]
      );

      const disputeId = contractResult.result;

      // Store in database
      const db = await getDbConnection();
      await db.query(
        `INSERT INTO disputes (id, job_id, raised_by, reason, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [disputeId, jobId, caller, reason]
      );

      // Update job status
      await db.query(
        `UPDATE jobs SET status = 'Disputed' WHERE id = $1`,
        [jobId]
      );

      // Clear cache
      await cacheService.delete(`job:${jobId}`);
      await cacheService.deletePattern('jobs:*');

      logger.info(`Dispute ${disputeId} raised for job ${jobId} by ${caller}`);

      return { disputeId, jobId, status: 'Disputed' };
    } catch (error) {
      logger.error('Error raising dispute:', error);
      throw new Error('Failed to raise dispute');
    }
  }

  /**
   * Resolve a dispute (admin only)
   */
  async resolveDispute(disputeId, admin, refundClient, releaseToFreelancer) {
    try {
      // Call smart contract
      await executeContractMethod(
        this.contractId,
        'resolve_dispute',
        [admin, disputeId, refundClient, releaseToFreelancer]
      );

      // Update database
      const db = await getDbConnection();
      await db.query('BEGIN');

      try {
        // Get dispute info
        const disputeResult = await db.query(
          'SELECT job_id FROM disputes WHERE id = $1',
          [disputeId]
        );
        const jobId = disputeResult.rows[0].job_id;

        // Update dispute
        await db.query(
          `UPDATE disputes 
           SET resolved_at = NOW(), resolved_by = $1, resolution = 'Resolved by admin'
           WHERE id = $2`,
          [admin, disputeId]
        );

        // Update job status
        const jobStatus = BigInt(releaseToFreelancer) > BigInt(0) ? 'Completed' : 'Cancelled';
        await db.query(
          `UPDATE jobs SET status = $1, completed_at = NOW() WHERE id = $2`,
          [jobStatus, jobId]
        );

        await db.query('COMMIT');

        // Clear cache
        await cacheService.delete(`dispute:${disputeId}`);
        await cacheService.delete(`job:${jobId}`);

        logger.info(`Dispute ${disputeId} resolved by ${admin}`);

        return { disputeId, jobId, status: jobStatus };
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      logger.error('Error resolving dispute:', error);
      throw new Error('Failed to resolve dispute');
    }
  }

  // ── Admin Functions ──────────────────────────────────────────────────────────

  /**
   * Pause the contract
   */
  async pauseContract(admin) {
    try {
      await executeContractMethod(
        this.contractId,
        'pause',
        [admin]
      );

      logger.info(`Contract paused by ${admin}`);

      return { status: 'Paused' };
    } catch (error) {
      logger.error('Error pausing contract:', error);
      throw new Error('Failed to pause contract');
    }
  }

  /**
   * Unpause the contract
   */
  async unpauseContract(admin) {
    try {
      await executeContractMethod(
        this.contractId,
        'unpause',
        [admin]
      );

      logger.info(`Contract unpaused by ${admin}`);

      return { status: 'Active' };
    } catch (error) {
      logger.error('Error unpausing contract:', error);
      throw new Error('Failed to unpause contract');
    }
  }

  /**
   * Get contract status
   */
  async getContractStatus() {
    try {
      const db = await getDbConnection();
      
      const jobStats = await db.query(`
        SELECT 
          COUNT(*) as total_jobs,
          COUNT(CASE WHEN status = 'Open' THEN 1 END) as open_jobs,
          COUNT(CASE WHEN status = 'InProgress' THEN 1 END) as in_progress_jobs,
          COUNT(CASE WHEN status = 'Completed' THEN 1 END) as completed_jobs,
          COUNT(CASE WHEN status = 'Disputed' THEN 1 END) as disputed_jobs,
          COUNT(CASE WHEN status = 'Cancelled' THEN 1 END) as cancelled_jobs
        FROM jobs
      `);

      const disputeStats = await db.query(`
        SELECT 
          COUNT(*) as total_disputes,
          COUNT(CASE WHEN resolved_at IS NULL THEN 1 END) as open_disputes,
          COUNT(CASE WHEN resolved_at IS NOT NULL THEN 1 END) as resolved_disputes
        FROM disputes
      `);

      return {
        contractId: this.contractId,
        jobs: jobStats.rows[0],
        disputes: disputeStats.rows[0],
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Error fetching contract status:', error);
      throw new Error('Failed to fetch contract status');
    }
  }

  // ── Analytics ────────────────────────────────────────────────────────────────

  /**
   * Get marketplace analytics overview
   */
  async getAnalyticsOverview() {
    try {
      const db = await getDbConnection();

      // Job analytics
      const jobAnalytics = await db.query(`
        SELECT 
          DATE_TRUNC('day', created_at) as date,
          COUNT(*) as jobs_created,
          SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as jobs_completed
        FROM jobs
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY date
      `);

      // Volume analytics
      const volumeAnalytics = await db.query(`
        SELECT 
          DATE_TRUNC('day', created_at) as date,
          SUM(total_escrow) as total_volume,
          SUM(released_amount) as released_volume
        FROM jobs
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY date
      `);

      // Top skills
      const topSkills = await db.query(`
        SELECT skill, COUNT(*) as count
        FROM user_skills
        GROUP BY skill
        ORDER BY count DESC
        LIMIT 10
      `);

      return {
        jobs: jobAnalytics.rows,
        volume: volumeAnalytics.rows,
        topSkills: topSkills.rows,
        period: '30 days',
      };
    } catch (error) {
      logger.error('Error fetching analytics:', error);
      throw new Error('Failed to fetch analytics');
    }
  }

  /**
   * Get user activity analytics
   */
  async getUserAnalytics(address) {
    try {
      const db = await getDbConnection();

      // Jobs as client
      const clientJobs = await db.query(
        `SELECT COUNT(*) as total, 
                COUNT(CASE WHEN status = 'Completed' THEN 1 END) as completed
         FROM jobs WHERE client = $1`,
        [address]
      );

      // Jobs as freelancer
      const freelancerJobs = await db.query(
        `SELECT COUNT(*) as total, 
                COUNT(CASE WHEN status = 'Completed' THEN 1 END) as completed,
                SUM(released_amount) as total_earned
         FROM jobs WHERE freelancer = $1`,
        [address]
      );

      // Skills
      const skills = await db.query(
        'SELECT * FROM user_skills WHERE user_address = $1',
        [address]
      );

      // Certifications
      const certifications = await db.query(
        'SELECT * FROM user_certifications WHERE user_address = $1',
        [address]
      );

      // Disputes
      const disputes = await db.query(
        `SELECT COUNT(*) as total,
                COUNT(CASE WHEN resolved_at IS NOT NULL THEN 1 END) as resolved
         FROM disputes WHERE raised_by = $1`,
        [address]
      );

      return {
        address,
        clientStats: clientJobs.rows[0],
        freelancerStats: freelancerJobs.rows[0],
        skills: skills.rows,
        certifications: certifications.rows,
        disputes: disputes.rows[0],
      };
    } catch (error) {
      logger.error(`Error fetching analytics for ${address}:`, error);
      throw new Error('Failed to fetch user analytics');
    }
  }
}

export default new JobMarketplaceService();
