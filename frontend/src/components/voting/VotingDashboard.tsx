'use client';

import React, { useState, useEffect } from 'react';
import { useVoting } from '@/hooks/useVoting';
import ProposalList from './ProposalList';
import CreateProposal from './CreateProposal';
import VotingStats from './VotingStats';

interface VotingDashboardProps {
  userAddress?: string;
}

const VotingDashboard: React.FC<VotingDashboardProps> = ({ userAddress }) => {
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'ended'>('active');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { proposals, stats, loading, error, refreshProposals, refreshStats } = useVoting();

  useEffect(() => {
    refreshProposals(activeTab);
    refreshStats();
  }, [activeTab]);

  const handleTabChange = (tab: 'all' | 'active' | 'ended') => {
    setActiveTab(tab);
  };

  const handleProposalCreated = () => {
    setShowCreateModal(false);
    refreshProposals(activeTab);
    refreshStats();
  };

  return (
    <div className="voting-dashboard" role="main" aria-label="Voting Dashboard">
      {/* Header */}
      <header className="dashboard-header">
        <h1 className="text-3xl font-bold">Quadratic Voting System</h1>
        <p className="text-gray-600 mt-2">
          Participate in decentralized governance with privacy-preserving quadratic voting
        </p>
      </header>

      {/* Stats Section */}
      <VotingStats stats={stats} loading={loading} />

      {/* Action Bar */}
      <div className="action-bar flex justify-between items-center my-6">
        <div className="tabs flex gap-2" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'active'}
            aria-controls="proposals-panel"
            className={`tab-button px-4 py-2 rounded ${
              activeTab === 'active' ? 'bg-blue-600 text-white' : 'bg-gray-200'
            }`}
            onClick={() => handleTabChange('active')}
          >
            Active Proposals
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'ended'}
            aria-controls="proposals-panel"
            className={`tab-button px-4 py-2 rounded ${
              activeTab === 'ended' ? 'bg-blue-600 text-white' : 'bg-gray-200'
            }`}
            onClick={() => handleTabChange('ended')}
          >
            Ended Proposals
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'all'}
            aria-controls="proposals-panel"
            className={`tab-button px-4 py-2 rounded ${
              activeTab === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200'
            }`}
            onClick={() => handleTabChange('all')}
          >
            All Proposals
          </button>
        </div>

        {userAddress && (
          <button
            className="create-button px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition"
            onClick={() => setShowCreateModal(true)}
            aria-label="Create new proposal"
          >
            Create Proposal
          </button>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="error-banner bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4" role="alert">
          <strong className="font-bold">Error: </strong>
          <span>{error}</span>
        </div>
      )}

      {/* Proposals List */}
      <div id="proposals-panel" role="tabpanel" aria-labelledby={`${activeTab}-tab`}>
        <ProposalList
          proposals={proposals}
          loading={loading}
          userAddress={userAddress}
          onVoteSuccess={() => {
            refreshProposals(activeTab);
            refreshStats();
          }}
        />
      </div>

      {/* Create Proposal Modal */}
      {showCreateModal && (
        <CreateProposal
          userAddress={userAddress || ''}
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleProposalCreated}
        />
      )}
    </div>
  );
};

export default VotingDashboard;
