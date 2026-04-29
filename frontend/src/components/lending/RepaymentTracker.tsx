import React from 'react';

interface RepaymentTrackerProps {
  loan: {
    id: string;
    loan_amount: number;
    total_repaid: number;
    remaining_debt?: number;
    status: string;
  };
  onRepay: (loanId: string, amount: number) => void;
  loading?: boolean;
}

const RepaymentTracker: React.FC<RepaymentTrackerProps> = ({ loan, onRepay, loading }) => {
  const [amount, setAmount] = useState('');
  const [percentage, setPercentage] = useState(25);

  const progress = (loan.total_repaid / loan.loan_amount) * 100;
  const remaining = loan.remaining_debt || (loan.loan_amount - loan.total_repaid);

  const handleQuickRepay = (percent: number) => {
    const repayAmount = (remaining * percent) / 100;
    setAmount(repayAmount.toFixed(7));
    setPercentage(percent);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount) return;
    onRepay(loan.id, parseFloat(amount));
    setAmount('');
  };

  const getProgressColor = (progress: number) => {
    if (progress >= 100) return 'bg-green-500';
    if (progress >= 75) return 'bg-blue-500';
    if (progress >= 50) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">Repayment Tracker</h3>

      <div className="mb-6">
        <div className="flex justify-between text-sm mb-1">
          <span>Progress</span>
          <span>{progress.toFixed(1)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-4">
          <div
            className={`h-4 rounded-full transition-all ${getProgressColor(progress)}`}
            style={{ width: `${Math.min(progress, 100)}%` }}
          ></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <p className="text-sm text-gray-600">Total Repaid</p>
          <p className="text-xl font-bold text-green-600">
            {loan.total_repaid.toFixed(7)} XLM
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-600">Remaining</p>
          <p className="text-xl font-bold text-red-600">
            {remaining.toFixed(7)} XLM
          </p>
        </div>
      </div>

      {loan.status === 'Active' && (
        <>
          <div className="flex gap-2 mb-4">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                onClick={() => handleQuickRepay(pct)}
                className={`flex-1 py-2 rounded text-sm ${
                  percentage === pct
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 hover:bg-gray-200'
                }`}
              >
                {pct}%
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">
                Repayment Amount (XLM)
              </label>
              <input
                type="number"
                step="0.0000001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full p-2 border rounded"
                placeholder="0.00"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading || !amount}
              className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Processing...' : 'Make Repayment'}
            </button>
          </form>
        </>
      )}

      {loan.status === 'Repaid' && (
        <div className="text-center p-4 bg-green-50 rounded">
          <p className="text-green-800 font-semibold">✓ Loan Fully Repaid!</p>
        </div>
      )}
    </div>
  );
};

export default RepaymentTracker;
