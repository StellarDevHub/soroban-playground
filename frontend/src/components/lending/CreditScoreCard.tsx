import React, { useState, useEffect } from 'react';

interface CreditScoreProps {
  user: string;
  onRefresh?: () => void;
}

interface CreditScoreData {
  user: string;
  score: number;
  total_loans: number;
  successful_repayments: number;
  defaulted_loans: number;
  last_updated: number;
}

const CreditScoreCard: React.FC<CreditScoreProps> = ({ user, onRefresh }) => {
  const [scoreData, setScoreData] = useState<CreditScoreData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCreditScore = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/credit-score/${user}`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setScoreData(data);
    } catch (error) {
      console.error('Error fetching credit score:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchCreditScore();
    }
  }, [user]);

  const getScoreColor = (score: number) => {
    if (score >= 750) return 'text-green-600';
    if (score >= 650) return 'text-blue-600';
    if (score >= 500) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreLabel = (score: number) => {
    if (score >= 750) return 'Excellent';
    if (score >= 650) return 'Good';
    if (score >= 500) return 'Fair';
    return 'Poor';
  };

  if (loading) {
    return <div className="animate-pulse bg-gray-200 h-48 rounded-lg"></div>;
  }

  if (!scoreData) {
    return <div className="text-center p-4 text-gray-500">No credit data available</div>;
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Credit Score</h3>
        <button
          onClick={() => { fetchCreditScore(); onRefresh?.(); }}
          className="text-sm text-blue-600 hover:underline"
        >
          Refresh
        </button>
      </div>

      <div className="text-center mb-6">
        <div className={`text-6xl font-bold ${getScoreColor(scoreData.score)}`}>
          {scoreData.score}
        </div>
        <div className="text-gray-600 mt-2">
          {getScoreLabel(scoreData.score)}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-2xl font-semibold text-gray-800">
            {scoreData.total_loans}
          </div>
          <div className="text-xs text-gray-600">Total Loans</div>
        </div>
        <div>
          <div className="text-2xl font-semibold text-green-600">
            {scoreData.successful_repayments}
          </div>
          <div className="text-xs text-gray-600">Repaid</div>
        </div>
        <div>
          <div className="text-2xl font-semibold text-red-600">
            {scoreData.defaulted_loans}
          </div>
          <div className="text-xs text-gray-600">Defaulted</div>
        </div>
      </div>

      <div className="mt-4 text-xs text-gray-500 text-center">
        Last updated: {new Date(scoreData.last_updated * 1000).toLocaleDateString()}
      </div>
    </div>
  );
};

export default CreditScoreCard;
