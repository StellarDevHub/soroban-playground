import { db } from '../database/connection.js';
import { cacheService } from './cacheService.js';
import { logger } from '../utils/logger.js';

class TreasuryService {
  constructor() {
    this.initializeDatabase();
  }

  async initializeDatabase() {
    try {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS treasury_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          admin TEXT NOT NULL,
          threshold INTEGER NOT NULL,
          paused INTEGER DEFAULT 0,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS treasury_signers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          address TEXT NOT NULL UNIQUE,
          added_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS treasury_proposals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          proposer TEXT NOT NULL,
          recipient TEXT NOT NULL,
          amount TEXT NOT NULL,
          token TEXT NOT NULL,
          description TEXT NOT NULL,
          executed INTEGER DEFAULT 0,
          created_at INTEGER DEFAULT (strftime('%s', 'now')),
          expires_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS proposal_signatures (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          proposal_id INTEGER NOT NULL,
          signer TEXT NOT NULL,
          signed_at INTEGER DEFAULT (strftime('%s', 'now')),
          FOREIGN KEY (proposal_id) REFERENCES treasury_proposals(id),
          UNIQUE(proposal_id, signer)
        );

        CREATE INDEX IF NOT EXISTS idx_proposals_executed ON treasury_proposals(executed);
        CREATE INDEX IF NOT EXISTS idx_signatures_proposal ON proposal_signatures(proposal_id);
      `);
      logger.info('Treasury database initialized');
    } catch (error) {
      logger.error('Failed to initialize treasury database', { error: error.message });
    }
  }

  async getTreasuryInfo() {
    const cached = await cacheService.get('treasury:info');
    if (cached) return cached;

    const totalProposals = await db.get(
      'SELECT COUNT(*) as count FROM treasury_proposals'
    );
    const executedProposals = await db.get(
      'SELECT COUNT(*) as count FROM treasury_proposals WHERE executed = 1'
    );
    const pendingProposals = await db.get(
      'SELECT COUNT(*) as count FROM treasury_proposals WHERE executed = 0'
    );

    const info = {
      total_balance: '10000.00',
      total_proposals: totalProposals.count,
      executed_proposals: executedProposals.count,
      pending_proposals: pendingProposals.count,
    };

    await cacheService.set('treasury:info', info, 60);
    return info;
  }

  async getProposals() {
    const proposals = await db.all(
      'SELECT * FROM treasury_proposals ORDER BY created_at DESC'
    );

    const proposalsWithSignatures = await Promise.all(
      proposals.map(async (proposal) => {
        const signatures = await db.all(
          'SELECT signer FROM proposal_signatures WHERE proposal_id = ?',
          [proposal.id]
        );
        return {
          ...proposal,
          executed: Boolean(proposal.executed),
          signatures: signatures.map(s => s.signer),
        };
      })
    );

    return proposalsWithSignatures;
  }

  async createProposal(proposer, recipient, amount, description, duration) {
    const currentTime = Math.floor(Date.now() / 1000);
    const expiresAt = currentTime + duration;

    const result = await db.run(
      `INSERT INTO treasury_proposals (proposer, recipient, amount, token, description, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [proposer, recipient, amount, 'XLM', description, expiresAt]
    );

    await db.run(
      'INSERT INTO proposal_signatures (proposal_id, signer) VALUES (?, ?)',
      [result.lastID, proposer]
    );

    await cacheService.del('treasury:info');
    logger.info('Proposal created', { proposalId: result.lastID, proposer });

    return { success: true, proposal_id: result.lastID };
  }

  async signProposal(signer, proposalId) {
    const proposal = await db.get(
      'SELECT * FROM treasury_proposals WHERE id = ?',
      [proposalId]
    );

    if (!proposal) {
      throw new Error('Proposal not found');
    }

    if (proposal.executed) {
      throw new Error('Proposal already executed');
    }

    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime > proposal.expires_at) {
      throw new Error('Proposal expired');
    }

    try {
      await db.run(
        'INSERT INTO proposal_signatures (proposal_id, signer) VALUES (?, ?)',
        [proposalId, signer]
      );
    } catch (error) {
      if (error.message.includes('UNIQUE')) {
        throw new Error('Already signed');
      }
      throw error;
    }

    logger.info('Proposal signed', { proposalId, signer });
    return { success: true };
  }

  async executeProposal(executor, proposalId) {
    const proposal = await db.get(
      'SELECT * FROM treasury_proposals WHERE id = ?',
      [proposalId]
    );

    if (!proposal) {
      throw new Error('Proposal not found');
    }

    if (proposal.executed) {
      throw new Error('Proposal already executed');
    }

    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime > proposal.expires_at) {
      throw new Error('Proposal expired');
    }

    const signatures = await db.all(
      'SELECT COUNT(*) as count FROM proposal_signatures WHERE proposal_id = ?',
      [proposalId]
    );

    const threshold = await this.getThreshold();
    if (signatures[0].count < threshold) {
      throw new Error('Insufficient signatures');
    }

    await db.run(
      'UPDATE treasury_proposals SET executed = 1 WHERE id = ?',
      [proposalId]
    );

    await cacheService.del('treasury:info');
    logger.info('Proposal executed', { proposalId, executor });

    return { success: true };
  }

  async getSigners() {
    const signers = await db.all('SELECT address FROM treasury_signers');
    return signers.map(s => s.address);
  }

  async getThreshold() {
    const config = await db.get('SELECT threshold FROM treasury_config WHERE id = 1');
    return config?.threshold || 2;
  }

  async addSigner(admin, signer) {
    await db.run('INSERT INTO treasury_signers (address) VALUES (?)', [signer]);
    logger.info('Signer added', { admin, signer });
    return { success: true };
  }

  async removeSigner(admin, signer) {
    await db.run('DELETE FROM treasury_signers WHERE address = ?', [signer]);
    logger.info('Signer removed', { admin, signer });
    return { success: true };
  }

  async updateThreshold(admin, threshold) {
    await db.run('UPDATE treasury_config SET threshold = ? WHERE id = 1', [threshold]);
    logger.info('Threshold updated', { admin, threshold });
    return { success: true };
  }

  async deposit(depositor, token, amount) {
    logger.info('Deposit received', { depositor, token, amount });
    await cacheService.del('treasury:info');
    return { success: true };
  }
}

export const treasuryService = new TreasuryService();
