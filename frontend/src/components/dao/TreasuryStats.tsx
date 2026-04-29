import React from 'react';

interface TreasuryInfo {
  total_balance: string;
  total_proposals: number;
  executed_proposals: number;
  pending_proposals: number;
}

interface TreasuryStatsProps {
  info: TreasuryInfo;
}

export const TreasuryStats: React.FC<TreasuryStatsProps> = ({ info }) => {
  const formatBalance = (balance: string): string => {
    const num = parseFloat(balance);
    if (isNaN(num)) return '0';
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8" aria-label="Treasury statistics">
      <div className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-blue-500">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-600">Total Balance</h3>
          <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-3xl font-bold text-gray-900" aria-label={`Total balance: ${formatBalance(info.total_balance)} tokens`}>
          {formatBalance(info.total_balance)}
        </p>
        <p className="text-sm text-gray-500 mt-1">XLM</p>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-green-500">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-600">Total Proposals</h3>
          <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <p className="text-3xl font-bold text-gray-900" aria-label={`Total proposals: ${info.total_proposals}`}>
          {info.total_proposals}
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-purple-500">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-600">Executed</h3>
          <svg className="w-8 h-8 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-3xl font-bold text-gray-900" aria-label={`Executed proposals: ${info.executed_proposals}`}>
          {info.executed_proposals}
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-yellow-500">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-600">Pending</h3>
          <svg className="w-8 h-8 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-3xl font-bold text-gray-900" aria-label={`Pending proposals: ${info.pending_proposals}`}>
          {info.pending_proposals}
        </p>
      </div>
    </section>
  );
};
