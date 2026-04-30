'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivitySquare,
  AlertTriangle,
  BarChart3,
  Copy,
  Eye,
  EyeOff,
  Key,
  Plus,
  RefreshCw,
  Trash2,
  TrendingUp,
  Clock,
  CheckCircle,
  XCircle,
} from 'lucide-react';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ||
  'http://localhost:5000';

interface ApiKey {
  id: number;
  keyPrefix: string;
  name: string;
  description?: string;
  tier: 'free' | 'standard' | 'premium' | 'admin';
  status: 'active' | 'revoked' | 'expired';
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  usageCount: number;
  limits: {
    requestsPerMinute: number;
    requestsPerHour: number;
    requestsPerDay: number;
    burstLimit: number;
  };
}

interface UsageStats {
  dailyUsage: Array<{ date: string; requests: number }>;
  endpointUsage: Array<{ endpoint: string; requests: number }>;
  violations: Array<{ date: string; count: number }>;
  period: string;
}

interface GeneratedKey {
  id: number;
  key: string;
  keyPrefix: string;
  name: string;
  tier: string;
  status: string;
}

const TierColors = {
  free: 'bg-gray-100 text-gray-800',
  standard: 'bg-blue-100 text-blue-800',
  premium: 'bg-purple-100 text-purple-800',
  admin: 'bg-red-100 text-red-800',
};

