import { useState, useCallback } from 'react';
import { treasuryApi } from '../services/treasuryApi';

export const useTreasury = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createProposal = useCallback(async (
    recipient: string,
    amount: string,
    description: string,
    duration: number
  ) => {
    setLoading(true);
    setError(null);
    try {
      await treasuryApi.createProposal(recipient, amount, description, duration);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create proposal';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const signProposal = useCallback(async (proposalId: number) => {
    setLoading(true);
    setError(null);
    try {
      await treasuryApi.signProposal(proposalId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sign proposal';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const executeProposal = useCallback(async (proposalId: number) => {
    setLoading(true);
    setError(null);
    try {
      await treasuryApi.executeProposal(proposalId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to execute proposal';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTreasuryInfo = useCallback(async () => {
    return await treasuryApi.getTreasuryInfo();
  }, []);

  const fetchProposals = useCallback(async () => {
    return await treasuryApi.getProposals();
  }, []);

  const getSigners = useCallback(async () => {
    return await treasuryApi.getSigners();
  }, []);

  const getThreshold = useCallback(async () => {
    return await treasuryApi.getThreshold();
  }, []);

  const addSigner = useCallback(async (signer: string) => {
    setLoading(true);
    setError(null);
    try {
      await treasuryApi.addSigner(signer);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add signer';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const removeSigner = useCallback(async (signer: string) => {
    setLoading(true);
    setError(null);
    try {
      await treasuryApi.removeSigner(signer);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove signer';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateThreshold = useCallback(async (threshold: number) => {
    setLoading(true);
    setError(null);
    try {
      await treasuryApi.updateThreshold(threshold);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update threshold';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    createProposal,
    signProposal,
    executeProposal,
    fetchTreasuryInfo,
    fetchProposals,
    getSigners,
    getThreshold,
    addSigner,
    removeSigner,
    updateThreshold,
  };
};
