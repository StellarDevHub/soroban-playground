import React, { useState } from 'react';
import { Cloud, HardDrive, Shield, Share2, Upload, FileText, CheckCircle2 } from 'lucide-react';

export default function CloudStoragePanel() {
    const [files, setFiles] = useState([
        { name: 'Contract_v1.rs', size: '12 KB', shards: 3, status: 'Verified' },
        { name: 'Audit_Report.pdf', size: '2.4 MB', shards: 8, status: 'Verified' },
    ]);

    return (
        <div className="p-6 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                    <Cloud className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Decentralized Storage</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                    <HardDrive className="w-10 h-10 text-slate-400" />
                    <div>
                        <div className="text-sm text-slate-500">Network Capacity</div>
                        <div className="text-xl font-bold text-slate-900 dark:text-white">4.2 PB Available</div>
                    </div>
                </div>
                <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                    <Shield className="w-10 h-10 text-green-500" />
                    <div>
                        <div className="text-sm text-slate-500">Redundancy Factor</div>
                        <div className="text-xl font-bold text-slate-900 dark:text-white">3x Replication</div>
                    </div>
                </div>
            </div>

            <div className="mb-6">
                <button 
                    onClick={() => setFiles([{ name: 'New_Project_Data.zip', size: '45 MB', shards: 12, status: 'Verifying' }, ...files])}
                    className="w-full py-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-blue-400 transition-all flex flex-col items-center gap-2"
                >
                    <Upload className="w-8 h-8" />
                    <span className="font-medium">Upload File to Soroban Network</span>
                    <span className="text-xs">Automatically sharded and encrypted</span>
                </button>
            </div>

            <div className="space-y-4">
                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <FileText className="w-4 h-4" /> Your Files
                </h3>
                <div className="grid gap-2">
                    {files.map((file, idx) => (
                        <div key={idx} className="flex items-center justify-between p-4 bg-white dark:bg-slate-800/80 rounded-lg border border-slate-100 dark:border-slate-700 shadow-sm">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-900/20 rounded flex items-center justify-center">
                                    <FileText className="w-6 h-6 text-indigo-500" />
                                </div>
                                <div>
                                    <div className="font-medium text-slate-900 dark:text-white">{file.name}</div>
                                    <div className="text-xs text-slate-500">{file.size} • {file.shards} Shards</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 text-green-500">
                                <CheckCircle2 className="w-4 h-4" />
                                <span className="text-sm font-semibold">{file.status}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
