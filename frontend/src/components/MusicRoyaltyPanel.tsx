import React, { useState } from 'react';
import { Music, Users, BarChart3, CreditCard, Play, Plus } from 'lucide-react';

export default function MusicRoyaltyPanel() {
    const [songs] = useState([
        { id: '1', title: 'Stellar Harmony', streams: '1.2M', earned: '1,450', artist: 'Space Ghost' },
        { id: '2', title: 'Soroban Beats', streams: '450K', earned: '620', artist: 'Rust Master' },
    ]);

    return (
        <div className="p-6 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-pink-100 dark:bg-pink-900/30 rounded-lg">
                        <Music className="w-6 h-6 text-pink-600 dark:text-pink-400" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Music Royalties</h2>
                </div>
                <button className="flex items-center gap-2 bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
                    <Plus className="w-4 h-4" /> Register Song
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700 flex justify-between items-center">
                    <div>
                        <div className="text-sm text-slate-500">Total Revenue</div>
                        <div className="text-2xl font-bold text-slate-900 dark:text-white">2,070 XLM</div>
                    </div>
                    <BarChart3 className="w-8 h-8 text-blue-500 opacity-50" />
                </div>
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700 flex justify-between items-center">
                    <div>
                        <div className="text-sm text-slate-500">Active Rights</div>
                        <div className="text-2xl font-bold text-slate-900 dark:text-white">14 Holders</div>
                    </div>
                    <Users className="w-8 h-8 text-purple-500 opacity-50" />
                </div>
            </div>

            <div className="space-y-4">
                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <Play className="w-4 h-4" /> Artist Dashboard
                </h3>
                <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="bg-slate-50 dark:bg-slate-800 p-3 grid grid-cols-4 text-xs font-bold text-slate-500 uppercase tracking-wider">
                        <div className="col-span-2">Track Info</div>
                        <div className="text-center">Streams</div>
                        <div className="text-right">Earnings</div>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {songs.map((song) => (
                            <div key={song.id} className="p-4 grid grid-cols-4 items-center bg-white dark:bg-slate-900">
                                <div className="col-span-2">
                                    <div className="font-bold text-slate-900 dark:text-white">{song.title}</div>
                                    <div className="text-sm text-slate-500">{song.artist}</div>
                                </div>
                                <div className="text-center font-mono text-slate-600 dark:text-slate-400">
                                    {song.streams}
                                </div>
                                <div className="text-right">
                                    <div className="font-bold text-green-600">{song.earned} XLM</div>
                                    <button className="text-[10px] text-blue-500 hover:underline flex items-center gap-1 justify-end ml-auto">
                                        <CreditCard className="w-3 h-3" /> Withdraw
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800/50">
                <div className="text-sm text-blue-800 dark:text-blue-300 font-medium mb-1">Royalty Split Logic</div>
                <div className="text-xs text-blue-600 dark:text-blue-400">
                    This contract automatically distributes incoming streaming revenue to all rights holders based on their defined percentage share.
                </div>
            </div>
        </div>
    );
}
