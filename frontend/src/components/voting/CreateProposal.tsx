'use client';

import React, { useState } from 'react';
import { votingApi } from '@/services/votingApi';

interface CreateProposalProps {
  userAddress: string;
  onClose: () => void;
  onSuccess: () => void;
}

const CreateProposal: React.FC<CreateProposalProps> = ({
  userAddress,
  onClose,
  onSuccess,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState(7); // days
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const durationSeconds = duration * 24 * 60 * 60;
      await votingApi.createProposal(title, description, durationSeconds, userAddress);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to create proposal');
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
      aria-labelledby="create-proposal-title"
    >
      <div
        className="modal-content bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="create-proposal-title" className="text-2xl font-bold text-gray-900 mb-4">
          Create New Proposal
        </h2>

        {error && (
          <div className="error-message bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Title */}
          <div className="form-group mb-4">
            <label htmlFor="proposal-title" className="block text-sm font-medium text-gray-700 mb-2">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id="proposal-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter proposal title"
              required
              minLength={3}
              maxLength={100}
              aria-required="true"
            />
          </div>

          {/* Description */}
          <div className="form-group mb-4">
            <label htmlFor="proposal-description" className="block text-sm font-medium text-gray-700 mb-2">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              id="proposal-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[150px]"
              placeholder="Describe your proposal in detail"
              required
              minLength={10}
              maxLength={5000}
              aria-required="true"
            />
            <p className="text-xs text-gray-500 mt-1">
              {description.length}/5000 characters
            </p>
          </div>

          {/* Duration */}
          <div className="form-group mb-6">
            <label htmlFor="proposal-duration" className="block text-sm font-medium text-gray-700 mb-2">
              Voting Duration (days) <span className="text-red-500">*</span>
            </label>
            <input
              id="proposal-duration"
              type="number"
              value={duration}
              onChange={(e) => setDuration(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              min="1"
              max="30"
              required
              aria-required="true"
            />
            <p className="text-xs text-gray-500 mt-1">
              Voting will be open for {duration} day{duration !== 1 ? 's' : ''}
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
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading || !title || !description}
            >
              {loading ? 'Creating...' : 'Create Proposal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateProposal;
