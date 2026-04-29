'use client';

import React, { useState } from 'react';
import { Upload, AlertCircle, CheckCircle2 } from 'lucide-react';

interface FileUploadFormProps {
  onUpload: (data: {
    fileId: string;
    totalSize: number;
    shardHashes: string[];
    redundancyFactor: number;
    owner?: string;
  }) => Promise<void>;
}

export default function FileUploadForm({ onUpload }: FileUploadFormProps) {
  const [fileId, setFileId] = useState('');
  const [totalSize, setTotalSize] = useState<number>(0);
  const [shardHashesText, setShardHashesText] = useState('');
  const [redundancyFactor, setRedundancyFactor] = useState<number>(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (!fileId || !totalSize || !shardHashesText) {
      setError('All fields are required');
      return;
    }
    const shardHashes = shardHashesText.split(',').map((s) => s.trim()).filter(Boolean);
    if (shardHashes.length === 0) {
      setError('At least one shard hash required');
      return;
    }
    setLoading(true);
    try {
      await onUpload({ fileId, totalSize, shardHashes, redundancyFactor });
      setSuccess(true);
      // Reset after delay
      setTimeout(() => {
        setFileId('');
        setTotalSize(0);
        setShardHashesText('');
        setRedundancyFactor(2);
        setSuccess(false);
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <h3 className="text-md font-semibold text-slate-200 mb-4 flex items-center gap-2">
        <Upload className="w-5 h-5 text-blue-400" />
        Upload File
      </h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">File ID (SHA-256 hash)</label>
          <input
            type="text"
            value={fileId}
            onChange={(e) => setFileId(e.target.value)}
            placeholder="C..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-500/50 outline-none transition"
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Total Size (bytes)</label>
          <input
            type="number"
            value={totalSize}
            onChange={(e) => setTotalSize(Number(e.target.value))}
            min={1}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-500/50 outline-none transition"
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Shard Hashes (comma-separated)</label>
          <textarea
            value={shardHashesText}
            onChange={(e) => setShardHashesText(e.target.value)}
            placeholder="hash1, hash2, hash3"
            rows={3}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-500/50 outline-none transition font-mono"
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Redundancy Factor (1-5)</label>
          <select
            value={redundancyFactor}
            onChange={(e) => setRedundancyFactor(Number(e.target.value))}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-500/50 outline-none transition"
            disabled={loading}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-medium transition-all flex items-center justify-center gap-2"
        >
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {loading ? 'Uploading...' : 'Upload File'}
        </button>

        {error && (
          <div className="flex items-center gap-2 text-rose-400 text-sm p-3 bg-rose-500/10 rounded-lg border border-rose-500/20">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
            <CheckCircle2 className="w-4 h-4" />
            Upload successful
          </div>
        )}
      </form>
    </div>
  );
}
