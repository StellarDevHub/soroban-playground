import React, { useState, useEffect } from 'react';
import { useTreasury } from '../../hooks/useTreasury';
import { ProposalCard } from './ProposalCard';

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

interface ProposalListProps {
  onUpdate: () => void;
}

export const ProposalList: React.FC<ProposalListProps> = ({ onUpdate }) => {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'executed'>('all');
  const { fetchProposals } = useTreasury();

  useEffect(() => {
    loadProposals();
  }, []);

  const loadProposals = async () => {
    try {
      setLoading(true);
      const data = await fetchProposals();
      setProposals(data);
    } catch (error) {
      console.error('Failed to load proposals:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredProposals = proposals.filter(p => {
    if (filter === 'pending') return !p.executed;
    if (filter === 'executed') return p.executed;
    return true;
  });

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status" aria-live="polite">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" aria-hidden="true"></div>
        <span className="sr-only">Loading proposals...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold">Proposals</h2>
        <div className="flex gap-2" role="group" aria-label="Filter proposals">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              filter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
            aria-pressed={filter === 'all'}
          >
            All
          </button>
          <button
            onClick={() => setFilter('pending')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              filter === 'pending'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
            aria-pressed={filter === 'pending'}
          >
            Pending
          </button>
          <button
            onClick={() => setFilter('executed')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              filter === 'executed'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
            aria-pressed={filter === 'executed'}
          >
            Executed
          </button>
        </div>
      </div>

      {filteredProposals.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <p className="text-gray-500">No proposals found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredProposals.map(proposal => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              onUpdate={() => {
                loadProposals();
                onUpdate();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};
