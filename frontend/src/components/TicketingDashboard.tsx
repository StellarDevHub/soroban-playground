'use client';

import React, { useState, useEffect } from 'react';
import { 
  Ticket, 
  Plus, 
  TrendingUp, 
  Users, 
  DollarSign, 
  CheckCircle, 
  Calendar,
  Lock,
  RefreshCw,
  BarChart3
} from 'lucide-react';
import { ticketingService } from '../services/ticketingService';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const GlassCard = ({ children, className = "" }: { children: React.ReactNode, className?: string }) => (
  <div className={`bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 ${className}`}>
    {children}
  </div>
);

export const TicketingDashboard = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'events' | 'tickets'>('overview');
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        const result = await ticketingService.getAnalytics('1');
        if (result.success) {
          setAnalytics(result.data);
        }
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();

    // WebSocket for real-time updates
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'ticketing-update') {
        fetchAnalytics(); // Refresh on any ticketing event
      }
    };

    return () => ws.close();
  }, []);


  const handleCheckIn = async (ticketId: string) => {
    try {
      const result = await ticketingService.checkIn({ 
        ticketId, 
        organizer: 'G...ORG' // Mock organizer
      });
      if (result.success) {
        // Refresh analytics
        const updated = await ticketingService.getAnalytics('1');
        setAnalytics(updated.data);
      }
    } catch (error) {
      alert('Check-in failed: ' + error.message);
    }
  };

  const stats = [
    { label: 'Tickets Sold', value: analytics?.totalSold || 0, icon: Ticket, color: 'text-blue-400' },
    { label: 'Revenue', value: `${analytics?.totalRevenue || 0} XLM`, icon: DollarSign, color: 'text-green-400' },
    { label: 'Attendance', value: `${analytics?.attendanceRate?.toFixed(1) || 0}%`, icon: Users, color: 'text-purple-400' },
    { label: 'Check-ins', value: analytics?.checkins || 0, icon: CheckCircle, color: 'text-orange-400' },
  ];

  const chartData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [
      {
        label: 'Sales Velocity',
        data: [12, 19, 15, 25, 22, 30],
        fill: true,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.4,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { display: false },
    },
    scales: {
      y: { display: false },
      x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.5)' } },
    },
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8 space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent">
            Event Horizon
          </h1>
          <p className="text-gray-400 mt-2">Decentralized Ticketing & Anti-Scalp Analytics</p>
        </div>
        <div className="flex gap-4">
          <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 transition-colors px-4 py-2 rounded-xl font-medium">
            <Plus size={20} />
            Create Event
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <GlassCard key={i} className="flex items-center gap-4 hover:border-white/20 transition-all cursor-default">
            <div className={`p-3 rounded-xl bg-white/5 ${stat.color}`}>
              <stat.icon size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-400">{stat.label}</p>
              <p className="text-2xl font-bold">{stat.value}</p>
            </div>
          </GlassCard>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Chart */}
        <GlassCard className="lg:col-span-2">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-semibold flex items-center gap-2">
              <BarChart3 size={20} className="text-blue-400" />
              Sales Performance
            </h3>
            <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-1 text-sm outline-none">
              <option>Last 30 Days</option>
              <option>Last 7 Days</option>
            </select>
          </div>
          <div className="h-[300px]">
            <Line data={chartData} options={chartOptions} />
          </div>
        </GlassCard>

        {/* Anti-Scalp Protection */}
        <GlassCard>
          <h3 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <Lock size={20} className="text-purple-400" />
            Security Guard
          </h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center p-3 rounded-xl bg-green-500/10 border border-green-500/20">
              <span className="text-sm text-green-400">Price Capping</span>
              <span className="text-xs font-bold bg-green-500 px-2 py-1 rounded text-black uppercase">Active</span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <span className="text-sm text-blue-400">Identity Verification</span>
              <span className="text-xs font-bold bg-blue-500 px-2 py-1 rounded text-black uppercase">Enabled</span>
            </div>
            <div className="pt-4 border-t border-white/10">
              <p className="text-sm text-gray-400 mb-4">Real-time secondary market monitoring active.</p>
              <div className="space-y-3">
                {[1, 2, 3].map((_, i) => (
                  <div key={i} className="flex items-center justify-between text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <RefreshCw size={12} />
                      Transfer detected
                    </span>
                    <span>2m ago</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Tabs */}
      <div className="flex gap-8 border-b border-white/10">
        {(['overview', 'events', 'tickets'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-4 px-2 capitalize transition-all relative ${
              activeTab === tab ? 'text-blue-400' : 'text-gray-500 hover:text-white'
            }`}
          >
            {tab}
            {activeTab === tab && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-400 rounded-t-full" />
            )}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full py-20 text-center text-gray-500">Loading metrics...</div>
        ) : (
          <>
            {/* Sample Event Card */}
            <GlassCard className="hover:scale-[1.02] transition-transform cursor-pointer group">
              <div className="h-40 -mx-6 -mt-6 bg-gradient-to-br from-blue-600 to-purple-600 rounded-t-2xl relative overflow-hidden mb-6">
                <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800')] bg-cover opacity-50 grayscale group-hover:grayscale-0 transition-all" />
                <div className="absolute bottom-4 left-4">
                  <span className="bg-white/20 backdrop-blur-md px-2 py-1 rounded text-xs">Live Concert</span>
                </div>
              </div>
              <h4 className="text-xl font-bold mb-2">Neon Nights 2024</h4>
              <div className="flex items-center gap-2 text-gray-400 text-sm mb-4">
                <Calendar size={14} />
                May 24, 2024 • London O2
              </div>
              <div className="flex justify-between items-center pt-4 border-t border-white/10">
                <div className="text-2xl font-bold">45 XLM</div>
                <button className="bg-white text-black px-4 py-2 rounded-lg font-bold hover:bg-blue-400 transition-colors">
                  Buy Ticket
                </button>
              </div>
            </GlassCard>
          </>
        )}
      </div>
    </div>
  );
};
