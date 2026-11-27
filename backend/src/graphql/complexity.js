// Query complexity analysis
// Each field carries a static cost via the schema's @complexity directive; the
// total must stay under a per-role maximum.
// Uses graphql-query-complexity with directiveEstimator + simpleEstimator.

import { createRequire } from 'module';
const nodeRequire = createRequire(import.meta.url);
const { getComplexity, directiveEstimator, simpleEstimator } = nodeRequire(
  'graphql-query-complexity'
);

// Per-role maximum complexity. Unknown/guest roles get the strictest limit.
export const ROLE_LIMITS = {
  guest: 100,
  user: 500,
  admin: 500,
};

export const DEFAULT_ROLE = 'guest';

// Backwards-compatible alias for the guest/default ceiling.
export const MAX_COMPLEXITY = ROLE_LIMITS[DEFAULT_ROLE];

// Estimators run in order; the first to return a value wins. The directive
// estimator reads @complexity(value: N, multipliers: [...]) straight off the
// schema SDL (createSchema preserves field astNodes), the simple estimator is
// the fallback so every undirected field still costs 1.
const estimators = [
  directiveEstimator({ name: 'complexity' }),
  simpleEstimator({ defaultComplexity: 1 }),
];

/**
 * Resolves the maximum allowed complexity for a set of roles.
 * When a request carries multiple roles, the most permissive limit wins.
 */
export function getMaxComplexityForRole(roles = []) {
  const list = Array.isArray(roles) ? roles : [roles];
  let max = ROLE_LIMITS[DEFAULT_ROLE];
  for (const role of list) {
    const limit = ROLE_LIMITS[role];
    if (typeof limit === 'number' && limit > max) max = limit;
  }
  return max;
}

/**
 * Computes the static complexity score for a parsed query document.
 * Pure — it never throws on over-limit; enforcement is the caller's job so the
 * rejection can carry a precise breakdown.
 */
export function computeComplexity(schema, document, variables = {}) {
  return getComplexity({
    schema,
    query: document,
    variables: variables ?? {},
    estimators,
  });
}
