'use client';

import React from 'react';
import { FileMetadata } from '@/lib/api/cloudStorage';

interface ShardMapProps {
  file: FileMetadata;
}

export default function ShardMap({ file }: ShardMapProps) {
  // Rows = shards, Columns = nodes that hold each shard
  // We'll display as grid: each cell shows node address truncated
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
      <h4 className="text-sm font-semibold text-slate-300 mb-3">Shard Distribution</h4>
      <div className="grid gap-2">
        {file.shards.map((shard) => (
          <div key={shard.shard_index} className="flex items-center gap-2 text-xs">
            <div className="w-16 text-slate-500 shrink-0">Shard {shard.shard_index}</div>
            <div className="flex-1 grid grid-cols-2 gap-2">
              {shard.nodes.map((node, idx) => (
                <div
                  key={idx}
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-300 truncate"
                  title={node}
                >
                  {node.slice(0, 10)}...
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
