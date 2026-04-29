'use client';

import React, { useState } from 'react';
import { 
  ArrowRight, 
  Terminal, 
  CheckCircle2, 
  Copy, 
  ShieldAlert,
  Zap,
  Download,
  Split
} from 'lucide-react';

export default function MigrationAssistant() {
  const [v1Curl, setV1Curl] = useState("curl -X POST http://localhost:5000/api/v1/deploy \\ \n  -H 'Content-Type: application/json' \\ \n  -d '{ \"wasmPath\": \"/tmp/contract.wasm\", \"contractName\": \"hello\" }'");
  const [v2Curl, setV2Curl] = useState("");
  const [copied, setCopied] = useState(false);

  const handleTransform = () => {
    // Basic regex-based transform for demonstration
    let transformed = v1Curl
      .replace('/api/v1/', '/api/v2/')
      .replace('wasmPath', 'wasm_path')
      .replace('contractName', 'contract_name')
      .replace('contractId', 'contract_id')
      .replace('functionName', 'function_name')
      .replace('sourceAccount', 'source_account');
    
    setV2Curl(transformed);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
      <div className="max-w-5xl mx-auto space-y-12">
        <div className="text-center space-y-4">
          <h1 className="text-5xl font-extrabold bg-gradient-to-r from-primary-400 to-blue-500 bg-clip-text text-transparent">
            Migration Assistant
          </h1>
          <p className="text-xl text-gray-400">Upgrade your integration from API v1 to v2 in seconds.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative">
          {/* V1 Input */}
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm font-bold text-gray-500 uppercase tracking-widest">
              <ShieldAlert className="w-4 h-4 text-amber-500" />
              Legacy v1 Request (CURL)
            </label>
            <textarea
              value={v1Curl}
              onChange={(e) => setV1Curl(e.target.value)}
              className="w-full h-48 bg-gray-900 border border-gray-800 rounded-2xl p-4 font-mono text-sm focus:ring-2 focus:ring-primary-500 outline-none transition-all"
            />
          </div>

          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hidden md:block">
            <button 
              onClick={handleTransform}
              className="bg-primary-500 hover:bg-primary-400 text-white p-4 rounded-full shadow-2xl shadow-primary-500/20 transition-transform active:scale-95 group"
            >
              <Zap className="w-8 h-8 group-hover:animate-pulse" />
            </button>
          </div>

          {/* V2 Output */}
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm font-bold text-gray-500 uppercase tracking-widest">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Modern v2 Request (CURL)
            </label>
            <div className="relative">
              <textarea
                readOnly
                value={v2Curl || "Click the lightning bolt to transform..."}
                className="w-full h-48 bg-gray-900/50 border border-emerald-500/30 rounded-2xl p-4 font-mono text-sm text-emerald-400 outline-none"
              />
              {v2Curl && (
                <button 
                  onClick={() => copyToClipboard(v2Curl)}
                  className="absolute bottom-4 right-4 flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg text-xs transition-colors"
                >
                  {copied ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copied!' : 'Copy CURL'}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="md:hidden flex justify-center">
          <button 
            onClick={handleTransform}
            className="flex items-center gap-2 bg-primary-500 hover:bg-primary-400 text-white px-8 py-4 rounded-2xl font-bold transition-all shadow-xl shadow-primary-500/20"
          >
            <Zap className="w-5 h-5" /> Transform Command
          </button>
        </div>

        {/* Visual Diff Section */}
        <div className="bg-gray-900/50 border border-gray-800 rounded-3xl p-8 space-y-8">
          <h3 className="text-2xl font-bold flex items-center gap-3">
            <Split className="text-primary-500 w-6 h-6" />
            Breaking Changes Comparison
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div className="space-y-6">
              <h4 className="text-sm font-bold text-gray-500 uppercase">Field Renaming (Request)</h4>
              <div className="space-y-3">
                {[
                  { from: 'contractId', to: 'contract_id' },
                  { from: 'wasmPath', to: 'wasm_path' },
                  { from: 'functionName', to: 'function_name' }
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-4 group">
                    <span className="bg-red-500/10 text-red-400 px-3 py-1 rounded-lg font-mono text-xs line-through opacity-60">
                      {item.from}
                    </span>
                    <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-primary-500 transition-colors" />
                    <span className="bg-emerald-500/10 text-emerald-400 px-3 py-1 rounded-lg font-mono text-xs font-bold">
                      {item.to}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <h4 className="text-sm font-bold text-gray-500 uppercase">Field Renaming (Response)</h4>
              <div className="space-y-3">
                {[
                  { from: 'durationMs', to: 'duration_ms' },
                  { from: 'deployedAt', to: 'deployed_at' },
                  { from: 'sizeBytes', to: 'size_bytes' }
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-4 group">
                    <span className="bg-red-500/10 text-red-400 px-3 py-1 rounded-lg font-mono text-xs line-through opacity-60">
                      {item.from}
                    </span>
                    <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-primary-500 transition-colors" />
                    <span className="bg-emerald-500/10 text-emerald-400 px-3 py-1 rounded-lg font-mono text-xs font-bold">
                      {item.to}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-8 border-t border-gray-800 flex justify-center">
            <button className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
              <Download className="w-5 h-5" /> Download Full Migration Report (PDF)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
