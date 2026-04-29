'use client';

import React from 'react';
import { FileText } from 'lucide-react';
import { FileMetadata } from '@/lib/api/cloudStorage';
import ShardMap from './ShardMap';
import RebalanceButton from './RebalanceButton';

interface FileDetailsProps {
  file: FileMetadata;
  onRebalance: (fileId: string) => Promise<void>;
}

export default function FileDetails({ file, onRebalance }: FileDetailsProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-400" />
            File Details
          </h3>
          <div className="mt-2 space-y-1 text-sm">
            <div><span className="text-slate-500">File ID:</span> <span className="font-mono text-slate-300">{file.file_id}</span></div>
            <div><span className="text-slate-500">Owner:</span> <span className="font-mono text-slate-300">{file.owner}</span></div>
            <div><span className="text-slate-500">Size:</span> <span className="text-slate-300">{file.total_size.toLocaleString()} bytes</span></div>
            <div><span className="text-slate-500">Shards:</span> <span className="text-slate-300">{file.shard_count}</span></div>
            <div><span className="text-slate-500">Redundancy:</span> <span className="text-slate-300">{file.redundancy_factor}</span></div>
            <div><span className="text-slate-500">Created:</span> <span className="text-slate-300">{new Date(file.created_at * 1000).toLocaleString()}</span></div>
          </div>
        </div>
        <RebalanceButton fileId={file.file_id} onRebalance={onRebalance} />
      </div>
      <ShardMap file={file} />
    </div>
  );
}
