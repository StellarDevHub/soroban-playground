import express from 'express';
import v1Compile from './v1/compile.js';
import v1Deploy from './v1/deploy.js';
import v1Invoke from './v1/invoke.js';
import v2Compile from './v2/compile.js';
import v2Deploy from './v2/deploy.js';
import v2Invoke from './v2/invoke.js';
import eventsRouter from './events.js';
import subscriptionRouter from './subscription.js';
import { versionTransformer, requestTransformerV2 } from '../middleware/versionTransformer.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';

import { versions } from '../config/versions.js';
import { deprecationHeaders } from '../middleware/deprecationHeaders.js';

const router = express.Router();

// Apply deprecation/version headers to all versioned routes
router.use(deprecationHeaders);

// Version discovery endpoint
router.get('/versions', (req, res) => {
  res.json({
    success: true,
    data: Object.values(versions)
  });
});

// v1 Routes
const v1Router = express.Router();
v1Router.use(versionTransformer('v1'));
v1Router.use('/compile', rateLimitMiddleware('compile'), v1Compile);
v1Router.use('/deploy', rateLimitMiddleware('deploy'), v1Deploy);
v1Router.use('/invoke', rateLimitMiddleware('invoke'), v1Invoke);

// v2 Routes
const v2Router = express.Router();
v2Router.use(versionTransformer('v2'));
v2Router.use(requestTransformerV2); // Optional: transform v1-style requests to v2 if needed (e.g., if we had a single implementation)
v2Router.use('/compile', rateLimitMiddleware('compile'), v2Compile);
v2Router.use('/deploy', rateLimitMiddleware('deploy'), v2Deploy);
v2Router.use('/invoke', rateLimitMiddleware('invoke'), v2Invoke);

// Register versioned routes
router.use('/v1', v1Router);
router.use('/v2', v2Router);
router.use('/oracle', oracleRouter);

// Default to v1 for backward compatibility (requests to /api/compile, etc.)
router.use('/compile', versionTransformer('v1'), rateLimitMiddleware('compile'), v1Compile);
router.use('/deploy', versionTransformer('v1'), rateLimitMiddleware('deploy'), v1Deploy);
router.use('/invoke', versionTransformer('v1'), rateLimitMiddleware('invoke'), v1Invoke);
router.use('/events', eventsRouter);
router.use('/subscription', subscriptionRouter);

export default router;
