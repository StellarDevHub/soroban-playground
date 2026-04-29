'use client';
import React from 'react';
import { CarbonTransaction } from '@/types/carbonCredits';
import { formatDistanceToNow } from 'date-fns';

interface Props {
  transactions: CarbonTransaction[];
}

export default function TransactionHistoryFeed({ transactions }: Props) {
  return (
    <div className="space-y-4">
      {transactions.map((tx) => (
        <div key={tx.id} className="flex items-center justify-between p-4 rounded-lg bg-gray-50 border border-transparent hover:border-gray-200 transition">
          <div className="flex items-center gap-4">
            <div className={`p-2 rounded-full ${
              tx.type === 'mint' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'
            }`}>
              <span className="text-xs font-bold uppercase">{tx.type[0]}</span>
            </div>
            <div>
              <p className="text-sm font-semibold capitalize">{tx.type} operation</p>
              <p className="text-xs text-gray-400">{formatDistanceToNow(new Date(tx.date))} ago</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold">{tx.amount > 0 ? `+${tx.amount}` : tx.amount}</p>
            <p className="text-[10px] text-gray-400 font-mono">TX: {tx.id.substring(0, 8)}...</p>
          </div>
        </div>
      ))}
    </div>
  );
}