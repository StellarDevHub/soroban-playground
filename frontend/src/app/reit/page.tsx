'use client';

import React, { useState, useEffect } from 'react';
import { ReitDashboard } from '@/components/reit/ReitDashboard';
import { PropertyList } from '@/components/reit/PropertyList';
import { InvestorPortfolio } from '@/components/reit/InvestorPortfolio';
import { TransactionHistory } from '@/components/reit/TransactionHistory';
import { ReitConfig, reitApi } from '@/services/reitService';
import { useWallet } from '@/hooks/useWallet';
import { Card } from '@/components/ui/Card';
import { Tabs, Tab } from '@/components/ui/Tabs';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

const DEFAULT_CONTRACT_ID = process.env.NEXT_PUBLIC_REIT_CONTRACT_ID || '';

export default function ReitPage() {
  const { publicKey, isConnected } = useWallet();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [contractId, setContractId] = useState(DEFAULT_CONTRACT_ID);
  const [config, setConfig] = useState<ReitConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (contractId) {
      loadConfig();
    } else {
      setIsLoading(false);
    }
  }, [contractId]);

  const loadConfig = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await reitApi.getReitConfig(contractId);
      setConfig(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load REIT config');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  if (!contractId) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="p-8 text-center">
          <h1 className="text-2xl font-bold mb-4">Tokenized REIT Platform</h1>
          <p className="text-gray-600 mb-4">
            Please configure a REIT contract ID to get started.
          </p>
          <input
            type="text"
            placeholder="Enter Contract ID"
            className="px-4 py-2 border rounded-lg w-full max-w-md"
            onChange={(e) => setContractId(e.target.value)}
          />
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="p-8">
          <h1 className="text-2xl font-bold mb-4 text-red-600">Error</h1>
          <p className="text-gray-600">{error}</p>
          <button
            onClick={loadConfig}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              {config?.name || 'REIT Platform'}
            </h1>
            <p className="text-gray-500 mt-1">
              {config?.symbol || 'REIT'} • Tokenized Real Estate Investment Trust
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">Contract ID</p>
            <p className="text-xs font-mono text-gray-400 truncate max-w-xs">
              {contractId}
            </p>
          </div>
        </div>

        {/* Stats Bar */}
        {config && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <StatCard
              label="Total Properties"
              value={config.total_properties}
              icon="building"
            />
            <StatCard
              label="Total Investors"
              value={config.total_investors}
              icon="users"
            />
            <StatCard
              label="Value Locked"
              value={`${(config.total_value_locked / 10000000).toFixed(2)} XLM`}
              icon="wallet"
            />
            <StatCard
              label="Dividends Distributed"
              value={`${(config.total_dividends_distributed / 10000000).toFixed(2)} XLM`}
              icon="coins"
            />
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs activeTab={activeTab} onChange={setActiveTab} className="mb-6">
        <Tab id="dashboard" label="Dashboard" icon="layout-dashboard" />
        <Tab id="properties" label="Properties" icon="building-2" />
        {isConnected && (
          <Tab id="portfolio" label="My Portfolio" icon="pie-chart" />
        )}
        <Tab id="transactions" label="Transactions" icon="list" />
      </Tabs>

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === 'dashboard' && (
          <ReitDashboard contractId={contractId} />
        )}
        {activeTab === 'properties' && (
          <PropertyList contractId={contractId} />
        )}
        {activeTab === 'portfolio' && isConnected && publicKey && (
          <InvestorPortfolio contractId={contractId} investorAddress={publicKey} />
        )}
        {activeTab === 'transactions' && (
          <TransactionHistory contractId={contractId} />
        )}
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: string;
}

function StatCard({ label, value, icon }: StatCardProps) {
  const iconPaths: Record<string, string> = {
    building: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
    users: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
    wallet: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
    coins: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  };

  return (
    <Card className="p-4 flex items-center space-x-4">
      <div className="p-3 bg-blue-100 rounded-lg">
        <svg
          className="w-6 h-6 text-blue-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPaths[icon]} />
        </svg>
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-xl font-semibold text-gray-900">{value}</p>
      </div>
    </Card>
  );
}
