import React from 'react';

interface Transaction {
  id: string;
  type: 'Loan Created' | 'Repayment' | 'Liquidated' | 'Credit Update';
  amount?: number;
  timestamp: number;
  status: 'Success' | 'Failed' | 'Pending';
  details?: string;
}

interface TransactionHistoryProps {
  transactions: Transaction[];
  loading?: boolean;
}

const TransactionHistory: React.FC<TransactionHistoryProps> = ({ transactions, loading }) => {
  const [filter, setFilter] = useState<'All' | 'Loan Created' | 'Repayment' | 'Liquidated'>('All');

  const filteredTransactions = transactions.filter(tx => 
    filter === 'All' || tx.type === filter
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Success': return 'text-green-600 bg-green-100';
      case 'Failed': return 'text-red-600 bg-red-100';
      case 'Pending': return 'text-yellow-600 bg-yellow-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusDot = (status: string) => {
    switch (status) {
      case 'Success': return 'bg-green-500';
      case 'Failed': return 'bg-red-500';
      case 'Pending': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  if (loading) {
    return (
      <div className="text-center p-8">
        <div className="animate-pulse space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="h-16 bg-gray-200 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Transaction History</h3>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as any)}
          className="p-2 border rounded text-sm"
        >
          <option value="All">All Types</option>
          <option value="Loan Created">Loan Created</option>
          <option value="Repayment">Repayments</option>
          <option value="Liquidated">Liquidations</option>
        </select>
      </div>

      {filteredTransactions.length === 0 ? (
        <p className="text-gray-600 text-center py-8">No transactions found.</p>
      ) : (
        <div className="space-y-3">
          {filteredTransactions.map((tx) => (
            <div key={tx.id} className="flex items-center gap-4 p-3 border rounded hover:bg-gray-50">
              <div className={`w-3 h-3 rounded-full ${getStatusDot(tx.status)}`}></div>
              
              <div className="flex-1">
                <div className="flex justify-between">
                  <span className="font-medium">{tx.type}</span>
                  <span className="text-sm text-gray-600">
                    {new Date(tx.timestamp * 1000).toLocaleDateString()}
                  </span>
                </div>
                {tx.amount && (
                  <p className="text-sm text-gray-600">{tx.amount} XLM</p>
                )}
                {tx.details && (
                  <p className="text-xs text-gray-500">{tx.details}</p>
                )}
              </div>

              <span className={`text-xs px-2 py-1 rounded ${getStatusColor(tx.status)}`}>
                {tx.status}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 text-sm text-gray-600 text-center">
        Showing {filteredTransactions.length} of {transactions.length} transactions
      </div>
    </div>
  );
};

export default TransactionHistory;
