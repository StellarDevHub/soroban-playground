import { useState, useCallback } from 'react';
import { Proposal, VotingStats } from '@/types/voting';
import { votingApi } from '@/services/votingApi';

export const useVoting = () => {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [stats, setStats] = useState<VotingStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshProposals = useCallback(async (
    status: 'active' | 'ended' | 'all' = 'all',
    page: number = 1,
    limit: number = 20
  ) => {
    setLoading(true);
    setError(null);

    try {
      const response = await votingApi.getProposals(page, limit, status);
      setProposals(response.proposals);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch proposals');
      setProposals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const statsData = await votingApi.getVotingStats();
      setStats(statsData);
    } catch (err: any) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  const getProposal = useCallback(async (proposalId: number) => {
    setLoading(true);
    setError(null);

    try {
      const proposal = await votingApi.getProposal(proposalId);
      return proposal;
    } catch (err: any) {
      setError(err.message || 'Failed to fetch proposal');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    proposals,
    stats,
    loading,
    error,
    refreshProposals,
    refreshStats,
    getProposal,
  };
};
