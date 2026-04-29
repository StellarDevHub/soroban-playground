// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * React Query key definitions for Cloud Storage feature.
 * Usage: import { cloudStorageKeys } from '@/lib/queryKeys/cloudStorage';
 */

export const cloudStorageKeys = {
  // Base key for all cloud-storage queries
  base: () => ['cloud-storage'] as const,

  // Files list (not used, but placeholder)
  files: () => [...cloudStorageKeys.base(), 'files'] as const,

  // Single file details
  file: (fileId: string) => [...cloudStorageKeys.base(), 'file', fileId] as const,

  // Node files
  nodeFiles: (nodeAddress: string) => [...cloudStorageKeys.base(), 'nodeFiles', nodeAddress] as const,

  // Metrics (if needed)
  metrics: () => [...cloudStorageKeys.base(), 'metrics'] as const,
};
