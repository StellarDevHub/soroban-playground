'use client';

import React, { useState, useEffect } from 'react';
import MatchCard from '@/components/sports/MatchCard';
import AnalyticsDashboard from '@/components/sports/AnalyticsDashboard';

export default function SportsPage() {
    const [markets, setMarkets] = useState([]);
    const [analytics, setAnalytics] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [marketsRes, analyticsRes] = await Promise.all([
                    fetch('/api/sports/markets'),
                    fetch('/api/sports/analytics')
                ]);
                const marketsData = await marketsRes.json();
                const analyticsData = await analyticsRes.json();
                setMarkets(marketsData);
                setAnalytics(analyticsData);
            } catch (error) {
                console.error('Error fetching sports data:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    if (loading) return <div className="p-8 text-center">Loading Sports Markets...</div>;

    return (
        <div className="container mx-auto p-6 space-y-8 bg-slate-900 text-white min-h-screen">
            <header className="flex justify-between items-center">
                <div>
                    <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                        Sports Prediction Market
                    </h1>
                    <p className="text-slate-400">Decentralized betting with live odds</p>
                </div>
                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                    <span className="text-sm text-slate-500 uppercase tracking-wider">Total Volume</span>
                    <p className="text-2xl font-mono text-green-400">${analytics?.total_volume_usdc?.toLocaleString()}</p>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                    <h2 className="text-2xl font-semibold">Active Matches</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {markets.map(market => (
                            <MatchCard key={market.id} market={market} />
                        ))}
                    </div>
                </div>
                
                <div className="space-y-6">
                    <h2 className="text-2xl font-semibold">Analytics & Activity</h2>
                    <AnalyticsDashboard analytics={analytics} />
                </div>
            </div>
        </div>
    );
}
