'use client';

import React, { useState } from 'react';
import { Proposal } from '@/types/voting';
import VoteModal from './VoteModal';

interface ProposalCardProps {
  proposal: Proposal;
  userAddress?: string;
  onVoteSuccess: () => void;
}

const ProposalCard: React.FC<ProposalCardProps> = ({
  proposal,
  userAddress,
  onVoteSuccess,
}) => {
  const [showVoteModal, setShowVoteModal] = useState(false);

  const isActive = proposal.status === 'active' && Date.now() / 1000 < proposal.end_time;
  const totalVotes = proposal.votes_for + proposal.votes_against;
  const forPercentage = totalVotes > 0 ? (proposal.votes_for / totalVotes) * 100 : 0;
  const againstPercentage = totalVotes > 0 ? (proposal.votes_against / totalVotes) * 100 : 0;

  const formatTimeRemaining = (endTime: number) => {
    const now = Date.now() / 1000;
    const remaining = endTime - now;

    if (remaining <= 0) return 'Ended';

    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h remaining`;
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    return `${minutes}m remaining`;
  };

  return (
    <article
      className="proposal-card bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition"
      aria-labelledby={`proposal-title-${proposal.id}`}
    >
      {/* Header */}
      <div className="card-header mb-4">
        <div className="flex justify-between items-start">
          <h3
            id={`proposal-title-${proposal.id}`}
            className="text-xl font-semibold text-gray-900"
          >
            {proposal.title}
          </h3>
          <span
            className={`status-badge px-3 py-1 rounded-full text-sm font-medium ${
              isActive
                ? 'bg-green-100 text-green-800'
                : 'bg-gray-100 text-gray-800'
            }`}
            aria-label={`Status: ${isActive ? 'Active' : 'Ended'}`}
          >
            {isActive ? 'Active' : 'Ended'}
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-2">
          Proposal #{proposal.id}
        </p>
      </div>

      {/* Description */}
      <p className="description text-gray-700 mb-4 line-clamp-3">
        {proposal.description || 'No description provided'}
      </p>

      {/* Time Remaining */}
      <div className="time-info mb-4">
        <p className="text-sm text-gray-600">
          <span className="font-medium">Time: </span>
          {formatTimeRemaining(proposal.end_time)}
        </p>
      </div>

      {/* Vote Results */}
      <div className="vote-results mb-4" aria-label="Voting results">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-green-600 font-medium">
            For: {proposal.votes_for} ({forPercentage.toFixed(1)}%)
          </span>
          <span className="text-red-600 font-medium">
            Against: {proposal.votes_against} ({againstPercentage.toFixed(1)}%)
          </span>
        </div>

        {/* Progress Bar */}
        <div className="progress-bar h-4 bg-gray-200 rounded-full overflow-hidden">
          <div className="flex h-full">
            <div
              className="bg-green-500"
              style={{ width: `${forPercentage}%` }}
              role="progressbar"
              aria-valuenow={forPercentage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Votes for: ${forPercentage.toFixed(1)}%`}
            />
            <div
              className="bg-red-500"
              style={{ width: `${againstPercentage}%` }}
              role="progressbar"
              aria-valuenow={againstPercentage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Votes against: ${againstPercentage.toFixed(1)}%`}
            />
          </div>
        </div>

        <p className="text-xs text-gray-500 mt-2">
          {proposal.total_participants} participant{proposal.total_participants !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Actions */}
      <div className="card-actions">
        {isActive && userAddress ? (
          <button
            className="vote-button w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            onClick={() => setShowVoteModal(true)}
            aria-label={`Vote on proposal ${proposal.id}`}
          >
            Cast Vote
          </button>
        ) : !userAddress ? (
          <button
            className="w-full px-4 py-2 bg-gray-300 text-gray-600 rounded cursor-not-allowed"
            disabled
            aria-label="Connect wallet to vote"
          >
            Connect Wallet to Vote
          </button>
        ) : (
          <button
            className="w-full px-4 py-2 bg-gray-300 text-gray-600 rounded cursor-not-allowed"
            disabled
            aria-label="Voting has ended"
          >
            Voting Ended
          </button>
        )}
      </div>

      {/* Vote Modal */}
      {showVoteModal && (
        <VoteModal
          proposal={proposal}
          userAddress={userAddress || ''}
          onClose={() => setShowVoteModal(false)}
          onSuccess={() => {
            setShowVoteModal(false);
            onVoteSuccess();
          }}
        />
      )}
    </article>
  );
};

export default ProposalCard;
