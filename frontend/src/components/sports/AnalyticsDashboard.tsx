'use client';

import React from 'react';

export default function AnalyticsDashboard({ analytics }) {
    if (!analytics) return null;

    return (
        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl space-y-8">
            <div className="space-y-4">
                <h3 className="text-lg font-medium text-slate-300">Market Distribution</h3>
                <div className="h-4 bg-slate-900 rounded-full overflow-hidden flex">
                    <div className="h-full bg-blue-500 w-[60%]" title="Lakers vs Warriors"></div>
                    <div className="h-full bg-purple-500 w-[30%]" title="Real Madrid vs Barcelona"></div>
                    <div className="h-full bg-slate-600 w-[10%]" title="Others"></div>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                    <span>Basketball (60%)</span>
                    <span>Soccer (30%)</span>
                    <span>Others (10%)</span>
                </div>
            </div>

            <div className="space-y-4">
                <h3 className="text-lg font-medium text-slate-300">Recent Activity</h3>
                <div className="space-y-3">
                    {analytics.recent_activity.map((activity, i) => (
                        <div key={i} className="flex justify-between items-center p-3 bg-slate-900/50 rounded-lg border border-slate-700/50">
                            <div>
                                <p className="text-sm font-medium">{activity.outcome}</p>
                                <p className="text-xs text-slate-500">{activity.time}</p>
                            </div>
                            <span className="text-green-400 font-mono">+${activity.amount}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="pt-4 border-t border-slate-700">
                <div className="flex items-center gap-3 text-sm text-blue-400">
                    <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></div>
                    Live connection active
                </div>
            </div>
        </div>
    );
}
