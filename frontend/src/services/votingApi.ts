import { Proposal, ProposalListResponse, VotingStats, ApiResponse } from '@/types/voting';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

class VotingApi {
  private baseUrl: string;

  constructor() {
    this.baseUrl = `${API_BASE_URL}/api/voting`;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const config: RequestInit = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    try {
      const response = await fetch(url, config);
      const data: ApiResponse<T> = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }

      return data.data as T;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('An unexpected error occurred');
    }
  }

  // Create a new proposal
  async createProposal(
    title: string,
    description: string,
    duration: number,
    creator: string
  ): Promise<Proposal> {
    return this.request<Proposal>('/proposals', {
      method: 'POST',
      body: JSON.stringify({ title, description, duration, creator }),
    });
  }

  // Get proposals with pagination
  async getProposals(
    page: number = 1,
    limit: number = 20,
    status: 'active' | 'ended' | 'all' = 'all'
  ): Promise<ProposalListResponse> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      status,
    });

    return this.request<ProposalListResponse>(`/proposals?${params}`);
  }

  // Get single proposal
  async getProposal(proposalId: number): Promise<Proposal> {
    return this.request<Proposal>(`/proposals/${proposalId}`);
  }

  // Commit vote (privacy phase)
  async commitVote(
    proposalId: number,
    voter: string,
    commitmentHash: string
  ): Promise<{ proposalId: number; voter: string; committed: boolean; timestamp: number }> {
    return this.request(`/proposals/${proposalId}/commit`, {
      method: 'POST',
      body: JSON.stringify({ voter, commitmentHash }),
    });
  }

  // Reveal vote
  async revealVote(
    proposalId: number,
    voter: string,
    credits: number,
    isFor: boolean,
    salt: string
  ): Promise<{ proposalId: number; voter: string; votes: number; credits: number; isFor: boolean; revealedAt: number }> {
    return this.request(`/proposals/${proposalId}/reveal`, {
      method: 'POST',
      body: JSON.stringify({ voter, credits, isFor, salt }),
    });
  }

  // Finalize proposal
  async finalizeProposal(proposalId: number): Promise<{
    proposalId: number;
    passed: boolean;
    votesFor: number;
    votesAgainst: number;
    finalizedAt: number;
  }> {
    return this.request(`/proposals/${proposalId}/finalize`, {
      method: 'POST',
    });
  }

  // Get user votes
  async getUserVotes(address: string, proposalId?: number): Promise<any[]> {
    const params = proposalId ? `?proposalId=${proposalId}` : '';
    return this.request(`/users/${address}/votes${params}`);
  }

  // Whitelist user
  async whitelistUser(
    admin: string,
    user: string,
    initialCredits: number
  ): Promise<{ user: string; initialCredits: number; whitelisted: boolean }> {
    return this.request('/whitelist', {
      method: 'POST',
      body: JSON.stringify({ admin, user, initialCredits }),
    });
  }

  // Get voting statistics
  async getVotingStats(): Promise<VotingStats> {
    return this.request<VotingStats>('/stats');
  }

  // Health check
  async healthCheck(): Promise<{ success: boolean; status: string; timestamp: number }> {
    return this.request('/health');
  }
}

export const votingApi = new VotingApi();
