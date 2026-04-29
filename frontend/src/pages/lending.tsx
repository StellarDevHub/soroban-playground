import { useState, useEffect } from 'react';
import { CreditScoreCard, LoanApplicationForm, LoanDashboard, TransactionHistory } from '@/components/lending';

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

interface Transaction {
  id: string;
  type: 'Loan Created' | 'Repayment' | 'Liquidated' | 'Credit Update';
  amount?: number;
  timestamp: number;
  status: 'Success' | 'Failed' | 'Pending';
  details?: string;
}

export default function LendingPage() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [creditScore, setCreditScore] = useState<number>(500);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState('user-123');

  const fetchLoans = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/loans?user=${user}`);
      if (!response.ok) throw new Error('Failed');
      const data = await response.json();
      setLoans(data);
    } catch (error) {
      console.error('Error fetching loans:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLoans();
  }, [user]);

  const handleLoanApplication = async (collateral: number, amount: number) => {
    setLoading(true);
    try {
      const response = await fetch('/api/loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ borrower: user, collateral_amount: collateral, loan_amount: amount }),
      });
      if (!response.ok) throw new Error('Failed to create loan');
      await fetchLoans();
    } catch (error) {
      console.error('Error creating loan:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRepay = async (loanId: string, amount: number) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/loans/${loanId}/repay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      if (!response.ok) throw new Error('Failed to repay');
      await fetchLoans();
    } catch (error) {
      console.error('Error repaying loan:', error);
    } finally {
      setLoading(false);
    }
  };

  const totalBorrowed = loans.reduce((sum, l) => sum + l.loan_amount, 0);
  const totalRepaid = loans.reduce((sum, l) => sum + l.total_repaid, 0);
  const activeLoans = loans.filter(l => l.status === 'Active').length;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Micro-Lending Platform</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <p className="text-sm text-gray-600">Active Loans</p>
            <p className="text-2xl font-bold">{activeLoans}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <p className="text-sm text-gray-600">Total Borrowed</p>
            <p className="text-2xl font-bold">{totalBorrowed.toFixed(7)} XLM</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <p className="text-sm text-gray-600">Total Repaid</p>
            <p className="text-2xl font-bold text-green-600">{totalRepaid.toFixed(7)} XLM</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <CreditScoreCard user={user} />
          </div>

          <div className="lg:col-span-2 space-y-6">
            <LoanApplicationForm onSubmit={handleLoanApplication} loading={loading} />
            <LoanDashboard loans={loans} loading={loading} onRepay={handleRepay} />
          </div>
        </div>
      </div>
    </div>
  );
}
