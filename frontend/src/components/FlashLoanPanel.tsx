import React, { useState } from 'react';
import { Zap, Activity, DollarSign, History, Search } from 'lucide-react';

export default function FlashLoanPanel() {
    const [loans, setLoans] = useState([
        { id: 'tx-1', amount: 50000, fee: 250, status: 'Success', time: '2m ago' },
        { id: 'tx-2', amount: 120000, fee: 600, status: 'Success', time: '15m ago' },
    ]);

    return (
        <div className="p-6 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                    <Zap className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Flash Loan Provider</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                    <div className="text-sm text-slate-500 mb-1">Total Liquidity</div>
                    <div className="text-2xl font-bold text-slate-900 dark:text-white">1,000,000 XLM</div>
                </div>
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                    <div className="text-sm text-slate-500 mb-1">Total Loans</div>
                    <div className="text-2xl font-bold text-slate-900 dark:text-white">{loans.length + 42}</div>
                </div>
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                    <div className="text-sm text-slate-500 mb-1">Fees Collected</div>
                    <div className="text-2xl font-bold text-green-500">2,450 XLM</div>
                </div>
            </div>

            <div className="bg-slate-900 text-slate-100 p-4 rounded-lg mb-8 font-mono text-sm border border-slate-700 shadow-inner">
                <div className="flex items-center gap-2 mb-2 text-yellow-400">
                    <Search className="w-4 h-4" />
                    <span>Arbitrage Detection Active</span>
                </div>
                <div className="text-green-400"># Listening for profit opportunities...</div>
                <div className="text-blue-400"># [INFO] Pool XLM/USDC price discrepancy detected: 1.2%</div>
                <div className="text-slate-400"># Executing multi-hop swap...</div>
            </div>

            <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2 font-semibold text-slate-900 dark:text-white">
                    <History className="w-5 h-5" />
                    <h3>Recent Activity</h3>
                </div>
                <div className="space-y-2">
                    {loans.map((loan) => (
                        <div key={loan.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded border border-slate-100 dark:border-slate-700">
                            <div className="flex flex-col">
                                <span className="text-sm font-medium text-slate-900 dark:text-white">{loan.amount.toLocaleString()} XLM</span>
                                <span className="text-xs text-slate-500">{loan.time}</span>
                            </div>
                            <div className="text-right">
                                <div className="text-xs text-green-600 font-semibold mb-1">+{loan.fee} XLM Fee</div>
                                <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 text-[10px] rounded uppercase font-bold tracking-wider">
                                    {loan.status}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
                <button 
                    onClick={() => setLoans([{ id: `tx-${Date.now()}`, amount: 75000, fee: 375, status: 'Success', time: 'Just now' }, ...loans])}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors mt-4"
                >
                    Request Flash Loan (Simulation)
                </button>
            </div>
        </div>
    );
}
