import React, { useState, useCallback } from 'react';
import { Cloud, HardDrive, Shield, Share2, Upload, FileText, CheckCircle2, X, Plus } from 'lucide-react';
import { useCloudStorage } from '@/hooks/useCloudStorage';

export default function CloudStoragePanel() {
    const { files, metrics, loading, error, uploadFile, grantAccess, revokeAccess } = useCloudStorage();
    const [dragOver, setDragOver] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [redundancyLevel, setRedundancyLevel] = useState(3);
    const [accessUser, setAccessUser] = useState('');
    const [selectedFileForAccess, setSelectedFileForAccess] = useState<string | null>(null);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length > 0) {
            setSelectedFile(droppedFiles[0]);
        }
    }, []);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            setSelectedFile(files[0]);
        }
    }, []);

    const handleUpload = useCallback(async () => {
        if (selectedFile) {
            await uploadFile(selectedFile, redundancyLevel);
            setSelectedFile(null);
        }
    }, [selectedFile, redundancyLevel, uploadFile]);

    const handleGrantAccess = useCallback(async (cid: string) => {
        if (accessUser) {
            await grantAccess(cid, accessUser);
            setAccessUser('');
            setSelectedFileForAccess(null);
        }
    }, [accessUser, grantAccess]);

    const handleRevokeAccess = useCallback(async (cid: string) => {
        if (accessUser) {
            await revokeAccess(cid, accessUser);
            setAccessUser('');
            setSelectedFileForAccess(null);
        }
    }, [accessUser, revokeAccess]);

    return (
        <div className="p-6 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                    <Cloud className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Decentralized Cloud Storage</h2>
            </div>

            {error && (
                <div className="mb-4 rounded border border-red-500/40 bg-red-500/20 p-4 text-red-300">
                    Error: {error}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                    <HardDrive className="w-10 h-10 text-slate-400" />
                    <div>
                        <div className="text-sm text-slate-500">Total Capacity</div>
                        <div className="text-xl font-bold text-slate-900 dark:text-white">{(metrics.totalCapacity / 1024 / 1024 / 1024).toFixed(2)} GB</div>
                    </div>
                </div>
                <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                    <Shield className="w-10 h-10 text-green-500" />
                    <div>
                        <div className="text-sm text-slate-500">Used Capacity</div>
                        <div className="text-xl font-bold text-slate-900 dark:text-white">{(metrics.usedCapacity / 1024 / 1024 / 1024).toFixed(2)} GB</div>
                    </div>
                </div>
                <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                    <Share2 className="w-10 h-10 text-purple-500" />
                    <div>
                        <div className="text-sm text-slate-500">Active Offers</div>
                        <div className="text-xl font-bold text-slate-900 dark:text-white">{metrics.activeOffers}</div>
                    </div>
                </div>
            </div>

            <div className="mb-6">
                <div
                    className={`w-full py-8 border-2 border-dashed rounded-xl text-center transition-all flex flex-col items-center gap-2 ${
                        dragOver
                            ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/10'
                            : 'border-slate-300 dark:border-slate-700 hover:border-blue-400'
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    {selectedFile ? (
                        <div className="text-center">
                            <FileText className="w-8 h-8 mx-auto text-blue-500 mb-2" />
                            <p className="font-medium text-slate-900 dark:text-white">{selectedFile.name}</p>
                            <p className="text-sm text-slate-500">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                        </div>
                    ) : (
                        <>
                            <Upload className="w-8 h-8 text-slate-400" />
                            <span className="font-medium text-slate-500 dark:text-slate-400">Upload File to Soroban Network</span>
                            <span className="text-xs text-slate-400">Drag and drop or click to select</span>
                            <input
                                type="file"
                                onChange={handleFileSelect}
                                className="mt-2 cursor-pointer opacity-0 absolute"
                                accept="*/*"
                            />
                        </>
                    )}
                </div>

                {selectedFile && (
                    <div className="mt-4 flex items-center gap-4">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Redundancy Level</label>
                            <select
                                value={redundancyLevel}
                                onChange={(e) => setRedundancyLevel(parseInt(e.target.value))}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                            >
                                <option value={1}>1x (Basic)</option>
                                <option value={3}>3x (Standard)</option>
                                <option value={5}>5x (High)</option>
                            </select>
                        </div>
                        <button
                            onClick={handleUpload}
                            disabled={loading}
                            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                        >
                            <Upload className="w-4 h-4" />
                            {loading ? 'Uploading...' : 'Upload'}
                        </button>
                        <button
                            onClick={() => setSelectedFile(null)}
                            className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                )}
            </div>

            <div className="space-y-4">
                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <FileText className="w-4 h-4" /> Your Files
                </h3>
                {files.length === 0 ? (
                    <p className="text-slate-500 text-center py-8">No files uploaded yet.</p>
                ) : (
                    <div className="grid gap-4">
                        {files.map((file) => (
                            <div key={file.cid} className="p-4 bg-white dark:bg-slate-800/80 rounded-lg border border-slate-100 dark:border-slate-700 shadow-sm">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-900/20 rounded flex items-center justify-center">
                                            <FileText className="w-6 h-6 text-indigo-500" />
                                        </div>
                                        <div>
                                            <div className="font-medium text-slate-900 dark:text-white">{file.name}</div>
                                            <div className="text-xs text-slate-500">
                                                {(file.size / 1024 / 1024).toFixed(2)} MB • {file.shardCount} Shards • {file.redundancyLevel}x Redundancy
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 text-green-500">
                                        <CheckCircle2 className="w-4 h-4" />
                                        <span className="text-sm font-semibold">Verified</span>
                                    </div>
                                </div>

                                {selectedFileForAccess === file.cid && (
                                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                placeholder="User address"
                                                value={accessUser}
                                                onChange={(e) => setAccessUser(e.target.value)}
                                                className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                                            />
                                            <button
                                                onClick={() => handleGrantAccess(file.cid)}
                                                className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm flex items-center gap-1"
                                            >
                                                <Plus className="w-3 h-3" />
                                                Grant
                                            </button>
                                            <button
                                                onClick={() => handleRevokeAccess(file.cid)}
                                                className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
                                            >
                                                Revoke
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className="mt-3 flex gap-2">
                                    <button
                                        onClick={() => setSelectedFileForAccess(selectedFileForAccess === file.cid ? null : file.cid)}
                                        className="px-3 py-1 text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-600"
                                    >
                                        Manage Access
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
