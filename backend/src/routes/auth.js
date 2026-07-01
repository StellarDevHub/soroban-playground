import express from 'express';
import authService from '../services/authService.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

const setCookies = (res, accessToken, refreshToken) => {
  const isProd = process.env.NODE_ENV === 'production';
  
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000 // 15 minutes
  });

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
};

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // In a real application, verify username and password against DB.
    // For this implementation we will accept dummy credentials to demonstrate token rotation.
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const dummyUser = { id: 'user_123', username };
    
    const { accessToken, refreshToken } = authService.generateTokens(dummyUser);
    
    setCookies(res, accessToken, refreshToken);
    
    return res.status(200).json({ success: true, message: 'Logged in successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token provided' });
    }

    const { accessToken: newAccess, refreshToken: newRefresh } = await authService.rotateRefreshToken(refreshToken);
    
    setCookies(res, newAccess, newRefresh);
    
    return res.status(200).json({ success: true, message: 'Token refreshed successfully' });
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  try {
    const user = req.user; // populated by requireAuth middleware
    if (user && user.jti && user.exp) {
      await authService.blacklistAccessToken(user.jti, user.exp);
    }
    
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    return res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
