// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import DataLoader from 'dataloader';
import { getCompileSnapshot } from '../services/compileService.js';

/**
 * Creates DataLoaders for a request context.
 */
export const createLoaders = () => {
  return {
    artifactLoader: new DataLoader(async (hashes) => {
      // Fetch all artifacts from the service
      const snapshot = await getCompileSnapshot();
      const artifactMap = new Map(
        snapshot.artifacts.map((a) => [a.hash, a])
      );

      // Return them in the same order as the requested hashes
      return hashes.map((hash) => artifactMap.get(hash) || null);
    }),
    
    // We can also add a loader for artifacts by path if needed for deployments
    artifactByPathLoader: new DataLoader(async (paths) => {
      const snapshot = await getCompileSnapshot();
      const artifactMap = new Map(
        snapshot.artifacts.map((a) => [a.path, a])
      );
      return paths.map((path) => artifactMap.get(path) || null);
    })
  };
};
