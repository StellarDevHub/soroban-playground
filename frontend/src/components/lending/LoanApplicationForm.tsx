import React, { useState } from 'react';

interface LoanApplicationFormProps {
  onSubmit: (collateral: number, amount: number) => void;
  loading?: boolean;
}

const LoanApplicationForm: React.FC<LoanApplicationFormProps> = ({ onSubmit, loading }) => {
  const [collateral, setCollateral] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const collateralNum = parseFloat(collateral);
    const amountNum = parseFloat(amount);

    if (!collateralNum || !amountNum) {
      setError('Please fill in all fields');
      return;
    }

    if (collateralNum < amountNum * 1.5) {
      setError('Collateral must be at least 150% of loan amount');
      return;
    }

    if (amountNum <= 0 || collateralNum <= 0) {
      setError('Amounts must be greater than 0');
      return;
    }

    onSubmit(collateralNum, amountNum);
  };

  const minCollateral = amount ? (parseFloat(amount) * 1.5).toFixed(2) : '0.00';

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">Apply for Loan</h3>

      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">
            Loan Amount (XLM)
          </label>
          <input
            type="number"
            step="0.0000001"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
            placeholder="1000"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Collateral Amount (XLM)
          </label>
          <input
            type="number"
            step="0.0000001"
            value={collateral}
            onChange={(e) => setCollateral(e.target.value)}
            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
            placeholder="1500"
            required
          />
          <p className="text-xs text-gray-600 mt-1">
            Minimum required: {minCollateral} XLM (150%)
          </p>
        </div>

        {amount > 0 && collateral > 0 && (
          <div className="p-3 bg-blue-50 rounded">
            <h4 className="text-sm font-semibold mb-2">Loan Summary</h4>
            <div className="space-y-1 text-sm">
              <p>Loan Amount: {amount} XLM</p>
              <p>Collateral: {collateral} XLM</p>
              <p>Collateralization Ratio: {((parseFloat(collateral) / parseFloat(amount)) * 100).toFixed(1)}%</p>
              <p>Estimated Interest Rate: 5%</p>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Processing...' : 'Apply for Loan'}
        </button>
      </form>
    </div>
  );
};

export default LoanApplicationForm;
