'use client';

import React, { useState, useRef } from 'react';
import { Search, Upload, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface NotaryRecord {
  fileHash: string;
  owner: string;
  timestamp: number;
  metadata: string;
  verified: boolean;
  recordId: number;
}

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function VerifyForm() {
  const [hashInput, setHashInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [record, setRecord] = useState<NotaryRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const hash = await sha256Hex(file);
    setHashInput(hash);
    setRecord(null);
    setNotFound(false);
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hash = hashInput.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(hash)) {
      setError('Please enter a valid 64-character hex hash or upload a file.');
      return;
    }
    setLoading(true);
    setError('');
    setRecord(null);
    setNotFound(false);
    try {
      const res = await fetch(`/api/notary/verify/${hash}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Verification failed');
      setRecord(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
          <Search className="w-6 h-6 text-purple-600 dark:text-purple-400" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Verify File</h2>
      </div>

      <form onSubmit={handleSubmit} noValidate aria-label="Verify file form">
        {/* File upload shortcut */}
        <div className="mb-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-3 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-purple-400 transition-all flex items-center justify-center gap-2"
            aria-label="Upload file to compute hash"
          >
            <Upload className="w-5 h-5" />
            <span className="text-sm font-medium">Upload file to auto-fill hash</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            onChange={handleFileChange}
            aria-label="File input for hash computation"
          />
        </div>

        {/* Hash input */}
        <div className="mb-4">
          <label
            htmlFor="verify-hash"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
          >
            File Hash (SHA-256)
          </label>
          <input
            id="verify-hash"
            type="text"
            value={hashInput}
            onChange={(e) => {
              setHashInput(e.target.value);
              setRecord(null);
              setNotFound(false);
              setError('');
            }}
            placeholder="64-character hex string"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            aria-label="File hash input"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-4">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !hashInput.trim()}
          className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
          aria-busy={loading}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Verifying…
            </>
          ) : (
            'Verify File'
          )}
        </button>
      </form>

      {/* Not found */}
      {notFound && (
        <div
          role="status"
          aria-live="polite"
          className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl flex items-center gap-3"
        >
          <XCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0" />
          <p className="text-sm text-yellow-800 dark:text-yellow-300">
            This file has not been notarized.
          </p>
        </div>
      )}

      {/* Record */}
      {record && (
        <div
          role="status"
          aria-live="polite"
          className="mt-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl"
        >
          <div className="flex items-center gap-2 mb-3">
            {record.verified ? (
              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            ) : (
              <XCircle className="w-5 h-5 text-red-500" />
            )}
            <span
              className={`font-semibold ${
                record.verified
                  ? 'text-green-800 dark:text-green-300'
                  : 'text-red-700 dark:text-red-400'
              }`}
            >
              {record.verified ? 'Verified' : 'Revoked'}
            </span>
          </div>
          <dl className="text-sm space-y-1 text-slate-700 dark:text-slate-300">
            <div className="flex gap-2">
              <dt className="font-medium">Owner:</dt>
              <dd className="font-mono text-xs break-all">{record.owner}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium">Timestamp:</dt>
              <dd>{new Date(record.timestamp * 1000).toISOString()}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium">Metadata:</dt>
              <dd>{record.metadata}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
