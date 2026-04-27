// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

export const typeDefs = `#graphql
  type CompileStats {
    activeWorkers: Int
    maxWorkers: Int
    queueLength: Int
    estimatedWaitTimeMs: Int
    cacheHitRate: Int
    totalCompiles: Int
    cacheHits: Int
    slowCompiles: Int
    memoryPeakBytes: Float
    cacheBytes: Float
    artifactsCount: Int
  }

  type Artifact {
    hash: String!
    path: String
    sizeBytes: Float
    createdAt: String
    completedAt: String
    sourceHash: String
    cached: Boolean
    durationMs: Int
  }

  type HistoryItem {
    requestId: String!
    hash: String!
    cached: Boolean
    durationMs: Int
    queueLength: Int
    activeWorkers: Int
    timestamp: String
    artifact: Artifact
  }

  type Deployment {
    deploymentId: ID!
    startedAt: String
    endedAt: String
    status: String
    error: String
    contracts: [DeployedContract]
  }

  type DeployedContract {
    id: String!
    contractName: String
    contractId: String
    status: String
    deployedAt: String
    wasmPath: String
    artifact: Artifact
  }

  type Query {
    compileStats: CompileStats
    compileHistory: [HistoryItem]
    artifacts: [Artifact]
    artifact(hash: String!): Artifact
    deployments: [Deployment]
    deployment(id: ID!): Deployment
  }
`;
