import { getDatabase } from '../database/connection.js';

export class TreasuryService {
  get db() {
    return getDatabase();
  }

  async getProposals() {
    return await this.db.all(
      'SELECT * FROM treasury_proposals ORDER BY created_at DESC'
    );
  }

  async getProposalById(id) {
    const proposal = await this.db.get(
      'SELECT * FROM treasury_proposals WHERE contract_tx_id = ?',
      [id]
    );
    if (proposal) {
      proposal.approvals = await this.db.all(
        'SELECT signer, timestamp FROM treasury_approvals WHERE proposal_id = ?',
        [id]
      );
    }
    return proposal;
  }

  async createProposal({
    contract_tx_id,
    proposer,
    description,
    amount,
    recipient,
    execute_after,
    expires_at,
  }) {
    const result = await this.db.run(
      `INSERT INTO treasury_proposals 
       (contract_tx_id, proposer, description, amount, recipient, status, execute_after, expires_at) 
       VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?)`,
      [
        contract_tx_id,
        proposer,
        description,
        amount,
        recipient,
        execute_after,
        expires_at,
      ]
    );
    return result;
  }

  async updateProposalStatus(contract_tx_id, status) {
    return await this.db.run(
      'UPDATE treasury_proposals SET status = ? WHERE contract_tx_id = ?',
      [status, contract_tx_id]
    );
  }

  async recordApproval(contract_tx_id, signer) {
    return await this.db.run(
      'INSERT INTO treasury_approvals (proposal_id, signer) VALUES (?, ?)',
      [contract_tx_id, signer]
    );
  }

  async getHistory() {
    return await this.db.all(
      'SELECT * FROM treasury_history ORDER BY timestamp DESC LIMIT 100'
    );
  }

  async logEvent(eventType, data) {
    return await this.db.run(
      'INSERT INTO treasury_history (event_type, data) VALUES (?, ?)',
      [eventType, JSON.stringify(data)]
    );
  }
}

export const treasuryService = new TreasuryService();
