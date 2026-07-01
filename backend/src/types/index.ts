// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// ─── Snippet Service Types ────────────────────────────────────────────────────

export interface Snippet {
  id: string;
  code: string;
  language: string;
  title: string;
  createdAt: string;
  shareUrl: string;
}

export interface SaveSnippetInput {
  code: string;
  language?: string;
  title?: string;
}

export interface SnippetServiceResult {
  success: boolean;
  snippet?: Snippet;
  error?: string;
}

// ─── Deploy Queue Types ───────────────────────────────────────────────────────

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface DeployJob {
  id: string;
  wasmPath: string;
  contractName: string;
  network: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: DeployJobResult;
  error?: string;
}

export interface DeployJobResult {
  contractId: string;
  contractName: string;
  network: string;
  wasmPath: string;
  deployedAt: string;
  message: string;
}

export interface EnqueueDeployInput {
  wasmPath: string;
  contractName: string;
  network?: string;
}

export interface DeployQueueStats {
  queued: number;
  running: number;
  done: number;
  failed: number;
  total: number;
}
