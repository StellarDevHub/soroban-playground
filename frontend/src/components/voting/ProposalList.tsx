'use client';

import React from 'react';
import ProposalCard from './ProposalCard';
import { Proposal } from '@/types/voting';

interface ProposalListProps {
  proposals: Proposal[];
  loading: boolean;
  userAddress?: string;
  onVoteSuccess: () => void;
}

const ProposalList: React.FC<ProposalListProps> = ({
  proposals,
  loading,
  userAddress,
  onVoteSuccess,
}) => {
  if (loading) {
    return (
      <div className="loading-container flex justify-center items-center py-12" role="status">
        <div className="spinner animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <span className="sr-only">Loading proposals...</span>
      </div>
    );
  }

  if (proposals.length === 0) {
    return (
      <div className="empty-state text-center py-12 bg-gray-50 rounded-lg">
        <svg
          className="mx-auto h-12 w-12 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
        <h3 className="mt-2 text-lg font-medium text-gray-900">No proposals found</h3>
        <p className="mt-1 text-sm text-gray-500">
          Get started by creating a new proposal.
        </p>
      </div>
    );
  }

  return (
    <div className="proposal-list grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {proposals.map((proposal) => (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          userAddress={userAddress}
          onVoteSuccess={onVoteSuccess}
        />
      ))}
    </div>
  );
};

export default ProposalList;
