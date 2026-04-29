import React from 'react';

interface Loan {
  id: string;
  borrower: string;
  collateral_amount: number;
  loan_amount: number;
  interest_rate: number;
  creation_time: number;
  last_repayment: number;
  total_repaid: number;
  status: 'Active' | 'Repaid' | 'Liquidated' | 'Defaulted';
  remaining_debt?: number;
}

interface LoanDashboardProps {
  loans: Loan[];
  loading?: boolean;
  onRepay: (loanId: string, amount: number) => void;
}

const LoanDashboard: React.FC<LoanDashboardProps> = ({ loans, loading, onRepay }) => {
  const [repayAmounts, setRepayAmounts] = useState<Record<string, string>>({});

  const handleRepay = (loanId: string) => {
    const amount = repayAmounts[loanId];
    if (!amount) return;
    onRepay(loanId, parseFloat(amount));
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Active': return 'bg-green-100 text-green-800';
      case 'Repaid': return 'bg-blue-100 text-blue-800';
      case 'Liquidated': return 'bg-red-100 text-red-800';
      case 'Defaulted': return 'bg-gray-100 text-gray-800';
      default: return 'bg-yellow-100 text-yellow-800';
    }
  };

  const calculateTimeElapsed = (creationTime: number) => {
    const now = Date.now() / 1000;
    const elapsed = now - creationTime;
    const days = Math.floor(elapsed / 86400);
    return `${days} days`;
  };

  if (loading) {
    return (
      <div className="text-center p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">Your Loans</h3>

      {loans.length === 0 ? (
        <p className="text-gray-600 text-center py-8">No loans found. Apply for a loan to get started!</p>
      ) : (
        <div className="space-y-4">
          {loans.map((loan) => (
            <div key={loan.id} className="border rounded-lg p-4">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h4 className="font-semibold">Loan #{loan.id.slice(0, 8)}...</h4>
                  <p className="text-sm text-gray-600">
                    Created: {calculateTimeElapsed(loan.creation_time)} ago
                  </p>
                </div>
                <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(loan.status)}`}>
                  {loan.status}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-sm">
                <div>
                  <p className="text-gray-600">Loan Amount</p>
                  <p className="font-semibold">{loan.loan_amount} XLM</p>
                </div>
                <div>
                  <p className="text-gray-600">Collateral</p>
                  <p className="font-semibold">{loan.collateral_amount} XLM</p>
                </div>
                <div>
                  <p className="text-gray-600">Total Repaid</p>
                  <p className="font-semibold">{loan.total_repaid} XLM</p>
                </div>
                <div>
                  <p className="text-gray-600">Remaining Debt</p>
                  <p className="font-semibold text-red-600">
                    {loan.remaining_debt?.toFixed(2) || '0.00'} XLM
                  </p>
                </div>
              </div>

              {loan.status === 'Active' && (
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.0000001"
                    placeholder="Repayment amount"
                    value={repayAmounts[loan.id] || ''}
                    onChange={(e) => setRepayAmounts({ ...repayAmounts, [loan.id]: e.target.value })}
                    className="flex-1 p-2 border rounded text-sm"
                  />
                  <button
                    onClick={() => handleRepay(loan.id)}
                    className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 text-sm"
                  >
                    Repay
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LoanDashboard;
