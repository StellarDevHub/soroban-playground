'use client';

import React, { useState, useRef } from 'react';
import { FileText, Upload, CheckCircle2, Loader2, Download } from 'lucide-react';

interface Certificate {
  fileHash: string;
  recordId: number;
  timestamp: number;
  metadata: string;
}

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function NotarizeForm() {
  const [file, setFile] = useState<File | null>(null);
  const [fileHash, setFileHash] = useState('');
  const [metadata, setMetadata] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setCertificate(null);
    setError('');
    if (selected) {
      const hash = await sha256Hex(selected);
      setFileHash(hash);
    } else {
      setFileHash('');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fileHash) return;
    if (!metadata.trim()) {
      setError('Metadata is required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/notary/notarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileHash, metadata }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message ?? 'Notarization failed');
      }
      setCertificate({ fileHash, metadata, ...json.data });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  function downloadCertificate() {
    if (!certificate) return;
    const content = JSON.stringify(certificate, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notary-certificate-${certificate.recordId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
          <FileText className="w-6 h-6 text-blue-600 dark:text-blue-400" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Notarize File</h2>
      </div>

      <form onSubmit={handleSubmit} noValidate aria-label="Notarize file form">
        {/* File upload */}
        <div className="mb-4">
          <label
            htmlFor="notarize-file"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
          >
            File
          </label>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-blue-400 transition-all flex flex-col items-center gap-2"
            aria-label="Select file to notarize"
          >
            <Upload className="w-8 h-8" />
            <span className="font-medium">{file ? file.name : 'Click to select a file'}</span>
            {fileHash && (
              <span className="text-xs font-mono text-slate-400 break-all px-4">
                SHA-256: {fileHash}
              </span>
            )}
          </button>
          <input
            id="notarize-file"
            ref={fileInputRef}
            type="file"
            className="sr-only"
            onChange={handleFileChange}
            aria-label="File input"
          />
        </div>

        {/* Metadata */}
        <div className="mb-4">
          <label
            htmlFor="notarize-metadata"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
          >
            Metadata <span className="text-slate-400 font-normal">(max 500 chars)</span>
          </label>
          <textarea
            id="notarize-metadata"
            value={metadata}
            onChange={(e) => setMetadata(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Describe this document..."
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-describedby="metadata-count"
          />
          <p id="metadata-count" className="text-xs text-slate-400 mt-1 text-right">
            {metadata.length}/500
          </p>
        </div>

        {/* Error */}
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-4">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !fileHash}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
          aria-busy={loading}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Notarizing…
            </>
          ) : (
            'Notarize File'
          )}
        </button>
      </form>

      {/* Certificate */}
      {certificate && (
        <div
          role="status"
          aria-live="polite"
          className="mt-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl"
        >
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            <span className="font-semibold text-green-800 dark:text-green-300">
              File Notarized Successfully
            </span>
          </div>
          <dl className="text-sm space-y-1 text-slate-700 dark:text-slate-300">
            <div className="flex gap-2">
              <dt className="font-medium">Record ID:</dt>
              <dd>{certificate.recordId}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium">Timestamp:</dt>
              <dd>{new Date(certificate.timestamp * 1000).toISOString()}</dd>
            </div>
            <div className="flex gap-2 break-all">
              <dt className="font-medium shrink-0">Hash:</dt>
              <dd className="font-mono text-xs">{certificate.fileHash}</dd>
            </div>
          </dl>
          <button
            onClick={downloadCertificate}
            className="mt-3 flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
            aria-label="Download notary certificate"
          >
            <Download className="w-4 h-4" />
            Download Certificate
          </button>
        </div>
      )}
    </div>
  );
}
