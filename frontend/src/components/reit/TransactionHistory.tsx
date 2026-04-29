'use client';

import React, { useState, useEffect } from 'react';
import { reitApi, Transaction } from '@/services/reitService';
import { Card } from './Card';
import { LoadingSpinner } from './LoadingSpinner';

interface TransactionHistoryProps {
  contractId: string;
}

export function TransactionHistory({ contractId }: TransactionHistoryProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    loadTransactions();
  }, [contractId, currentPage, filter]);

  const loadTransactions = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const type = filter !== 'all' ? filter : undefined;
      const result = await reitApi.getTransactions(
        { contract_id: contractId, type },
        { page: currentPage, limit: 20 }
      );

      setTransactions(result.data);
      setTotalPages(result.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'text-green-600 bg-green-100';
      case 'pending': return 'text-yellow-600 bg-yellow-100';
      case 'failed': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'buy_shares': 'Buy Shares',
      'transfer_shares': 'Transfer',
      'claim_dividends': 'Claim Dividends',
      'deposit_dividends': 'Dividend Deposit',
      'list_property': 'List Property',
    };
    return labels[type] || type;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <p className="text-red-600">{error}</p>
        <button
          onClick={loadTransactions}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Retry
        </button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {['all', 'buy_shares', 'claim_dividends', 'transfer_shares'].map((type) => (
          <button
            key={type}
            onClick={() => {
              setFilter(type);
              setCurrentPage(1);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === type
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {type === 'all' ? 'All Transactions' : getTypeLabel(type)}
          </button>
        ))}
      </div>

      {/* Transactions Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Type</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Property</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Shares</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Amount</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No transactions found.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="font-medium">{getTypeLabel(tx.tx_type)}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {tx.property_id ? `#${tx.property_id}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {tx.shares ? tx.shares.toLocaleString() : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {tx.amount ? `${(tx.amount / 10000000).toFixed(2)} XLM` : '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(tx.status)}`}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-500">
                      {new Date(tx.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-4 py-2 rounded-lg bg-gray-100 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-4 py-2">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-4 py-2 rounded-lg bg-gray-100 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
