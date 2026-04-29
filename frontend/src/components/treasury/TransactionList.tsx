"use client";

import React from 'react';
import { useTreasuryWebSocket } from '../../hooks/useTreasuryWebSocket';
import { ArrowUpRight, ArrowDownRight, Clock } from 'lucide-react';

export function TransactionList() {
  const { events, isConnected } = useTreasuryWebSocket();

  // Mock initial transactions if WS has none
  const transactions = events.length > 0 ? events : [
    { id: 1, type: 'withdraw', amount: 500, status: 'Executed', to: 'GBX...', date: '2 mins ago' },
    { id: 2, type: 'deposit', amount: 12000, status: 'Confirmed', from: 'GCY...', date: '1 hour ago' },
    { id: 3, type: 'withdraw', amount: 1500, status: 'Pending', to: 'GAZ...', date: '3 hours ago' },
  ];

  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-2xl font-semibold text-white">Recent Transactions</h3>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-sm text-gray-400">{isConnected ? 'Live' : 'Offline'}</span>
        </div>
      </div>

      <div className="space-y-4">
        {transactions.map((tx: any, idx: number) => (
          <div key={idx} className="group flex items-center justify-between p-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors border border-transparent hover:border-white/10">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-full ${tx.type === 'deposit' ? 'bg-green-500/20 text-green-400' : tx.type === 'withdraw' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
                {tx.type === 'deposit' ? <ArrowDownRight size={20} /> : tx.type === 'withdraw' ? <ArrowUpRight size={20} /> : <Clock size={20} />}
              </div>
              <div>
                <p className="text-white font-medium capitalize">{tx.type} {tx.status === 'Pending' && '(Pending)'}</p>
                <p className="text-sm text-gray-500">{tx.to ? `To: ${tx.to}` : `From: ${tx.from}`} • {tx.date}</p>
              </div>
            </div>
            <div className={`text-lg font-semibold ${tx.type === 'deposit' ? 'text-green-400' : 'text-white'}`}>
              {tx.type === 'deposit' ? '+' : '-'}{tx.amount} XLM
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
