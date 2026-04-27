// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { getCompileStats, getCompileSnapshot } from '../services/compileService.js';
import { getDeploymentState } from '../services/deployService.js';

export const resolvers = {
  Query: {
    compileStats: async () => {
      const stats = getCompileStats();
      return {
        ...stats,
        artifactsCount: stats.artifacts // Map service field to schema field
      };
    },
    compileHistory: async () => {
      const snapshot = await getCompileSnapshot();
      return snapshot?.history || [];
    },
    artifacts: async () => {
      const snapshot = await getCompileSnapshot();
      return snapshot?.artifacts || [];
    },
    artifact: async (_, { hash }, { loaders }) => {
      return loaders.artifactLoader.load(hash);
    },
    deployments: async () => {
      const state = getDeploymentState();
      return state.history;
    },
    deployment: async (_, { id }) => {
      const state = getDeploymentState();
      return state.history.find(d => d.deploymentId === id);
    }
  },

  HistoryItem: {
    artifact: (parent, _, { loaders }) => {
      if (!parent.hash) return null;
      return loaders.artifactLoader.load(parent.hash);
    }
  },

  DeployedContract: {
    artifact: (parent, _, { loaders }) => {
      if (!parent.wasmPath) return null;
      // In a real system, we'd probably have a better way to link these
      // For now, we use the path loader as a demonstration of optimization
      return loaders.artifactByPathLoader.load(parent.wasmPath);
    }
  }
};
