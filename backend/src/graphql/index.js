// GraphQL server — mounts graphql-yoga onto the Express app at /graphql.
// Includes: DataLoader per-request, query complexity analysis, field-level auth,
// Redis-backed caching, GraphiQL playground, and subscription support.

import { createRequire } from 'module';
const nodeRequire = createRequire(import.meta.url);
const { createYoga } = nodeRequire('graphql-yoga');
const { GraphQLError } = nodeRequire('graphql');
import { typeDefs } from './schema.js';
import { resolvers } from './resolvers.js';
import { buildGraphQLSchema } from './authorization.js';
import { createLoaders } from './dataloaders.js';
import { computeComplexity, getMaxComplexityForRole } from './complexity.js';
import {
  createPersistedQueryMiddleware,
  createPersistedQueryRouter,
} from './persistedQueries.js';
import authService from '../services/authService.js';

// Build the executable schema once at startup
const schema = buildGraphQLSchema({ typeDefs, resolvers });

/**
 * Extracts a minimal user context from the request for field-level auth.
 */
async function buildUserContext(req, request) {
  if (req && req.user) {
    return req.user;
  }
  // Convert standard fetch request headers to a plain object
  const headers = {};
  if (request && request.headers) {
    for (const [key, val] of request.headers.entries()) {
      headers[key] = val;
    }
  }
  return authService.authenticate({ headers });
}

export function createGraphQLServer() {
  const yoga = createYoga({
    schema,
    graphqlEndpoint: '/graphql',

    // GraphiQL playground — accessible at GET /graphql
    graphiql: {
      title: 'Soroban Playground — GraphQL API',
      defaultQuery: `# Welcome to the Soroban Playground GraphQL API
# Try a query:
query Health {
  health
}
`,
    },

    // Per-request context: loaders + user
    context: async ({ req, request }) => ({
      loaders: createLoaders(),
      user: await buildUserContext(req, request),
    }),

    // Query complexity enforcement.
    // onExecute runs *before* resolvers, so an over-limit query is rejected
    // before any resolver — and therefore any DB query — runs. The rejection
    // carries a precise breakdown; successful queries echo their score in
    // extensions so clients can see how close they are to the limit.
    plugins: [
      {
        onExecute({ args, setResultAndStopExecution }) {
          const userRole = args.contextValue?.user?.role || 'guest';
          const roles = args.contextValue?.user?.roles || [userRole];
          const max = getMaxComplexityForRole(roles);
          const score = computeComplexity(
            args.schema,
            args.document,
            args.variableValues
          );

          if (score > max) {
            const role = Array.isArray(roles) ? roles.join(',') : String(roles);
            // A bare GraphQLError (no originalError) is not hidden by
            // maskedErrors, so the breakdown survives in production.
            setResultAndStopExecution({
              errors: [
                new GraphQLError(
                  `Query complexity ${score} exceeds the maximum allowed complexity of ${max}.`,
                  {
                    extensions: {
                      code: 'QUERY_COMPLEXITY_EXCEEDED',
                      complexity: { score, max, role },
                    },
                  }
                ),
              ],
            });
            return;
          }

          return {
            onExecuteDone({ result, setResult }) {
              if (
                !result ||
                typeof result !== 'object' ||
                Array.isArray(result)
              ) {
                return;
              }
              setResult({
                ...result,
                extensions: {
                  ...(result.extensions ?? {}),
                  complexity: { score, max },
                },
              });
            },
          };
        },
      },
    ],

    // Mask internal errors in production
    maskedErrors: process.env.NODE_ENV === 'production',

    // Logging
    logging: process.env.NODE_ENV !== 'test',
  });

  return yoga;
}

export function setupGraphQL(app) {
  const yoga = createGraphQLServer();
  app.use(yoga.graphqlEndpoint, createPersistedQueryRouter());
  app.use(yoga.graphqlEndpoint, createPersistedQueryMiddleware());
  app.use(yoga.graphqlEndpoint, yoga);
}
