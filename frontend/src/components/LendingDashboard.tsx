import React, { useState } from 'react';
import { Landmark, TrendingUp, Wallet, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';

export default function LendingDashboard() {
    const [deposited, setDeposited] = useState(1000);
    const [borrowed, setBorrowed] = useState(400);

    const healthFactor = (deposited / (borrowed || 1) * 0.67).toFixed(2);
    const healthColor = Number(healthFactor) > 1.5 ? 'text-green-500' : Number(healthFactor) > 1.1 ? 'text-yellow-500' : 'text-red-500';

    return (
        <div className="p-6 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                        <Landmark className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Lending Protocol</h2>
                </div>
                <div className={`flex flex-col items-end`}>
                    <span className="text-sm text-slate-500 uppercase tracking-wider font-semibold">Health Factor</span>
                    <span className={`text-2xl font-mono font-bold ${healthColor}`}>{healthFactor}</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-slate-500 dark:text-slate-400">Total Deposited</span>
                        <TrendingUp className="w-4 h-4 text-green-500" />
                    </div>
                    <div className="text-3xl font-bold text-slate-900 dark:text-white">{deposited} XLM</div>
                    <div className="mt-4 flex gap-2">
                        <button onClick={() => setDeposited(d => d + 100)} className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg transition-colors">
                            <ArrowUpCircle className="w-4 h-4" /> Deposit
                        </button>
                    </div>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-slate-500 dark:text-slate-400">Total Borrowed</span>
                        <Wallet className="w-4 h-4 text-red-500" />
                    </div>
                    <div className="text-3xl font-bold text-slate-900 dark:text-white">{borrowed} XLM</div>
                    <div className="mt-4 flex gap-2">
                        <button onClick={() => setBorrowed(b => b + 50)} className="flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-lg transition-colors">
                            <ArrowDownCircle className="w-4 h-4" /> Borrow
                        </button>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                <h3 className="font-semibold text-slate-900 dark:text-white">Market Overview</h3>
                <div className="overflow-hidden rounded-lg border border-slate-100 dark:border-slate-700">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-800">
                            <tr>
                                <th className="p-3">Asset</th>
                                <th className="p-3 text-right">Supply APY</th>
                                <th className="p-3 text-right">Borrow APY</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            <tr>
                                <td className="p-3 font-medium">XLM</td>
                                <td className="p-3 text-right text-green-500">4.2%</td>
                                <td className="p-3 text-right text-red-500">6.8%</td>
                            </tr>
                            <tr>
                                <td className="p-3 font-medium">USDC</td>
                                <td className="p-3 text-right text-green-500">8.1%</td>
                                <td className="p-3 text-right text-red-500">11.4%</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
