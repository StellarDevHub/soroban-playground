import request from 'supertest';
import app from '../src/server.js';
import redisService from '../src/services/redisService.js';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_for_dev';

describe('Auth E2E Token Security', () => {
  let accessToken, refreshToken;
  let firstRefreshToken;

  beforeAll(async () => {
    // ensure redis is ready
  });

  afterAll(async () => {
    // cleanup
  });

  it('should authenticate user and return tokens', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'password123' });

    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'];
    
    // Find tokens in cookies
    const accessCookie = cookies.find(c => c.startsWith('accessToken='));
    const refreshCookie = cookies.find(c => c.startsWith('refreshToken='));
    
    expect(accessCookie).toBeDefined();
    expect(refreshCookie).toBeDefined();

    accessToken = accessCookie.split(';')[0].split('=')[1];
    refreshToken = refreshCookie.split(';')[0].split('=')[1];
    firstRefreshToken = refreshToken;

    const decoded = jwt.decode(accessToken);
    expect(decoded.username).toBe('testuser');
  });

  it('should rotate refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refreshToken=${firstRefreshToken}`]);

    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'];
    
    const newRefreshCookie = cookies.find(c => c.startsWith('refreshToken='));
    const newRefresh = newRefreshCookie.split(';')[0].split('=')[1];
    
    expect(newRefresh).not.toBe(firstRefreshToken);
    refreshToken = newRefresh; // Save for next tests
  });

  it('should detect reuse of old refresh token and invalidate family', async () => {
    // firstRefreshToken is already used in the previous test. If we use it again, it's a reuse attack.
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refreshToken=${firstRefreshToken}`]);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Refresh token reuse detected/);
    
    // Now trying to use the latest, valid refresh token should also fail because the family is invalidated
    const res2 = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refreshToken=${refreshToken}`]);

    expect(res2.status).toBe(401);
    expect(res2.body.error).toMatch(/Token family is blacklisted/);
  });

  it('should blacklist access token on logout', async () => {
    // Get fresh tokens
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'password123' });

    const cookies = loginRes.headers['set-cookie'];
    const accessCookie = cookies.find(c => c.startsWith('accessToken='));
    const freshAccessToken = accessCookie.split(';')[0].split('=')[1];

    // Logout using this access token
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [`accessToken=${freshAccessToken}`]);
      
    expect(logoutRes.status).toBe(200);

    // Now try to hit a protected route (we can use logout again as a protected route for testing)
    const failRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [`accessToken=${freshAccessToken}`]);

    expect(failRes.status).toBe(401);
    expect(failRes.body.error).toBe('Token is invalid or blacklisted');
  });
});