export default function RateLimitsPage() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [selectedKey, setSelectedKey] = useState<ApiKey | null>(null);
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [showNewKeyForm, setShowNewKeyForm] = useState(false);
  const [showRevealedKey, setShowRevealedKey] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<GeneratedKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    tier: 'free' as const,
  });

  // Fetch API keys
  const fetchApiKeys = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const data = await response.json();
        setApiKeys(data.keys);
        if (data.keys.length > 0 && !selectedKey) {
          setSelectedKey(data.keys[0]);
        }
      }
    } catch (err) {
      setError('Failed to fetch API keys');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedKey]);

  // Fetch usage stats
  useEffect(() => {
    if (selectedKey) {
      const fetchUsageStats = async () => {
        try {
          const response = await fetch(
            `${API_BASE_URL}/api/admin/api-keys/${selectedKey.id}/usage?days=30`,
            {
              headers: { 'Content-Type': 'application/json' },
            }
          );
          if (response.ok) {
            const data = await response.json();
            setUsageStats(data);
          }
        } catch (err) {
          console.error('Failed to fetch usage stats:', err);
        }
      };
      fetchUsageStats();
    }
  }, [selectedKey]);

  // Load keys on mount
  useEffect(() => {
    fetchApiKeys();
  }, [fetchApiKeys]);

  // Generate new key
  const handleGenerateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        const data = await response.json();
        setGeneratedKey(data);
        setFormData({ name: '', description: '', tier: 'free' });
        fetchApiKeys();
      }
    } catch (err) {
      setError('Failed to generate API key');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Revoke key
  const handleRevokeKey = async (keyId: number) => {
    if (!confirm('Are you sure you want to revoke this API key?')) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/api-keys/${keyId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'user_revoked' }),
      });
      if (response.ok) {
        fetchApiKeys();
        if (selectedKey?.id === keyId) {
          setSelectedKey(null);
          setUsageStats(null);
        }
      }
    } catch (err) {
      setError('Failed to revoke API key');
      console.error(err);
    }
  };

  // Copy to clipboard
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold text-white flex items-center gap-3">
                <Key className="w-10 h-10 text-blue-400" />
                Rate Limiting Dashboard
              </h1>
              <p className="text-gray-400 mt-2">Manage API keys and monitor rate limit usage</p>
            </div>
            <button
              onClick={() => setShowNewKeyForm(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg transition"
            >
              <Plus className="w-5 h-5" />
              Generate API Key
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/50 border border-red-500 rounded-lg flex items-center gap-2 text-red-200">
            <AlertTriangle className="w-5 h-5" />
            {error}
          </div>
        )}

        {/* Generated Key Display */}
        {generatedKey && (
          <div className="mb-6 p-6 bg-green-900/30 border border-green-500/50 rounded-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-green-400 flex items-center gap-2">
                <CheckCircle className="w-5 h-5" />
                API Key Generated Successfully
              </h3>
              <button
                onClick={() => setGeneratedKey(null)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <p className="text-gray-300 mb-3 text-sm">
              Save this key securely. You won't be able to view it again!
            </p>
            <div className="bg-slate-800 p-4 rounded border border-green-500/30 flex items-center justify-between mb-4">
              <code className="text-green-400 font-mono text-sm break-all">{generatedKey.key}</code>
              <button
                onClick={() => handleCopy(generatedKey.key)}
                className="ml-4 p-2 hover:bg-slate-700 rounded transition"
              >
                <Copy className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-400">Name:</p>
                <p className="text-white font-mono">{generatedKey.name}</p>
              </div>
              <div>
                <p className="text-gray-400">Tier:</p>
                <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${TierColors[generatedKey.tier as keyof typeof TierColors]}`}>
                  {generatedKey.tier}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* New Key Form */}
        {showNewKeyForm && !generatedKey && (
          <div className="mb-6 p-6 bg-slate-800 border border-slate-700 rounded-lg">
            <h3 className="text-lg font-semibold text-white mb-4">Create New API Key</h3>
            <form onSubmit={handleGenerateKey} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Key Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My app key"
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Production API key for..."
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Tier</label>
                <select
                  value={formData.tier}
                  onChange={(e) => setFormData({ ...formData, tier: e.target.value as any })}
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="free">Free (10 req/min)</option>
                  <option value="standard">Standard (100 req/min)</option>
                  <option value="premium">Premium (1000 req/min)</option>
                  <option value="admin">Admin (10000 req/min)</option>
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white px-4 py-2 rounded transition"
                >
                  {loading ? 'Generating...' : 'Generate Key'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewKeyForm(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* API Keys List */}
          <div className="lg:col-span-1">
            <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
              <div className="p-4 border-b border-slate-700 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Key className="w-5 h-5 text-blue-400" />
                  API Keys
                </h2>
                <button
                  onClick={fetchApiKeys}
                  disabled={loading}
                  className="p-1 hover:bg-slate-700 rounded transition disabled:opacity-50"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {apiKeys.length === 0 ? (
                  <div className="p-4 text-center text-gray-400">
                    <p>No API keys yet</p>
                    <button
                      onClick={() => setShowNewKeyForm(true)}
                      className="text-blue-400 hover:text-blue-300 mt-2 text-sm"
                    >
                      Create one
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 p-4">
                    {apiKeys.map((key) => (
                      <button
                        key={key.id}
                        onClick={() => setSelectedKey(key)}
                        className={`w-full text-left p-3 rounded-lg transition ${
                          selectedKey?.id === key.id
                            ? 'bg-blue-600/20 border border-blue-500 '
                            : 'bg-slate-700/50 hover:bg-slate-700 border border-transparent'
                        }`}
                      >
                        <div className="font-mono text-sm text-gray-300">{key.keyPrefix}****</div>
                        <div className="text-xs text-gray-400 mt-1">{key.name}</div>
                        <div className="flex items-center gap-2 mt-2">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${TierColors[key.tier]}`}>
                            {key.tier}
                          </span>
                          <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                            key.status === 'active'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {key.status}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Key Details and Usage */}
          <div className="lg:col-span-2 space-y-6">
            {selectedKey ? (
              <>
                {/* Key Details */}
                <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-semibold text-white">{selectedKey.name}</h3>
                      {selectedKey.description && (
                        <p className="text-gray-400 text-sm mt-1">{selectedKey.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRevokeKey(selectedKey.id)}
                      className="p-2 hover:bg-red-600/20 rounded transition text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wide">Key Prefix</p>
                      <div className="flex items-center gap-2 mt-2">
                        <code className="font-mono text-sm text-gray-300">{selectedKey.keyPrefix}****</code>
                        <button
                          onClick={() => handleCopy(selectedKey.keyPrefix)}
                          className="p-1 hover:bg-slate-700 rounded transition"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wide">Tier</p>
                      <span className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-semibold ${TierColors[selectedKey.tier]}`}>
                        {selectedKey.tier}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wide">Status</p>
                      <p className="text-sm text-white mt-2 capitalize">{selectedKey.status}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wide">Created</p>
                      <p className="text-sm text-gray-300 mt-2">
                        {new Date(selectedKey.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Rate Limit Tiers */}
                <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <ActivitySquare className="w-5 h-5 text-green-400" />
                    Rate Limits
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-700/50 rounded p-4">
                      <p className="text-gray-400 text-xs uppercase tracking-wide">Per Minute</p>
                      <p className="text-2xl font-bold text-white mt-2">{selectedKey.limits.requestsPerMinute}</p>
                    </div>
                    <div className="bg-slate-700/50 rounded p-4">
                      <p className="text-gray-400 text-xs uppercase tracking-wide">Per Hour</p>
                      <p className="text-2xl font-bold text-white mt-2">{selectedKey.limits.requestsPerHour}</p>
                    </div>
                    <div className="bg-slate-700/50 rounded p-4">
                      <p className="text-gray-400 text-xs uppercase tracking-wide">Per Day</p>
                      <p className="text-2xl font-bold text-white mt-2">{selectedKey.limits.requestsPerDay}</p>
                    </div>
                    <div className="bg-slate-700/50 rounded p-4">
                      <p className="text-gray-400 text-xs uppercase tracking-wide">Burst Limit</p>
                      <p className="text-2xl font-bold text-white mt-2">{selectedKey.limits.burstLimit}</p>
                    </div>
                  </div>
                </div>

                {/* Usage Stats */}
                {usageStats && (
                  <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-purple-400" />
                      Usage (Last 30 Days)
                    </h3>

                    {/* Top Endpoints */}
                    <div className="mb-6">
                      <h4 className="text-sm font-semibold text-gray-300 mb-3">Top Endpoints</h4>
                      <div className="space-y-2">
                        {usageStats.endpointUsage.slice(0, 5).map((endpoint, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm">
                            <code className="text-gray-400 truncate">{endpoint.endpoint}</code>
                            <span className="text-white font-mono">{endpoint.requests}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Violations */}
                    {usageStats.violations.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-yellow-400 mb-3 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          Rate Limit Violations
                        </h4>
                        <div className="space-y-2">
                          {usageStats.violations.slice(0, 5).map((violation, idx) => (
                            <div key={idx} className="flex items-center justify-between text-sm">
                              <span className="text-gray-400">{new Date(violation.date).toLocaleDateString()}</span>
                              <span className="text-red-400 font-mono">{violation.count} violations</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="bg-slate-800 border border-slate-700 rounded-lg p-12 text-center">
                <Key className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400">Select an API key to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
