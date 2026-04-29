'use client';

import React from 'react';
import { VotingStats as Stats } from '@/types/voting';

interface VotingStatsProps {
  stats: Stats | null;
  loading: boolean;
}

const VotingStats: React.FC<VotingStatsProps> = ({ stats, loading }) => {
  if (loading || !stats) {
    return (
      <div className="stats-container grid grid-cols-1 md:grid-cols-4 gap-4 my-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="stat-card bg-gray-100 rounded-lg p-6 animate-pulse">
            <div className="h-4 bg-gray-300 rounded w-3/4 mb-2"></div>
            <div className="h-8 bg-gray-300 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  const statItems = [
    {
      label: 'Total Proposals',
      value: stats.totalProposals,
      icon: '📋',
      color: 'blue',
    },
    {
      label: 'Active Proposals',
      value: stats.activeProposals,
      icon: '🗳️',
      color: 'green',
    },
    {
      label: 'Total Votes',
      value: stats.totalVotes,
      icon: '✓',
      color: 'purple',
    },
    {
      label: 'Unique Voters',
      value: stats.uniqueVoters,
      icon: '👥',
      color: 'orange',
    },
  ];

  return (
    <div className="stats-container grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 my-6">
      {statItems.map((item, index) => (
        <div
          key={index}
          className={`stat-card bg-white rounded-lg shadow-md p-6 border-l-4 border-${item.color}-500`}
          role="region"
          aria-label={`${item.label}: ${item.value}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 font-medium">{item.label}</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{item.value}</p>
            </div>
            <div className="text-4xl" aria-hidden="true">
              {item.icon}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default VotingStats;
