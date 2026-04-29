'use client';

import React from 'react';
import { FileText, HardDrive, Shield, Database } from 'lucide-react';
import { FileMetadata } from '@/lib/api/cloudStorage';

interface StorageMetricsProps {
  files: FileMetadata[];
  nodes: { address: string; capacityBytes: number; usedBytes: number }[];
}

export default function StorageMetrics({ files, nodes }: StorageMetricsProps) {
  const totalSize = files.reduce((sum, f) => sum + f.total_size, 0);
  const totalShards = files.reduce((sum, f) => sum + f.shard_count, 0);
  const avgRedundancy = files.length ? files.reduce((sum, f) => sum + f.redundancy_factor, 0) / files.length : 0;
  const nodeCount = nodes.length;
  const totalCapacity = nodes.reduce((sum, n) => sum + n.capacityBytes, 0);
  const usedCapacity = nodes.reduce((sum, n) => sum + n.usedBytes, 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-500">Total Files</div>
            <div className="text-xl font-bold text-slate-100">{files.length}</div>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-400">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-500">Storage Used</div>
            <div className="text-xl font-bold text-slate-100">{(totalSize / 1024 / 1024).toFixed(2)} MB</div>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-500/20 rounded-lg text-orange-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-500">Redundancy Health</div>
            <div className="text-xl font-bold text-slate-100">{avgRedundancy.toFixed(1)}x</div>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-500">Active Nodes</div>
            <div className="text-xl font-bold text-slate-100">{nodeCount}</div>
            <div className="text-xs text-slate-500">{(totalCapacity / 1024 / 1024).toFixed(1)} MB total</div>
          </div>
        </div>
      </div>
    </div>
  );
}
