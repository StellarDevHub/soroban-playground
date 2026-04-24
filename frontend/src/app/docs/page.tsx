'use client';

import React, { useState } from 'react';
import { 
  Code2, 
  Layers, 
  ArrowRightLeft, 
  BookOpen, 
  Terminal,
  FileCode,
  Copy,
  ChevronRight,
  ChevronDown,
  Info
} from 'lucide-react';

const API_VERSIONS = [
  { id: 'v1', status: 'deprecated', date: 'Sunset: 2026-12-31' },
  { id: 'v2', status: 'latest', date: 'Stable' }
];

const ENDPOINTS = [
  {
    name: 'Compile',
    method: 'POST',
    path: '/compile',
    v1: {
      request: '{ "code": "...", "dependencies": {} }',
      response: '{ "success": true, "durationMs": 120 }'
    },
    v2: {
      request: '{ "code": "...", "dependencies": {} }',
      response: '{ "success": true, "duration_ms": 120 }'
    }
  },
  {
    name: 'Deploy',
    method: 'POST',
    path: '/deploy',
    v1: {
      request: '{ "wasmPath": "/tmp/...", "contractName": "hello" }',
      response: '{ "contractId": "C...", "deployedAt": "..." }'
    },
    v2: {
      request: '{ "wasm_path": "/tmp/...", "contract_name": "hello" }',
      response: '{ "contract_id": "C...", "deployed_at": "..." }'
    }
  }
];

export default function APIDocumentation() {
  const [selectedVersion, setSelectedVersion] = useState('v2');
  const [expandedEndpoint, setExpandedEndpoint] = useState<string | null>('Compile');

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex justify-between items-end border-b border-gray-800 pb-8">
          <div>
            <h1 className="text-4xl font-bold flex items-center gap-3">
              <BookOpen className="text-primary-500 w-10 h-10" />
              API Reference
            </h1>
            <p className="text-gray-400 mt-2 text-lg">Integrate the Soroban Playground into your own workflows.</p>
          </div>
          
          <div className="flex items-center gap-4 bg-gray-900 p-2 rounded-xl border border-gray-800">
            <Layers className="w-5 h-5 text-gray-500 ml-2" />
            <select 
              value={selectedVersion} 
              onChange={(e) => setSelectedVersion(e.target.value)}
              className="bg-transparent border-none focus:ring-0 font-medium text-primary-400 pr-8"
            >
              {API_VERSIONS.map(v => (
                <option key={v.id} value={v.id}>{v.id.toUpperCase()} ({v.status})</option>
              ))}
            </select>
          </div>
        </div>

        {selectedVersion === 'v1' && (
          <div className="bg-amber-500/10 border border-amber-500/50 p-4 rounded-xl flex items-start gap-3 text-amber-400">
            <Info className="w-6 h-6 shrink-0" />
            <div>
              <p className="font-bold">Version v1 is Deprecated</p>
              <p className="text-sm opacity-80">This version will be disabled on 2026-12-31. We highly recommend migrating to v2 for better performance and future updates.</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Sidebar */}
          <div className="lg:col-span-3 space-y-2">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">Endpoints</h3>
            {ENDPOINTS.map(endpoint => (
              <button
                key={endpoint.name}
                onClick={() => setExpandedEndpoint(endpoint.name)}
                className={`w-full text-left px-4 py-2 rounded-lg transition-colors flex items-center justify-between ${
                  expandedEndpoint === endpoint.name ? 'bg-primary-500/10 text-primary-400 font-bold' : 'hover:bg-gray-900 text-gray-400'
                }`}
              >
                {endpoint.name}
                <ChevronRight className={`w-4 h-4 transition-transform ${expandedEndpoint === endpoint.name ? 'rotate-90' : ''}`} />
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="lg:col-span-9 space-y-8">
            {ENDPOINTS.filter(e => e.name === expandedEndpoint).map(endpoint => (
              <div key={endpoint.name} className="animate-in fade-in slide-in-from-right-4">
                <div className="flex items-center gap-3 mb-4">
                  <span className="bg-emerald-500/20 text-emerald-400 text-xs font-bold px-2 py-1 rounded">
                    {endpoint.method}
                  </span>
                  <code className="text-xl font-mono text-gray-300">
                    /api/{selectedVersion}{endpoint.path}
                  </code>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h4 className="text-sm font-bold text-gray-500 flex items-center gap-2">
                      <Terminal className="w-4 h-4" /> Request Schema
                    </h4>
                    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 font-mono text-sm overflow-hidden relative group">
                      <pre className="text-emerald-400">{(endpoint as any)[selectedVersion].request}</pre>
                      <button className="absolute top-2 right-2 p-2 bg-gray-800 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="text-sm font-bold text-gray-500 flex items-center gap-2">
                      <FileCode className="w-4 h-4" /> Response Schema
                    </h4>
                    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 font-mono text-sm overflow-hidden relative group">
                      <pre className="text-blue-400">{(endpoint as any)[selectedVersion].response}</pre>
                      <button className="absolute top-2 right-2 p-2 bg-gray-800 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Example Comparison if v2 selected */}
                {selectedVersion === 'v2' && (
                  <div className="mt-8 border-t border-gray-800 pt-8">
                    <h4 className="text-lg font-bold mb-4 flex items-center gap-2">
                      <ArrowRightLeft className="w-5 h-5 text-primary-500" />
                      v1 vs v2 Side-by-Side
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-gray-900/30 rounded-lg border border-gray-800 italic text-gray-500 text-xs">
                        v1: camelCase (Legacy)
                      </div>
                      <div className="p-4 bg-primary-500/5 rounded-lg border border-primary-500/20 italic text-primary-400 text-xs">
                        v2: snake_case (Modern)
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
