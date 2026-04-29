'use client';

import React, { useState } from 'react';
import { Proposal } from '@/types/voting';
import { votingApi } from '@/services/votingApi';
import { createHash, randomBytes } from 'crypto';

interface VoteModalProps {
  proposal: Proposal;
  userAddress: string;
  onClose: () => void;
  onSuccess: () => void;
}

const VoteModal: React.FC<VoteModalProps> = ({
  proposal,
  userAddress,
  onClose,
  onSuccess,
}) => {
  const [credits, setCredits] = useState<number>(1);
  const [isFor, setIsFor] = useState<boolean>(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'commit' | 'reveal'>('commit');

  const votes = Math.floor(Math.sqrt(credits));
  const cost = votes * votes;

  const handleCommit = async () => {
    setLoading(true);
    setError(null);

    try {
      // Generate commitment hash (simplified for demo)
      const salt = randomBytes(32).toString('hex');
      const commitment = createHash('sha256')
        .update(`${credits}${isFor}${salt}`)
        .digest('hex');

      // Store salt in session storage for reveal phase
      sessionStorage.setItem(`vote_salt_${proposal.id}`, salt);

      await votingApi.commitVote(proposal.id, userAddress, commitment);
      setStep('reveal');
    } catch (err: any) {
      setError(err.message || 'Failed to commit vote');
    } finally {
      setLoading(false);
    }
  };

  const handleReveal = async () => {
    setLoading(true);
    setError(null);

    try {
      const salt = sessionStorage.getItem(`vote_salt_${proposal.id}`);
      if (!salt) {
        throw new Error('Salt not found. Please commit vote again.');
      }

      await votingApi.revealVote(proposal.id, userAddress, credits, isFor, salt);
      sessionStorage.removeItem(`vote_salt_${proposal.id}`);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to reveal vote');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="modal-overlay fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="vote-modal-title"
    >
      <div
        className="modal-content bg-white rounded-lg p-6 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header mb-4">
          <h2 id="vote-modal-title" className="text-2xl font-bold text-gray-900">
            {step === 'commit' ? 'Cast Your Vote' : 'Reveal Your Vote'}
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Proposal #{proposal.id}: {proposal.title}
          </p>
        </div>

        {/* Error Display */}
        {error && (
          <div className="error-message bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4" role="alert">
            {error}
          </div>
        )}

        {step === 'commit' ? (
          <>
            {/* Vote Direction */}
            <div className="form-group mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Vote Direction
              </label>
              <div className="flex gap-4">
                <button
                  type="button"
                  className={`flex-1 px-4 py-3 rounded border-2 transition ${
                    isFor
                      ? 'border-green-500 bg-green-50 text-green-700'
                      : 'border-gray-300 bg-white text-gray-700'
                  }`}
                  onClick={() => setIsFor(true)}
                  aria-pressed={isFor}
                >
                  <span className="text-2xl">✓</span>
                  <div className="font-medium">For</div>
                </button>
                <button
                  type="button"
                  className={`flex-1 px-4 py-3 rounded border-2 transition ${
                    !isFor
                      ? 'border-red-500 bg-red-50 text-red-700'
                      : 'border-gray-300 bg-white text-gray-700'
                  }`}
                  onClick={() => setIsFor(false)}
                  aria-pressed={!isFor}
                >
                  <span className="text-2xl">✗</span>
                  <div className="font-medium">Against</div>
                </button>
              </div>
            </div>

            {/* Credits Input */}
            <div className="form-group mb-4">
              <label htmlFor="credits-input" className="block text-sm font-medium text-gray-700 mb-2">
                Credits to Spend
              </label>
              <input
                id="credits-input"
                type="number"
                min="1"
                max="10000"
                value={credits}
                onChange={(e) => setCredits(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-describedby="credits-help"
              />
              <p id="credits-help" className="text-xs text-gray-500 mt-1">
                Quadratic voting: {credits} credits = {votes} vote{votes !== 1 ? 's' : ''} (cost: {cost} credits)
              </p>
            </div>

            {/* Quadratic Explanation */}
            <div className="info-box bg-blue-50 border border-blue-200 rounded p-4 mb-4">
              <h3 className="text-sm font-semibold text-blue-900 mb-2">
                How Quadratic Voting Works
              </h3>
              <p className="text-xs text-blue-800">
                The cost of votes increases quadratically. 1 vote costs 1 credit, 2 votes cost 4 credits,
                3 votes cost 9 credits, and so on. This prevents vote concentration and promotes fair representation.
              </p>
            </div>

            {/* Actions */}
            <div className="modal-actions flex gap-3">
              <button
                type="button"
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition"
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleCommit}
                disabled={loading || credits < 1}
              >
                {loading ? 'Committing...' : 'Commit Vote'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Reveal Phase */}
            <div className="reveal-info bg-green-50 border border-green-200 rounded p-4 mb-4">
              <h3 className="text-sm font-semibold text-green-900 mb-2">
                Vote Committed Successfully
              </h3>
              <p className="text-xs text-green-800 mb-3">
                Your vote has been committed privately. Now reveal it to make it count.
              </p>
              <div className="vote-summary text-sm">
                <p><strong>Direction:</strong> {isFor ? 'For' : 'Against'}</p>
                <p><strong>Credits:</strong> {credits}</p>
                <p><strong>Votes:</strong> {votes}</p>
              </div>
            </div>

            {/* Actions */}
            <div className="modal-actions flex gap-3">
              <button
                type="button"
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition"
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleReveal}
                disabled={loading}
              >
                {loading ? 'Revealing...' : 'Reveal Vote'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default VoteModal;
