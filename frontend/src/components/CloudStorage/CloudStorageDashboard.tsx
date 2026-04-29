'use client';

import React, { useState } from 'react';
import { Cloud, HardDrive, Shield, Upload, FileText, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import FileUploadForm from './FileUploadForm';
import FileList from './FileList';
import NodeList from './NodeList';
import StorageMetrics from './StorageMetrics';
import { FileMetadata } from '@/lib/api/cloudStorage';

interface CloudStorageDashboardProps {
  // optional: initial data
}

export default function CloudStorageDashboard({}: CloudStorageDashboardProps) {
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [nodes, setNodes] = useState<{ address: string; capacityBytes: number; usedBytes: number }[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  const handleUpload = async (fileData: any) => {
    // fileData from form; we'll add to local list
    const newFile: FileMetadata = {
      owner: fileData.owner || '',
      file_id: fileData.fileId,
      total_size: fileData.totalSize,
      shard_count: fileData.shardHashes.length,
      redundancy_factor: fileData.redundancyFactor,
      shards: [],
      created_at: Date.now(),
      is_paused: false,
    } as FileMetadata;
    setFiles((prev) => [...prev, newFile]);
  };

  const handleDelete = (fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.file_id !== fileId));
    if (selectedFileId === fileId) setSelectedFileId(null);
  };

  const handleRebalance = async (fileId: string) => {
    // In a real app, would call API and refresh file data
    // Here just show a placeholder
    alert(`Rebalancing shards for ${fileId}`);
  };

  const handleRegisterNode = async (nodeAddress: string, capacity: number) => {
    setNodes((prev) => [...prev, { address: nodeAddress, capacityBytes: capacity, usedBytes: 0 }]);
  };

  const selectedFile = files.find((f) => f.file_id === selectedFileId) || null;

  return (
    <div className="space-y-6 p-6">
      <StorageMetrics files={files} nodes={nodes} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <FileUploadForm onUpload={handleUpload} />
          <FileList files={files} onSelect={setSelectedFileId} onDelete={handleDelete} selectedFileId={selectedFileId} />
        </div>
        <div className="space-y-6">
          {selectedFile ? (
            <div>
              <h3 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Shard Map for {selectedFile.file_id.slice(0, 12)}...
              </h3>
              <ShardMap file={selectedFile} />
              <div className="mt-4">
                <RebalanceButton fileId={selectedFile.file_id} onRebalance={handleRebalance} />
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-500">
              Select a file to view shard distribution
            </div>
          )}
          <NodeList nodes={nodes} onRegister={handleRegisterNode} />
        </div>
      </div>
    </div>
  );
}
