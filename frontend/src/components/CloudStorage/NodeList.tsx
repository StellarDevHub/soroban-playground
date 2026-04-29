'use client';

import React, { useState } from 'react';
import { Server, Plus } from 'lucide-react';

interface NodeListProps {
  nodes: { address: string; capacityBytes: number; usedBytes: number }[];
  onRegister: (address: string, capacity: number) => void;
}

export default function NodeList({ nodes, onRegister }: NodeListProps) {
  const [address, setAddress] = useState('');
  const [capacity, setCapacity] = useState<number>(1024 * 1024); // default 1MB
  const [adding, setAdding] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) return;
    setAdding(true);
    try {
      await onRegister(address, capacity);
      setAddress('');
    } catch (err) {
      console.error(err);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <h3 className="text-md font-semibold text-slate-200 mb-4 flex items-center gap-2">
        <Server className="w-5 h-5 text-purple-400" />
        Storage Nodes
      </h3>
      <div className="space-y-3">
        {nodes.length === 0 ? (
          <p className="text-sm text-slate-500">No nodes registered.</p>
        ) : (
          nodes.map((node) => {
            const usedPct = (node.usedBytes / node.capacityBytes) * 100;
            return (
              <div key={node.address} className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-mono text-slate-300">{node.address.slice(0, 12)}...</span>
                  <span className="text-slate-500">{((node.usedBytes) / 1024).toFixed(1)} KB / {(node.capacityBytes / 1024).toFixed(1)} KB</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 transition-all"
                    style={{ width: `${Math.min(usedPct, 100)}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={handleAdd} className="mt-4 flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-xs text-slate-500 mb-1">Node Address</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="G..."
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-sm text-slate-200 focus:border-purple-500/50 outline-none"
          />
        </div>
        <div className="w-32">
          <label className="block text-xs text-slate-500 mb-1">Capacity (bytes)</label>
          <input
            type="number"
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
            min={1}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-sm text-slate-200 focus:border-purple-500/50 outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={adding || !address}
          className="px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded text-sm"
        >
          <Plus size={16} />
        </button>
      </form>
    </div>
  );
}
