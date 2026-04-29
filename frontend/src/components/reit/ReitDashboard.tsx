'use client';

import React, { useState, useEffect } from 'react';
import { reitApi, PropertyStats, ReitConfig } from '@/services/reitService';
import { Card } from './Card';
import { LoadingSpinner } from './LoadingSpinner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

interface ReitDashboardProps {
  contractId: string;
}

export function ReitDashboard({ contractId }: ReitDashboardProps) {
  const [stats, setStats] = useState<PropertyStats | null>(null);
  const [config, setConfig] = useState<ReitConfig | null>(null);
  const [performance, setPerformance] = useState<any>(null);
  const [yieldData, setYieldData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, [contractId]);

  const loadDashboardData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [dashboardData, yieldAnalytics] = await Promise.all([
        reitApi.getDashboardData(contractId),
        reitApi.getYieldAnalytics(contractId),
      ]);

      setConfig(dashboardData.reit_info);
      setStats(dashboardData.property_stats);
      setPerformance(dashboardData.performance_30d);
      setYieldData(yieldAnalytics);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <p className="text-red-600">{error}</p>
        <button
          onClick={loadDashboardData}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Retry
        </button>
      </Card>
    );
  }

  const propertyStatusData = stats ? [
    { name: 'Listed', value: stats.listed_count || 0, fill: '#3b82f6' },
    { name: 'Funded', value: stats.funded_count || 0, fill: '#f59e0b' },
    { name: 'Active', value: stats.active_count || 0, fill: '#10b981' },
  ] : [];

  const yieldComparisonData = yieldData.map(y => ({
    name: y.name.substring(0, 15) + (y.name.length > 15 ? '...' : ''),
    target: y.target_yield_bps / 100,
    actual: y.actual_yield_bps / 100,
  }));

  return (
    <div className="space-y-6">
      {/* Performance Metrics */}
      {performance && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MetricCard
            label="New Investors (30d)"
            value={performance.new_investors || 0}
            change="+12%"
          />
          <MetricCard
            label="Total Invested (30d)"
            value={`${((performance.total_invested || 0) / 10000000).toFixed(2)} XLM`}
            change="+8.5%"
          />
          <MetricCard
            label="Dividends Paid (30d)"
            value={`${((performance.total_dividends || 0) / 10000000).toFixed(2)} XLM`}
            change="+15.2%"
          />
          <MetricCard
            label="Transactions (30d)"
            value={performance.total_transactions || 0}
            change="+5.3%"
          />
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Property Status Distribution */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Property Status Distribution</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={propertyStatusData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Yield Comparison */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Target vs Actual Yield (%)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={yieldComparisonData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={60} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="target" fill="#3b82f6" name="Target" radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual" fill="#10b981" name="Actual" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* REIT Information */}
      {config && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">REIT Configuration</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Platform Fee</p>
              <p className="font-medium">{(config.platform_fee_bps / 100).toFixed(2)}%</p>
            </div>
            <div>
              <p className="text-gray-500">Min Investment</p>
              <p className="font-medium">{(config.min_investment / 10000000).toFixed(2)} XLM</p>
            </div>
            <div>
              <p className="text-gray-500">Max per Property</p>
              <p className="font-medium">{(config.max_investment_per_property / 10000000).toFixed(0)} XLM</p>
            </div>
            <div>
              <p className="text-gray-500">Status</p>
              <p className={`font-medium ${config.is_paused ? 'text-red-600' : 'text-green-600'}`}>
                {config.is_paused ? 'Paused' : 'Active'}
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: string | number;
  change: string;
}

function MetricCard({ label, value, change }: MetricCardProps) {
  const isPositive = change.startsWith('+');
  return (
    <Card className="p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      <p className={`text-sm mt-1 ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
        {change}
      </p>
    </Card>
  );
}
