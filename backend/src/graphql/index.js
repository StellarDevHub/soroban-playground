// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import cors from 'cors';
import express from 'express';
import { typeDefs } from './schema.js';
import { resolvers } from './resolvers.js';
import { createLoaders } from './loaders.js';

export async function setupGraphQL(app) {
  try {
    const apolloServer = new ApolloServer({
      typeDefs,
      resolvers,
    });

    await apolloServer.start();

    app.use(
      '/graphql',
      cors(),
      express.json(),
      expressMiddleware(apolloServer, {
        context: async ({ req }) => ({
          req,
          loaders: createLoaders(),
        }),
      }),
    );

    return apolloServer;
  } catch (error) {
    throw error;
  }
}
