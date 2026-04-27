// GraphQL Schema Definition
// Types mirror the REST API surface: Compile, Deploy, Invoke + pagination + subscriptions

export const typeDefs = /* GraphQL */ `
  # ── Scalars ──────────────────────────────────────────────────────────────────
  scalar JSON

  # ── Pagination (Relay-style cursor) ──────────────────────────────────────────
  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }

  # ── Compile ───────────────────────────────────────────────────────────────────
  type CompileArtifact {
    name: String!
    sizeBytes: Int!
    path: String!
  }

  type CompileResult {
    success: Boolean!
    cached: Boolean!
    hash: String!
    durationMs: Int
    logs: [String!]!
    artifact: CompileArtifact!
    message: String!
  }

  type CompileStats {
    totalCompiles: Int!
    cacheHits: Int!
    slowCompiles: Int!
    activeWorkers: Int!
    queueLength: Int!
  }

  type CompileEdge {
    cursor: String!
    node: CompileHistoryItem!
  }

  type CompileHistoryConnection {
    edges: [CompileEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type CompileHistoryItem {
    id: String!
    hash: String!
    status: String!
    durationMs: Int
    cachedAt: String
    createdAt: String!
  }

  # ── Deploy ────────────────────────────────────────────────────────────────────
  type DeployResult {
    success: Boolean!
    contractId: String!
    contractName: String!
    network: String!
    wasmPath: String!
    deployedAt: String!
    message: String!
  }

  type DeployEdge {
    cursor: String!
    node: DeployHistoryItem!
  }

  type DeployHistoryConnection {
    edges: [DeployEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type DeployHistoryItem {
    id: String!
    contractId: String!
    contractName: String!
    network: String!
    status: String!
    deployedAt: String!
  }

  # ── Invoke ────────────────────────────────────────────────────────────────────
  type InvokeResult {
    success: Boolean!
    contractId: String!
    functionName: String!
    output: JSON
    stdout: String
    stderr: String
    message: String!
    invokedAt: String!
  }

  # ── Batch ─────────────────────────────────────────────────────────────────────
  type BatchCompileItem {
    contractIndex: Int!
    success: Boolean!
    hash: String
    durationMs: Int
    cached: Boolean
    error: String
  }

  type BatchCompileResult {
    success: Boolean!
    results: [BatchCompileItem!]!
  }

  # ── Inputs ────────────────────────────────────────────────────────────────────
  input CompileInput {
    code: String!
    dependencies: JSON
  }

  input BatchContractInput {
    code: String!
    dependencies: JSON
  }

  input DeployInput {
    wasmPath: String!
    contractName: String!
    network: String
  }

  input InvokeInput {
    contractId: String!
    functionName: String!
    args: JSON
    network: String
    sourceAccount: String
  }

  # ── Subscription Events ───────────────────────────────────────────────────────
  type CompileProgressEvent {
    requestId: String!
    status: String!
    message: String
    progress: Int
    timestamp: String!
  }

  type DeployProgressEvent {
    requestId: String!
    contractId: String
    status: String!
    message: String
    timestamp: String!
  }

  type InvokeProgressEvent {
    requestId: String!
    contractId: String!
    functionName: String!
    status: String!
    message: String
    timestamp: String!
  }

  # ── Complexity directive ──────────────────────────────────────────────────────
  directive @complexity(value: Int!, multipliers: [String!]) on FIELD_DEFINITION

  # ── Root types ────────────────────────────────────────────────────────────────
  type Query {
    # Compile
    compileStats: CompileStats! @complexity(value: 1)
    compileHistory(first: Int, after: String): CompileHistoryConnection! @complexity(value: 3, multipliers: ["first"])

    # Deploy
    deployHistory(first: Int, after: String): DeployHistoryConnection! @complexity(value: 3, multipliers: ["first"])

    # Invoke — admin only
    invokeLog(contractId: String!, first: Int, after: String): JSON @complexity(value: 5)

    # Health
    health: String! @complexity(value: 1)
  }

  type Mutation {
    compile(input: CompileInput!): CompileResult!
    compileBatch(contracts: [BatchContractInput!]!): BatchCompileResult!
    deploy(input: DeployInput!): DeployResult!
    invoke(input: InvokeInput!): InvokeResult!
  }

  type Subscription {
    compileProgress(requestId: String): CompileProgressEvent!
    deployProgress(requestId: String): DeployProgressEvent!
    invokeProgress(requestId: String): InvokeProgressEvent!
  }
`;
