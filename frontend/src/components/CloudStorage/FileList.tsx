'use client';

import React from 'react';
import { FileText, Trash2, Eye, CheckCircle2, XCircle } from 'lucide-react';
import { FileMetadata } from '@/lib/api/cloudStorage';

interface FileListProps {
  files: FileMetadata[];
  onSelect: (fileId: string) => void;
  onDelete: (fileId: string) => void;
  selectedFileId: string | null;
}

export default function FileList({ files, onSelect, onDelete, selectedFileId }: FileListProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800">
        <h3 className="text-md font-semibold text-slate-200 flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-400" />
          Your Files
        </h3>
      </div>
      {files.length === 0 ? (
        <div className="p-8 text-center text-slate-500">
          No files uploaded yet.
        </div>
      ) : (
        <div className="divide-y divide-slate-800">
          {files.map((file) => (
            <div
              key={file.file_id}
              onClick={() => onSelect(file.file_id)}
              className={`p-4 flex items-center justify-between cursor-pointer transition-colors ${
                selectedFileId === file.file_id ? 'bg-blue-500/10 border-l-4 border-l-blue-500' : 'hover:bg-slate-800/50 border-l-4 border-l-transparent'
              }`}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="p-2 bg-slate-800 rounded-lg">
                  <FileText className="w-5 h-5 text-blue-400" />
                </div>
                <div className="min-w-0">
                  <div className="font-mono text-sm text-slate-200 truncate" title={file.file_id}>
                    {file.file_id}
                  </div>
                  <div className="text-xs text-slate-500">
                    {file.total_size.toLocaleString()} bytes • {file.shard_count} shards × {file.redundancy_factor} redundancy
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs flex items-center gap-1">
                  <CheckCircle2 size={12} /> Verified
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(file.file_id); }}
                  className="p-2 text-slate-400 hover:text-rose-400 transition"
                  aria-label="Delete file"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
