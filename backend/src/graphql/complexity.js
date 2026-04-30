// Query complexity analysis
// Each field carries a cost; the total must stay under MAX_COMPLEXITY.
// Uses graphql-query-complexity with fieldExtensionsEstimator + simpleEstimator.

import {
  getComplexity,
  fieldExtensionsEstimator,
  simpleEstimator,
} from 'graphql-query-complexity';

export const MAX_COMPLEXITY = 100;

/**
 * Returns the complexity score for a parsed query document against the schema.
 * Throws if the score exceeds MAX_COMPLEXITY.
 */
export function analyzeComplexity(schema, document, variables = {}) {
  const complexity = getComplexity({
    schema,
    query: document,
    variables,
    estimators: [
      // Reads @complexity(value: N, multipliers: [...]) directives from schema
      fieldExtensionsEstimator(),
      // Fallback: every field costs 1
      simpleEstimator({ defaultComplexity: 1 }),
    ],
  });

  if (complexity > MAX_COMPLEXITY) {
    throw new Error(
      `Query complexity ${complexity} exceeds maximum allowed complexity of ${MAX_COMPLEXITY}.`
    );
  }

  return complexity;
}
