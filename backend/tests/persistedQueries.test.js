import express from 'express';
import request from 'supertest';
import {
  createPersistedQueryMiddleware,
  createPersistedQueryRouter,
  hashQuery,
} from '../src/graphql/persistedQueries.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/graphql', createPersistedQueryRouter());
  app.post('/graphql', createPersistedQueryMiddleware(), (req, res) => {
    res.json({ query: req.body.query ?? null });
  });
  return app;
}

describe('persisted GraphQL queries', () => {
  it('registers and resolves a persisted query by hash', async () => {
    const app = makeApp();
    const query = '{ health }';
    const hash = hashQuery(query);

    const register = await request(app)
      .post('/graphql/persisted-queries')
      .send({ query, hash });

    expect(register.status).toBe(201);
    expect(register.body).toEqual({ success: true, hash });

    const execute = await request(app)
      .post('/graphql')
      .send({
        extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
      });

    expect(execute.status).toBe(200);
    expect(execute.body.query).toBe(query);
  });

  it('returns Apollo-style miss response when hash is unknown', async () => {
    const app = makeApp();
    const hash = 'a'.repeat(64);

    const response = await request(app)
      .post('/graphql')
      .send({
        extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
      });

    expect(response.status).toBe(200);
    expect(response.body.errors[0].extensions.code).toBe(
      'PERSISTED_QUERY_NOT_FOUND'
    );
  });

  it('rejects registration when the supplied hash does not match', async () => {
    const app = makeApp();

    const response = await request(app)
      .post('/graphql/persisted-queries')
      .send({ query: '{ health }', hash: 'b'.repeat(64) });

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
  });
});
