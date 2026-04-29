'use client';

import React, { useState, useEffect } from 'react';

export default function MatchCard({ market }) {
    const [odds, setOdds] = useState([]);

    useEffect(() => {
        const fetchOdds = async () => {
            const res = await fetch(`/api/sports/markets/${market.id}/odds`);
            const data = await res.json();
            setOdds(data);
        };
        fetchOdds();

        // Simulate real-time updates via interval (since I don't have real WS setup here)
        const interval = setInterval(fetchOdds, 5000);
        return () => clearInterval(interval);
    }, [market.id]);

    return (
        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 hover:border-blue-500 transition-all group shadow-lg">
            <div className="flex justify-between items-start mb-4">
                <span className="px-3 py-1 bg-blue-500/10 text-blue-400 rounded-full text-xs font-medium uppercase">
                    Live Match
                </span>
                <span className="text-slate-500 text-xs">
                    Ends in {Math.floor((market.resolution_deadline - Date.now()/1000)/3600)}h
                </span>
            </div>
            
            <h3 className="text-xl font-bold mb-6 text-slate-100">{market.event_name}</h3>
            
            <div className="grid grid-cols-2 gap-4">
                {odds.map((outcome, index) => (
                    <button 
                        key={index}
                        className="p-4 bg-slate-900 rounded-xl border border-slate-700 hover:bg-slate-700 transition-colors flex flex-col items-center gap-1 group/btn"
                    >
                        <span className="text-slate-400 text-sm">{outcome.name}</span>
                        <span className="text-2xl font-mono text-blue-400 group-hover/btn:text-white">
                            {outcome.odds}
                        </span>
                    </button>
                ))}
            </div>

            <button className="w-full mt-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl font-bold hover:from-blue-500 hover:to-purple-500 transition-all shadow-lg shadow-blue-500/20">
                Place Bet
            </button>
        </div>
    );
}
