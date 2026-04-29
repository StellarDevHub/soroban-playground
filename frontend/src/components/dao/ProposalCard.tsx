import React, { useState } from 'react';
import { useTreasury } from '../../hooks/useTreasury';

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

interface ProposalCardProps {
  proposal: Proposal;
  onUpdate: () => void;
}

export const ProposalCard: React.FC<ProposalCardProps> = ({ proposal, onUpdate }) => {
  const [loading, setLoading] = useState(false);
  const { signProposal, executeProposal, getThreshold } = useTreasury();
  const [threshold, setThreshold] = useState(2);

  React.useEffect(() => {
    getThreshold().then(setThreshold);
  }, []);

  const handleSign = async () => {
    setLoading(true);
    try {
      await signProposal(proposal.id);
      onUpdate();
    } catch (error) {
      console.error('Failed to sign:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    setLoading(true);
    try {
      await executeProposal(proposal.id);
      onUpdate();
    } finally {
      setLoading(false);
    }
  };

  const isExpired = Date.now() / 1000 > proposal.expires_at;
  const canExecute = proposal.signatures.length >= threshold && !proposal.executed && !isExpired;
  const expiresIn = Math.max(0, Math.floor((proposal.expires_at - Date.now() / 1000) / 3600));

  return (
    <article className="bg-white rounded-lg shadow-lg p-6 border border-gray-200">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-xl font-bold mb-1">Proposal #{proposal.id}</h3>
          <p className="text-sm text-gray-500">
            Created {new Date(proposal.created_at * 1000).toLocaleDateString()}
          </p>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-sm font-semibold ${
            proposal.executed
              ? 'bg-green-100 text-green-800'
              : isExpired
              ? 'bg-red-100 text-red-800'
              : 'bg-yellow-100 text-yellow-800'
          }`}
        >
          {proposal.executed ? 'Executed' : isExpired ? 'Expired' : 'Pending'}
        </span>
      </div>

      <p className="text-gray-700 mb-4">{proposal.description}</p>

      <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
        <div>
          <span className="text-gray-600">Amount:</span>
          <p className="font-semibold">{proposal.amount} XLM</p>
        </div>
        <div>
          <span className="text-gray-600">Recipient:</span>
          <p className="font-mono text-xs truncate">{proposal.recipient}</p>
        </div>
        <div>
          <span className="text-gray-600">Signatures:</span>
          <p className="font-semibold">
            {proposal.signatures.length} / {threshold}
          </p>
        </div>
        <div>
          <span className="text-gray-600">Expires in:</span>
          <p className="font-semibold">{expiresIn}h</p>
        </div>
      </div>

      {!proposal.executed && !isExpired && (
        <div className="flex gap-3">
          <button
            onClick={handleSign}
            disabled={loading}
            className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            aria-busy={loading}
          >
            {loading ? 'Processing...' : 'Sign Proposal'}
          </button>
          {canExecute && (
            <button
              onClick={handleExecute}
              disabled={loading}
              className="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
              aria-busy={loading}
            >
              {loading ? 'Processing...' : 'Execute'}
            </button>
          )}
        </div>
      )}
    </article>
  );
};
