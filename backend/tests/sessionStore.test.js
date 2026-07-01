/**
 * Tests for Redis session store and session middleware (#765)
 */
import express from 'express';
import request from 'supertest';
import {
  RedisSessionStore,
  createSessionMiddleware,
} from '../src/middleware/sessionStore.js';

function makeRedis() {
  const store = new Map();
  const expiries = new Map();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value, mode, ttl) {
      store.set(key, value);
      expiries.set(key, ttl);
    },
    async del(key) {
      store.delete(key);
      expiries.delete(key);
      return 1;
    },
    async expire(key, ttl) {
      expiries.set(key, ttl);
      return 1;
    },
    _store: store,
    _expiries: expiries,
  };
}

describe('RedisSessionStore (#765)', () => {
  it('stores and retrieves a session', async () => {
    const redis = makeRedis();
    const s = new RedisSessionStore(redis);
    await s.set('abc', { userId: 1 });
    expect(await s.get('abc')).toEqual({ userId: 1 });
  });

  it('returns null for unknown session id', async () => {
    const redis = makeRedis();
    const s = new RedisSessionStore(redis);
    expect(await s.get('unknown')).toBeNull();
  });

  it('destroys a session', async () => {
    const redis = makeRedis();
    const s = new RedisSessionStore(redis);
    await s.set('xyz', { userId: 2 });
    await s.destroy('xyz');
    expect(await s.get('xyz')).toBeNull();
  });

  it('sets TTL when storing a session', async () => {
    const redis = makeRedis();
    const s = new RedisSessionStore(redis, 3600);
    await s.set('ttl-test', { userId: 3 });
    expect(redis._expiries.get('session:ttl-test')).toBe(3600);
  });

  it('refreshes TTL via touch', async () => {
    const redis = makeRedis();
    const expireSpy = jest.spyOn(redis, 'expire');
    const s = new RedisSessionStore(redis, 1800);
    await s.set('touch-test', { userId: 4 });
    await s.touch('touch-test');
    expect(expireSpy).toHaveBeenCalledWith('session:touch-test', 1800);
  });
});

describe('createSessionMiddleware (#765)', () => {
  it('creates a new session and sets the sid cookie', async () => {
    const redis = makeRedis();
    const app = express();
    app.use(createSessionMiddleware(redis, { secure: false }));
    app.get('/test', (req, res) => {
      req.session.user = 'alice';
      res.json({ ok: true });
    });

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toMatch(/^sid=/);
    expect(cookies[0]).toMatch(/HttpOnly/);
    expect(cookies[0]).toMatch(/SameSite=Strict/);
  });

  it('reuses an existing session on subsequent requests', async () => {
    const redis = makeRedis();
    const app = express();
    app.use(createSessionMiddleware(redis, { secure: false }));
    app.get('/write', (req, res) => {
      req.session.counter = 1;
      res.json({ sessionId: req.sessionId });
    });
    app.get('/read', (req, res) => {
      res.json({ counter: req.session.counter });
    });

    const r1 = await request(app).get('/write');
    const setCookie = r1.headers['set-cookie'][0];
    const sid = setCookie.split(';')[0].split('=')[1];

    const r2 = await request(app).get('/read').set('Cookie', `sid=${sid}`);
    expect(r2.body.counter).toBe(1);
  });

  it('destroys session via req.destroySession()', async () => {
    const redis = makeRedis();
    const app = express();
    app.use(createSessionMiddleware(redis, { secure: false }));
    app.get('/init', (req, res) => {
      req.session.flag = true;
      res.json({ id: req.sessionId });
    });
    app.get('/logout', async (req, res) => {
      await req.destroySession();
      res.json({ ok: true });
    });

    const r1 = await request(app).get('/init');
    const sid = r1.headers['set-cookie'][0].split(';')[0].split('=')[1];

    await request(app).get('/logout').set('Cookie', `sid=${sid}`);

    // Session should be gone from redis
    const gone = await redis.get(`session:${sid}`);
    expect(gone).toBeNull();
  });

  it('accepts session id from X-Session-Id header', async () => {
    const redis = makeRedis();
    await redis.set('session:header-sid', JSON.stringify({ data: 'loaded' }));

    const app = express();
    app.use(createSessionMiddleware(redis, { secure: false }));
    app.get('/check', (req, res) => {
      res.json(req.session);
    });

    const res = await request(app)
      .get('/check')
      .set('X-Session-Id', 'header-sid');
    expect(res.body.data).toBe('loaded');
  });
});
