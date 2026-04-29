import { createHash } from 'crypto';
import logger from '../utils/logger.js';
import cacheService from './cacheService.js';
import { getDatabase } from '../database/connection.js';

class VotingService {
  constructor() {
    this.CACHE_TTL = 300; // 5 minutes
    this.CACHE_PREFIX = 'voting:';
  }

  // Create a new proposal
  async createProposal({ title, description, duration, creator }) {
    try {
      const db = getDatabase();
      const descriptionHash = this.hashDescription(description);
      const timestamp = Math.floor(Date.now() / 1000);
      
      const result = await db.run(
        `INSERT INTO proposals (title, description, description_hash, duration, creator, created_at, end_time, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [title, description, descriptionHash, duration, creator, timestamp, timestamp + duration, 'active']
      );

      await cacheService.del(`${this.CACHE_PREFIX}proposals:all`);
      
      logger.info('Proposal created', { proposalId: result.lastID, creator });
      
      return {
        id: result.lastID,
        title,
        descriptionHash,
        duration,
        creator,
        endTime: timestamp + duration,
        status: 'active',
      };
    } catch (error) {
      logger.error('Error creating proposal', { error: error.message });
      throw new Error('Failed to create proposal');
    }
  }

  // Get proposals with pagination and filtering
  async getProposals({ page = 1, limit = 20, status = 'all' }) {
    try {
      const db = getDatabase();
      const cacheKey = `${this.CACHE_PREFIX}proposals:${status}:${page}:${limit}`;
      const cached = await cacheService.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      const offset = (page - 1) * limit;
      const currentTime = Math.floor(Date.now() / 1000);
      
      let query = 'SELECT * FROM proposals';
      let countQuery = 'SELECT COUNT(*) as count FROM proposals';
      const params = [];
      
      if (status === 'active') {
        query += ' WHERE end_time > ? AND status = ?';
        countQuery += ' WHERE end_time > ? AND status = ?';
        params.push(currentTime, 'active');
      } else if (status === 'ended') {
        query += ' WHERE end_time <= ? OR status = ?';
        countQuery += ' WHERE end_time <= ? OR status = ?';
        params.push(currentTime, 'finalized');
      }
      
      query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);
      
      const [proposals, countResult] = await Promise.all([
        db.all(query, params),
        db.get(countQuery, params.slice(0, -2)),
      ]);

      const result = {
        proposals,
        pagination: {
          page,
          limit,
          total: countResult.count,
          totalPages: Math.ceil(countResult.count / limit),
        },
      };

      await cacheService.set(cacheKey, JSON.stringify(result), this.CACHE_TTL);
      
      return result;
    } catch (error) {
      logger.error('Error fetching proposals', { error: error.message });
      throw new Error('Failed to fetch proposals');
    }
  }

  // Get single proposal
  async getProposal(proposalId) {
    try {
      const db = getDatabase();
      const cacheKey = `${this.CACHE_PREFIX}proposal:${proposalId}`;
      const cached = await cacheService.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      const proposal = await db.get('SELECT * FROM proposals WHERE id = ?', [proposalId]);

      if (!proposal) {
        return null;
      }

      await cacheService.set(cacheKey, JSON.stringify(proposal), this.CACHE_TTL);
      
      return proposal;
    } catch (error) {
      logger.error('Error fetching proposal', { proposalId, error: error.message });
      throw new Error('Failed to fetch proposal');
    }
  }

  // Commit vote (privacy-preserving phase)
  async commitVote({ proposalId, voter, commitmentHash }) {
    try {
      const db = getDatabase();
      const proposal = await this.getProposal(proposalId);
      
      if (!proposal) {
        throw new Error('Proposal not found');
      }

      const currentTime = Math.floor(Date.now() / 1000);
      if (currentTime >= proposal.end_time) {
        throw new Error('Voting period has ended');
      }

      await db.run(
        `INSERT OR REPLACE INTO vote_commitments (proposal_id, voter, commitment_hash, timestamp)
         VALUES (?, ?, ?, ?)`,
        [proposalId, voter, commitmentHash, currentTime]
      );

      logger.info('Vote committed', { proposalId, voter });
      
      return {
        proposalId,
        voter,
        committed: true,
        timestamp: currentTime,
      };
    } catch (error) {
      logger.error('Error committing vote', { proposalId, voter, error: error.message });
      throw error;
    }
  }

  // Reveal vote
  async revealVote({ proposalId, voter, credits, isFor, salt }) {
    try {
      const db = getDatabase();
      const proposal = await this.getProposal(proposalId);
      
      if (!proposal) {
        throw new Error('Proposal not found');
      }

      const currentTime = Math.floor(Date.now() / 1000);
      if (currentTime >= proposal.end_time) {
        throw new Error('Voting period has ended');
      }

      const commitment = await db.get(
        'SELECT * FROM vote_commitments WHERE proposal_id = ? AND voter = ?',
        [proposalId, voter]
      );

      if (!commitment) {
        throw new Error('No commitment found for this voter');
      }

      const existing = await db.get(
        'SELECT * FROM votes WHERE proposal_id = ? AND voter = ?',
        [proposalId, voter]
      );

      if (existing) {
        throw new Error('Vote already revealed');
      }

      const votes = Math.floor(Math.sqrt(credits));

      await db.run(
        `INSERT INTO votes (proposal_id, voter, credits, votes, is_for, revealed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [proposalId, voter, credits, votes, isFor ? 1 : 0, currentTime]
      );

      const voteField = isFor ? 'votes_for' : 'votes_against';
      await db.run(
        `UPDATE proposals SET ${voteField} = ${voteField} + ?, total_participants = total_participants + 1
         WHERE id = ?`,
        [votes, proposalId]
      );

      await cacheService.del(`${this.CACHE_PREFIX}proposal:${proposalId}`);
      
      logger.info('Vote revealed', { proposalId, voter, votes, isFor });
      
      return {
        proposalId,
        voter,
        votes,
        credits,
        isFor,
        revealedAt: currentTime,
      };
    } catch (error) {
      logger.error('Error revealing vote', { proposalId, voter, error: error.message });
      throw error;
    }
  }

  // Finalize proposal
  async finalizeProposal(proposalId) {
    try {
      const db = getDatabase();
      const proposal = await this.getProposal(proposalId);
      
      if (!proposal) {
        throw new Error('Proposal not found');
      }

      const currentTime = Math.floor(Date.now() / 1000);
      if (currentTime < proposal.end_time) {
        throw new Error('Voting period has not ended yet');
      }

      const passed = proposal.votes_for > proposal.votes_against;

      await db.run(
        'UPDATE proposals SET status = ?, finalized_at = ? WHERE id = ?',
        ['finalized', currentTime, proposalId]
      );

      await cacheService.del(`${this.CACHE_PREFIX}proposal:${proposalId}`);
      await cacheService.del(`${this.CACHE_PREFIX}proposals:all`);
      
      logger.info('Proposal finalized', { proposalId, passed });
      
      return {
        proposalId,
        passed,
        votesFor: proposal.votes_for,
        votesAgainst: proposal.votes_against,
        finalizedAt: currentTime,
      };
    } catch (error) {
      logger.error('Error finalizing proposal', { proposalId, error: error.message });
      throw error;
    }
  }

  // Get user votes
  async getUserVotes(address, proposalId = null) {
    try {
      const db = getDatabase();
      let query = 'SELECT * FROM votes WHERE voter = ?';
      const params = [address];
      
      if (proposalId) {
        query += ' AND proposal_id = ?';
        params.push(proposalId);
      }
      
      query += ' ORDER BY revealed_at DESC';
      
      const votes = await db.all(query, params);
      
      return votes;
    } catch (error) {
      logger.error('Error fetching user votes', { address, error: error.message });
      throw new Error('Failed to fetch user votes');
    }
  }

  // Whitelist user
  async whitelistUser({ admin, user, initialCredits }) {
    try {
      const db = getDatabase();
      await db.run(
        `INSERT OR REPLACE INTO whitelisted_users (address, initial_credits, whitelisted_by, whitelisted_at)
         VALUES (?, ?, ?, ?)`,
        [user, initialCredits, admin, Math.floor(Date.now() / 1000)]
      );

      logger.info('User whitelisted', { user, admin, initialCredits });
      
      return {
        user,
        initialCredits,
        whitelisted: true,
      };
    } catch (error) {
      logger.error('Error whitelisting user', { user, error: error.message });
      throw new Error('Failed to whitelist user');
    }
  }

  // Get voting statistics
  async getVotingStats() {
    try {
      const db = getDatabase();
      const cacheKey = `${this.CACHE_PREFIX}stats`;
      const cached = await cacheService.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      const [totalProposals, activeProposals, totalVotes, uniqueVoters] = await Promise.all([
        db.get('SELECT COUNT(*) as count FROM proposals'),
        db.get('SELECT COUNT(*) as count FROM proposals WHERE status = ? AND end_time > ?', 
          ['active', Math.floor(Date.now() / 1000)]),
        db.get('SELECT COUNT(*) as count FROM votes'),
        db.get('SELECT COUNT(DISTINCT voter) as count FROM votes'),
      ]);

      const stats = {
        totalProposals: totalProposals.count,
        activeProposals: activeProposals.count,
        totalVotes: totalVotes.count,
        uniqueVoters: uniqueVoters.count,
      };

      await cacheService.set(cacheKey, JSON.stringify(stats), this.CACHE_TTL);
      
      return stats;
    } catch (error) {
      logger.error('Error fetching voting stats', { error: error.message });
      throw new Error('Failed to fetch voting statistics');
    }
  }

  // Helper: Hash description
  hashDescription(description) {
    return createHash('sha256').update(description).digest('hex');
  }
}

export default new VotingService();
