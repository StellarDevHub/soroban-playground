'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  BarChart3, 
  ShieldCheck, 
  Activity, 
  Users, 
  Settings, 
  AlertTriangle,
  Save,
  X,
  Download,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  BarElement,
} from 'chart.js';
import { Line, Pie, Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

export default function AdminDashboard() {
  const [analytics, setAnalytics] = useState<any>(null);
  const [config, setConfig] = useState<any>({});
  const [isSaving, setIsSaving] = useState(false);
  const [notification, setNotification] = useState<{type: 'success' | 'error', message: string} | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    // Fetch initial config
    fetch('http://localhost:5000/api/admin/rate-limits')
      .then(res => res.json())
      .then(data => {
        setConfig(data.config || {});
      })
      .catch(err => console.error('Failed to fetch config:', err));

    // WebSocket for real-time analytics
    const ws = new WebSocket('ws://localhost:5000/ws');
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'rate-limit-analytics') {
        setAnalytics(data);
        setHistory(prev => [...prev.slice(-29), {
          time: new Date().toLocaleTimeString(),
          hits: Object.values(data.stats).reduce((acc: any, curr: any) => acc + (parseInt(curr.allowed || '0', 10)), 0)
        }]);
      }
    };

    return () => ws.close();
  }, []);

  const handleUpdateLimit = async (endpoint: string, limit: number) => {
    setIsSaving(true);
    try {
      const res = await fetch('http://localhost:5000/api/admin/rate-limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, limit })
      });
      const data = await res.json();
      if (data.success) {
        setNotification({ type: 'success', message: `Updated ${endpoint} limit to ${limit}` });
        setConfig({ ...config, [endpoint]: limit });
      } else {
        setNotification({ type: 'error', message: data.error || 'Failed to update' });
      }
    } catch (err) {
      setNotification({ type: 'error', message: 'Network error' });
    } finally {
      setIsSaving(false);
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const lineData = {
    labels: history.map(h => h.time),
    datasets: [
      {
        label: 'Requests per Minute',
        data: history.map(h => h.hits),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.4,
        fill: true,
      },
    ],
  };

  const pieData = {
    labels: ['Compile', 'Invoke', 'Deploy', 'Global'],
    datasets: [
      {
        data: [
          parseInt(analytics?.stats?.compile?.allowed || '0', 10),
          parseInt(analytics?.stats?.invoke?.allowed || '0', 10),
          parseInt(analytics?.stats?.deploy?.allowed || '0', 10),
          parseInt(analytics?.stats?.global?.allowed || '0', 10),
        ],
        backgroundColor: ['#ef4444', '#10b981', '#f59e0b', '#6366f1'],
      },
    ],
  };

  const exportCSV = () => {
    if (!analytics) return;
    const rows = [
      ['Type', 'Allowed', 'Blocked'],
      ['Compile', analytics.stats.compile.allowed, analytics.stats.compile.blocked],
      ['Invoke', analytics.stats.invoke.allowed, analytics.stats.invoke.blocked],
      ['Deploy', analytics.stats.deploy.allowed, analytics.stats.deploy.blocked],
      ['Global', analytics.stats.global.allowed, analytics.stats.global.blocked],
    ];
    const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "rate_limit_analytics.csv");
    document.body.appendChild(link);
    link.click();
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <ShieldCheck className="text-primary-500 w-8 h-8" />
            Admin Rate Limit Dashboard
          </h1>
          <p className="text-gray-400 mt-2">Manage distributed rate limits and monitor real-time traffic.</p>
        </div>
        <button 
          onClick={exportCSV}
          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg transition-colors border border-gray-700"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {notification && (
        <div className={`flex items-center gap-3 p-4 rounded-xl border ${notification.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' : 'bg-red-500/10 border-red-500/50 text-red-400'} animate-in fade-in slide-in-from-top-4`}>
          {notification.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          {notification.message}
        </div>
      )}

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: 'Total Hits', value: history.reduce((a, b) => a + b.hits, 0), icon: Activity, color: 'text-blue-400' },
          { label: 'Redis Status', value: analytics ? (analytics.fallback ? 'FALLBACK' : 'CONNECTED') : 'PENDING', icon: BarChart3, color: analytics?.fallback ? 'text-orange-400' : 'text-emerald-400' },
          { label: 'Active IPs', value: analytics?.topIps?.length / 2 || 0, icon: Users, color: 'text-purple-400' },
          { label: 'Blocked Requests', value: Object.values(analytics?.stats || {}).reduce((a: any, b: any) => a + parseInt(b.blocked || '0', 10), 0), icon: AlertTriangle, color: 'text-red-400' },
        ].map((stat, i) => (
          <div key={i} className="bg-gray-900/50 border border-gray-800 p-6 rounded-2xl">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm text-gray-400 font-medium">{stat.label}</p>
                <h3 className="text-2xl font-bold mt-1">{stat.value}</h3>
              </div>
              <stat.icon className={`${stat.color} w-6 h-6`} />
            </div>
          </div>
        ))}
      </div>

      {/* Main Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-gray-900/50 border border-gray-800 p-6 rounded-2xl">
          <h3 className="text-lg font-semibold mb-6">Traffic Real-time (RPM)</h3>
          <div className="h-[300px]">
            <Line data={lineData} options={{ maintainAspectRatio: false, scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } } } }} />
          </div>
        </div>
        <div className="bg-gray-900/50 border border-gray-800 p-6 rounded-2xl">
          <h3 className="text-lg font-semibold mb-6">Endpoint Usage</h3>
          <div className="h-[300px] flex items-center justify-center">
            <Pie data={pieData} options={{ maintainAspectRatio: false }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Configuration Panel */}
        <div className="bg-gray-900/50 border border-gray-800 p-6 rounded-2xl space-y-6">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Settings className="w-5 h-5" /> Dynamic Configuration
          </h3>
          <div className="space-y-6">
            {['compile', 'invoke', 'deploy', 'global'].map(endpoint => (
              <div key={endpoint} className="space-y-3">
                <div className="flex justify-between">
                  <span className="capitalize font-medium text-gray-300">{endpoint} Limit</span>
                  <span className="text-primary-400 font-bold">{config[endpoint] || 10} / hr</span>
                </div>
                <input 
                  type="range" 
                  min="1" 
                  max="500" 
                  value={config[endpoint] || 10}
                  onChange={(e) => setConfig({ ...config, [endpoint]: parseInt(e.target.value) })}
                  className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-primary-500"
                />
                <div className="flex justify-end">
                  <button 
                    onClick={() => handleUpdateLimit(endpoint, config[endpoint])}
                    disabled={isSaving}
                    className="text-xs bg-primary-600 hover:bg-primary-500 disabled:opacity-50 px-3 py-1 rounded transition-colors"
                  >
                    Apply Change
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top IPs Table */}
        <div className="bg-gray-900/50 border border-gray-800 p-6 rounded-2xl">
          <h3 className="text-lg font-semibold mb-6">Top Requests by IP</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-gray-500 text-sm border-b border-gray-800">
                  <th className="pb-3 font-medium">IP Address</th>
                  <th className="pb-3 font-medium">Request Count</th>
                  <th className="pb-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {analytics?.topIps && Array.from({length: analytics.topIps.length / 2}).map((_, i) => (
                  <tr key={i} className="text-sm">
                    <td className="py-4 font-mono text-gray-300">{analytics.topIps[i*2]}</td>
                    <td className="py-4 font-bold">{analytics.topIps[i*2+1]}</td>
                    <td className="py-4 text-emerald-400 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      Active
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
