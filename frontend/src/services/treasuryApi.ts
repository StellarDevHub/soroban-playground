const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

interface TreasuryInfo {
  total_balance: string;
  total_proposals: number;
  executed_proposals: number;
  pending_proposals: number;
}

interface Proposal {
  id: number;
  proposer: string;
  recipient: string;
  amount: string;
  token: string;
  description: string;
  signatures: string[];
  executed: boolean;
  created_at: number;
  expires_at: number;
}

class TreasuryApi {
  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async getTreasuryInfo(): Promise<TreasuryInfo> {
    return this.request<TreasuryInfo>('/treasury/info');
  }

  async getProposals(): Promise<Proposal[]> {
    return this.request<Proposal[]>('/treasury/proposals');
  }

  async createProposal(
    recipient: string,
    amount: string,
    description: string,
    duration: number
  ): Promise<void> {
    await this.request('/treasury/proposals', {
      method: 'POST',
      body: JSON.stringify({ recipient, amount, description, duration }),
    });
  }

  async signProposal(proposalId: number): Promise<void> {
    await this.request(`/treasury/proposals/${proposalId}/sign`, {
      method: 'POST',
    });
  }

  async executeProposal(proposalId: number): Promise<void> {
    await this.request(`/treasury/proposals/${proposalId}/execute`, {
      method: 'POST',
    });
  }

  async getSigners(): Promise<string[]> {
    return this.request<string[]>('/treasury/signers');
  }

  async getThreshold(): Promise<number> {
    return this.request<number>('/treasury/threshold');
  }

  async addSigner(signer: string): Promise<void> {
    await this.request('/treasury/signers', {
      method: 'POST',
      body: JSON.stringify({ signer }),
    });
  }

  async removeSigner(signer: string): Promise<void> {
    await this.request(`/treasury/signers/${signer}`, {
      method: 'DELETE',
    });
  }

  async updateThreshold(threshold: number): Promise<void> {
    await this.request('/treasury/threshold', {
      method: 'PUT',
      body: JSON.stringify({ threshold }),
    });
  }

  async deposit(token: string, amount: string): Promise<void> {
    await this.request('/treasury/deposit', {
      method: 'POST',
      body: JSON.stringify({ token, amount }),
    });
  }
}

export const treasuryApi = new TreasuryApi();
