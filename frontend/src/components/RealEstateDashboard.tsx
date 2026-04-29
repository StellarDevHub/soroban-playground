'use client';

import React, { useState, useEffect } from 'react';
import { 
  Home, 
  PieChart, 
  DollarSign, 
  Users, 
  ArrowUpRight, 
  Plus, 
  Wallet,
  TrendingUp,
  MapPin,
  Clock,
  ShieldCheck
} from 'lucide-react';
import { realEstateService } from '../services/realEstateService';
import { Doughnut, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement
} from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

const GlassCard = ({ children, className = "" }: { children: React.ReactNode, className?: string }) => (
  <div className={`bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 ${className}`}>
    {children}
  </div>
);

export const RealEstateDashboard = () => {
  const [activeView, setActiveView] = useState<'market' | 'portfolio'>('market');
  const [portfolio, setPortfolio] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchPortfolio = async () => {
      try {
        setLoading(true);
        // Using mock address for demo
        const result = await realEstateService.getPortfolio('G...USER');
        if (result.success) setPortfolio(result.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchPortfolio();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'real-estate-update') fetchPortfolio();
    };
    return () => ws.close();
  }, []);

  const portfolioData = {
    labels: ['Luxury Villa', 'NYC Condo', 'Berlin Flat'],
    datasets: [{
      data: [300, 50, 100],
      backgroundColor: ['#3b82f6', '#8b5cf6', '#ec4899'],
      borderWidth: 0,
    }]
  };

  const revenueData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [{
      label: 'Monthly Yield',
      data: [400, 450, 420, 500, 550, 600],
      backgroundColor: 'rgba(59, 130, 246, 0.5)',
      borderRadius: 10,
    }]
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white p-8 space-y-10">
      {/* Navigation & Brand */}
      <nav className="flex justify-between items-center bg-white/5 backdrop-blur-md px-8 py-4 rounded-full border border-white/10">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Home size={24} className="text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight">BrickLayer</span>
        </div>
        <div className="flex gap-8">
          <button onClick={() => setActiveView('market')} className={`font-medium ${activeView === 'market' ? 'text-blue-400' : 'text-gray-400'}`}>Marketplace</button>
          <button onClick={() => setActiveView('portfolio')} className={`font-medium ${activeView === 'portfolio' ? 'text-blue-400' : 'text-gray-400'}`}>My Portfolio</button>
        </div>
        <button className="flex items-center gap-2 bg-white text-black px-6 py-2 rounded-full font-bold hover:bg-blue-400 transition-all">
          <Wallet size={18} />
          Connect Wallet
        </button>
      </nav>

      {/* Hero Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <GlassCard className="col-span-1 lg:col-span-2 flex flex-col justify-between">
          <div>
            <h2 className="text-4xl font-bold mb-2">Portfolio Value</h2>
            <p className="text-gray-400">Total assets under management</p>
          </div>
          <div className="flex items-end justify-between mt-8">
            <div className="text-5xl font-black">$2.4M</div>
            <div className="flex items-center gap-1 text-green-400 font-bold bg-green-400/10 px-3 py-1 rounded-full text-sm">
              <ArrowUpRight size={16} />
              +12.4%
            </div>
          </div>
        </GlassCard>

        <GlassCard className="flex flex-col items-center justify-center gap-4">
          <div className="w-32 h-32">
            <Doughnut data={portfolioData} options={{ plugins: { legend: { display: false } } }} />
          </div>
          <p className="text-sm font-medium text-gray-400 uppercase tracking-widest">Asset Allocation</p>
        </GlassCard>

        <GlassCard className="flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div className="bg-purple-500/10 p-3 rounded-2xl text-purple-400">
              <DollarSign size={24} />
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-400">Next Distribution</p>
              <p className="font-bold text-lg">In 12 Days</p>
            </div>
          </div>
          <div className="mt-8">
            <p className="text-gray-400 text-sm">Estimated Income</p>
            <p className="text-3xl font-bold">$1,240.00</p>
          </div>
        </GlassCard>
      </div>

      {/* Content Area */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
        <div className="xl:col-span-2 space-y-8">
          <div className="flex justify-between items-center">
            <h3 className="text-2xl font-bold">Featured Properties</h3>
            <div className="flex gap-2">
              <button className="p-2 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10"><Clock size={20} /></button>
              <button className="p-2 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10"><TrendingUp size={20} /></button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[1, 2].map((i) => (
              <GlassCard key={i} className="p-0 overflow-hidden group hover:border-blue-500/50 transition-all duration-500">
                <div className="relative h-64">
                  <img 
                    src={`https://images.unsplash.com/photo-${i === 1 ? '1613490493576-7fde63acd811' : '1512917774080-9991f1c4c750'}?w=800`} 
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                    alt="Property"
                  />
                  <div className="absolute top-4 left-4 bg-black/40 backdrop-blur-md px-3 py-1 rounded-full text-xs font-bold border border-white/10 flex items-center gap-2">
                    <ShieldCheck size={14} className="text-blue-400" />
                    Verified Asset
                  </div>
                  <div className="absolute bottom-0 inset-x-0 h-1/2 bg-gradient-to-t from-black to-transparent" />
                  <div className="absolute bottom-4 left-6">
                    <h4 className="text-xl font-bold">Aurelius Luxury {i === 1 ? 'Condo' : 'Estate'}</h4>
                    <p className="text-gray-300 text-sm flex items-center gap-1"><MapPin size={12} /> Miami, Florida</p>
                  </div>
                </div>
                <div className="p-6 space-y-6">
                  <div className="flex justify-between text-sm">
                    <div className="space-y-1">
                      <p className="text-gray-400">Share Price</p>
                      <p className="font-bold text-lg">$1,250.00</p>
                    </div>
                    <div className="space-y-1 text-right">
                      <p className="text-gray-400">Annual Yield</p>
                      <p className="font-bold text-lg text-green-400">8.4%</p>
                    </div>
                  </div>
                  <div className="bg-white/5 rounded-2xl p-4">
                    <div className="flex justify-between text-xs text-gray-400 mb-2">
                      <span>Funding Progress</span>
                      <span>{i === 1 ? '75' : '42'}% Funded</span>
                    </div>
                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                      <div className={`h-full bg-blue-600 rounded-full`} style={{ width: i === 1 ? '75%' : '42%' }} />
                    </div>
                  </div>
                  <button className="w-full py-4 bg-white text-black rounded-2xl font-black uppercase tracking-tighter hover:bg-blue-400 transition-all">
                    Invest Now
                  </button>
                </div>
              </GlassCard>
            ))}
          </div>
        </div>

        <div className="space-y-8">
          <h3 className="text-2xl font-bold">Yield History</h3>
          <GlassCard className="h-[400px]">
            <Bar data={revenueData} options={{ 
              responsive: true, 
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: { 
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.5)' } },
                x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.5)' } }
              }
            }} />
          </GlassCard>

          <h3 className="text-2xl font-bold">Market Activity</h3>
          <GlassCard className="space-y-6">
            {[1, 2, 3].map((_, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-blue-400">
                    <Users size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">New Investment</p>
                    <p className="text-xs text-gray-500">G...X24 invested $5,000</p>
                  </div>
                </div>
                <span className="text-xs text-gray-600">2m ago</span>
              </div>
            ))}
          </GlassCard>
        </div>
      </div>
    </div>
  );
};
