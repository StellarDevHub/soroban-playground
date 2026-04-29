'use client';

import React, { useState } from 'react';
import { RefreshCw, CheckCircle2 } from 'lucide-react';

interface RebalanceButtonProps {
  fileId: string;
  onRebalance: (fileId: string) => Promise<void>;
}

export default function RebalanceButton({ fileId, onRebalance }: RebalanceButtonProps) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    setDone(false);
    try {
      await onRebalance(fileId);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading || done}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
        done
          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
          : 'bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30'
      }`}
    >
      {loading ? (
        <RefreshCw className="w-4 h-4 animate-spin" />
      ) : done ? (
        <CheckCircle2 className="w-4 h-4" />
      ) : (
        <RefreshCw className="w-4 h-4" />
      )}
      {done ? 'Rebalanced' : loading ? 'Rebalancing...' : 'Rebalance Shards'}
    </button>
  );
}
