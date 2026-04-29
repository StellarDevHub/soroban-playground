import React, { useState, useEffect } from 'react';
import { useTreasury } from '../../hooks/useTreasury';
import { ProposalList } from './ProposalList';
import { CreateProposal } from './CreateProposal';
import { TreasuryStats } from './TreasuryStats';
import { SignerManagement } from './SignerManagement';

interface TreasuryInfo {
  total_balance: string;
  total_proposals: number;
  executed_proposals: number;
  pending_proposals: number;
}

export const TreasuryDashboard: React.FC = () => {
  const [treasuryInfo, setTreasuryInfo] = useState<TreasuryInfo | null>(null);
  const [activeTab, setActiveTab] = useState<'proposals' | 'create' | 'signers'>('proposals');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { fetchTreasuryInfo, fetchProposals } = useTreasury();

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const info = await fetchTreasuryInfo();
      setTreasuryInfo(info);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load treasury data');
    } finally {
      setLoading(false);
    }
  };

  if (loading && !treasuryInfo) {
    return (
      <div className="flex items-center justify-center min-h-screen" role="status" aria-live="polite">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" aria-hidden="true"></div>
        <span className="sr-only">Loading treasury data...</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold mb-2" tabIndex={0}>DAO Treasury Management</h1>
        <p className="text-gray-600">Multi-signature treasury with proposal-based governance</p>
      </header>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6" role="alert">
          <strong className="font-bold">Error: </strong>
          <span>{error}</span>
        </div>
      )}

      {treasuryInfo && (
        <TreasuryStats info={treasuryInfo} />
      )}

      <nav className="mb-6" role="tablist" aria-label="Treasury sections">
        <div className="border-b border-gray-200">
          <div className="flex space-x-8">
            <button
              role="tab"
              aria-selected={activeTab === 'proposals'}
              aria-controls="proposals-panel"
              onClick={() => setActiveTab('proposals')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'proposals'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Proposals
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'create'}
              aria-controls="create-panel"
              onClick={() => setActiveTab('create')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'create'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Create Proposal
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'signers'}
              aria-controls="signers-panel"
              onClick={() => setActiveTab('signers')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'signers'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Signers
            </button>
          </div>
        </div>
      </nav>

      <div role="tabpanel" id="proposals-panel" hidden={activeTab !== 'proposals'}>
        {activeTab === 'proposals' && <ProposalList onUpdate={loadData} />}
      </div>

      <div role="tabpanel" id="create-panel" hidden={activeTab !== 'create'}>
        {activeTab === 'create' && <CreateProposal onSuccess={loadData} />}
      </div>

      <div role="tabpanel" id="signers-panel" hidden={activeTab !== 'signers'}>
        {activeTab === 'signers' && <SignerManagement onUpdate={loadData} />}
      </div>
    </div>
  );
};
