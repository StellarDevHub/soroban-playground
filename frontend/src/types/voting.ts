export interface Proposal {
  id: number;
  title: string;
  description: string;
  description_hash: string;
  duration: number;
  creator: string;
  created_at: number;
  end_time: number;
  status: 'active' | 'finalized' | 'cancelled';
  votes_for: number;
  votes_against: number;
  total_participants: number;
  finalized_at?: number;
}

export interface VoteCommitment {
  id: number;
  proposal_id: number;
  voter: string;
  commitment_hash: string;
  timestamp: number;
}

export interface Vote {
  id: number;
  proposal_id: number;
  voter: string;
  credits: number;
  votes: number;
  is_for: boolean;
  revealed_at: number;
}

export interface VotingStats {
  totalProposals: number;
  activeProposals: number;
  totalVotes: number;
  uniqueVoters: number;
}

export interface ProposalListResponse {
  proposals: Proposal[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
