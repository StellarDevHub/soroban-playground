import React from 'react';
import { TreasuryDashboard } from '../components/dao/TreasuryDashboard';

const TreasuryPage: React.FC = () => {
  return (
    <main className="min-h-screen bg-gray-50">
      <TreasuryDashboard />
    </main>
  );
};

export default TreasuryPage;
