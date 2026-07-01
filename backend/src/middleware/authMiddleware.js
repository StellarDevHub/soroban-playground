import authService from '../services/authService.js';

export const requireAuth = async (req, res, next) => {
  try {
    let token = null;

    if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = await authService.verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.message === 'Token is blacklisted') {
      return res.status(401).json({ error: 'Token is invalid or blacklisted' });
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
