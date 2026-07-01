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
    durationMs: Int
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
    activeWorkers: Int!
    maxWorkers: Int!
    queueLength: Int!
    estimatedWaitTimeMs: Int!
    cacheHitRate: Float!
    totalCompiles: Int!
    cacheHits: Int!
    slowCompiles: Int!
    memoryPeakBytes: Float!
    cacheBytes: Float!
    artifactsCount: Int!
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
    requestId: String!
    hash: String!
    cached: Boolean!
    durationMs: Int!
    timestamp: String!
    artifact: CompileArtifact
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

  # ── Projects / Files / Templates (issue #724) ────────────────────────────────
  # These types back the DataLoader-batched resolvers. The files and project
  # / template relations are resolved via per-request DataLoaders so an N+1
  # fan-out collapses to a single batched SQL query per relation.
  type Project {
    id: ID!
    title: String!
    description: String!
    category: String!
    status: String!
    creatorId: Int!
    creatorName: String!
    fundingGoal: Float!
    currentFunding: Float!
    completionRate: Float!
    tags: [String!]!
    files: [File!]!
  }

  type File {
    id: ID!
    projectId: Int
    templateId: Int
    uploaderId: Int!
    filename: String!
    filepath: String!
    mimetype: String!
    sizeBytes: Int!
    project: Project
    template: Template
  }

  type Template {
    id: ID!
    dirName: String!
    name: String!
    description: String!
    category: String!
    complexity: String!
    deploymentStatus: String!
    tags: [String!]!
    functionalities: [String!]!
    features: [String!]!
    files: [File!]!
  }

  # ── Complexity directive ──────────────────────────────────────────────────────
  directive @complexity(value: Int!, multipliers: [String!]) on FIELD_DEFINITION

  # ── Authorization directives ────────────────────────────────────────────────
  directive @auth(requires: [String!]) on FIELD_DEFINITION | FIELD | OBJECT | QUERY | MUTATION | SUBSCRIPTION
  directive @hasRole(role: String!) on FIELD_DEFINITION | FIELD | OBJECT | QUERY | MUTATION | SUBSCRIPTION

  # ── Root types ────────────────────────────────────────────────────────────────
  type Query {
    # Projects
    projects: [Project!]! @complexity(value: 5)
    project(id: ID!): Project @complexity(value: 3)

    # Compile
    compileStats: CompileStats! @complexity(value: 1)
    compileHistory: [CompileHistoryItem!]! @complexity(value: 3)

    # Deploy
    deployHistory(first: Int, after: String): DeployHistoryConnection!
      @complexity(value: 3, multipliers: ["first"])

    # Invoke — admin only
    invokeLog(contractId: String!, first: Int, after: String): JSON
      @complexity(value: 5)
      @auth(requires: ["authenticated"])
      @hasRole(role: "admin")

    # Projects / Files / Templates (issue #724)
    projects: [Project!]! @complexity(value: 3)
    project(id: ID!): Project @complexity(value: 2)
    files: [File!]! @complexity(value: 3)
    templates: [Template!]! @complexity(value: 3)
    template(id: ID!): Template @complexity(value: 2)

    # Health
    health: String! @complexity(value: 1)
  }

  type Mutation {
    # Projects
    createProject(
      title: String!
      description: String!
      category: String!
      status: String!
      funding_goal: Float!
      tags: [String!]
    ): Project! @complexity(value: 10)

    updateProject(
      id: ID!
      title: String
      description: String
      category: String
      status: String
      funding_goal: Float
      tags: [String!]
    ): Project! @complexity(value: 10)

    deleteProject(id: ID!): Boolean! @complexity(value: 10)

    # Mutations spawn real work (compile/deploy/invoke) so they carry a heavier
    # static weight than read fields.
    compile(input: CompileInput!): CompileResult! @complexity(value: 10)
    compileBatch(contracts: [BatchContractInput!]!): BatchCompileResult!
      @complexity(value: 20)
      @auth(requires: ["authenticated"])
    deploy(input: DeployInput!): DeployResult! @complexity(value: 10)
      @auth(requires: ["authenticated"])
    invoke(input: InvokeInput!): InvokeResult! @complexity(value: 10)
      @auth(requires: ["authenticated"])
  }

  type Subscription {
    compileProgress(requestId: String): CompileProgressEvent!
      @complexity(value: 5)
    deployProgress(requestId: String): DeployProgressEvent!
      @complexity(value: 5)
    invokeProgress(requestId: String): InvokeProgressEvent!
      @complexity(value: 5)
  }
`;
