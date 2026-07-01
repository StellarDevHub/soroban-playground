import { graphql } from 'graphql';
import { buildGraphQLSchema } from '../src/graphql/authorization.js';
import { typeDefs } from '../src/graphql/schema.js';
import { resolvers } from '../src/graphql/resolvers.js';

describe('GraphQL directive authorization', () => {
  const schema = buildGraphQLSchema({ typeDefs, resolvers });

  it('lets public fields resolve while blocking unauthorized protected fields', async () => {
    const result = await graphql({
      schema,
      source: `
        query {
          health
          invokeLog(contractId: "abc", first: 5, after: "")
        }
      `,
      contextValue: { user: { roles: ['guest'] } },
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].extensions?.code).toBe('FORBIDDEN');
    expect(result.data.health).toBe('ok');
    expect(result.data.invokeLog).toBeNull();
  });

  it('allows authorized mutations when the role matches', async () => {
    const result = await graphql({
      schema,
      source: `
        mutation {
          deploy(input: { wasmPath: "/tmp/demo.wasm", contractName: "demo", network: "testnet" }) {
            contractId
            message
          }
        }
      `,
      contextValue: { user: { roles: ['admin'] } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data.deploy.contractId).toBeDefined();
    expect(result.data.deploy.message).toContain('deployed successfully');
  });
});
