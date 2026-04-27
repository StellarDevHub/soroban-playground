// GraphQL server — mounts graphql-yoga onto the Express app at /graphql.
// Includes: DataLoader per-request, query complexity analysis, field-level auth,
// Redis-backed caching, GraphiQL playground, and subscription support.

import { createYoga, createSchema } from 'graphql-yoga';
import { typeDefs } from './schema.js';
import { resolvers } from './resolvers.js';
import { createLoaders } from './dataloaders.js';
import { analyzeComplexity, MAX_COMPLEXITY } from './complexity.js';

// Build the executable schema once at startup
const schema = createSchema({ typeDefs, resolvers });

/**
 * Extracts a minimal user context from the request for field-level auth.
 * In production, verify a JWT here. For now, the X-Role header is used
 * so the playground can be tested without a full auth stack.
 */
function buildUserContext(request) {
  const role = request.headers.get('x-role') ?? 'guest';
  const token = (request.headers.get('authorization') ?? '').replace('Bearer ', '');
  return {
    roles: role ? [role] : ['guest'],
    token,
  };
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
    context: ({ request }) => ({
      loaders: createLoaders(),
      user: buildUserContext(request),
    }),

    // Query complexity enforcement
    plugins: [
      {
        onExecute({ args }) {
          try {
            const score = analyzeComplexity(args.schema, args.document, args.variableValues);
            // Attach score to extensions so clients can see it
            args.contextValue._complexityScore = score;
          } catch (err) {
            // Re-throw as a GraphQL error so it surfaces in the response
            throw err;
          }
        },
        onResultProcess({ result, setResult }) {
          const score = result?.data?.__complexityScore;
          if (score !== undefined) return;
          // Append complexity score to extensions
          const ctx = result?.extensions ?? {};
          if (result && typeof result === 'object') {
            setResult({
              ...result,
              extensions: {
                ...ctx,
                complexity: {
                  score: result?.data?._complexityScore ?? 0,
                  max: MAX_COMPLEXITY,
                },
              },
            });
          }
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
