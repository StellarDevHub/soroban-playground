import warrantyRoutes from './warranty.js';
import favoritesRoutes from './favorites.js';
import express from 'express';
import v1Compile from './v1/compile.js';
import v1Deploy from './v1/deploy.js';
import v1Invoke from './v1/invoke.js';
import v1Identity from './v1/identity.js';
import v2Compile from './v2/compile.js';
import v2Deploy from './v2/deploy.js';
import v2Invoke from './v2/invoke.js';
import v2Identity from './v2/identity.js';
import v2Lottery from './v2/lottery.js';
import eventsRouter from './events.js';
import patentsRouter from './patents.js';
import tokenBurnRouter from './tokenBurn.js';
import oracleRouter from './oracle.js';
import {
  versionTransformer,
  requestTransformerV2,
} from '../middleware/versionTransformer.js';

import { versions } from '../config/versions.js';
import { deprecationHeaders } from '../middleware/deprecationHeaders.js';
import {
  dispatchByApiVersion,
  negotiateApiVersion,
  rejectUnsupportedUriVersion,
} from '../middleware/apiVersioning.js';

const router = express.Router();

// Version discovery endpoint
router.get('/versions', (req, res) => {
  res.json({
    success: true,
    data: Object.values(versions),
  });
});

// v1 Routes
const v1Router = express.Router();
v1Router.use(versionTransformer('v1'));
v1Router.use('/compile', v1Compile);
v1Router.use('/deploy', v1Deploy);
v1Router.use('/invoke', v1Invoke);
v1Router.use('/identity', v1Identity);
v1Router.use('/lottery', v2Lottery);

// v2 Routes
const v2Router = express.Router();
v2Router.use(versionTransformer('v2'));
v2Router.use(requestTransformerV2); // Optional: transform v1-style requests to v2 if needed (e.g., if we had a single implementation)
v2Router.use('/compile', v2Compile);
v2Router.use('/deploy', v2Deploy);
v2Router.use('/invoke', v2Invoke);
v2Router.use('/identity', v2Identity);
v2Router.use('/lottery', v2Lottery);

const versionRouters = {
  v1: v1Router,
  v2: v2Router,
};

const headerVersionedPaths = [
  '/compile',
  '/deploy',
  '/invoke',
  '/identity',
  '/lottery',
];

function isHeaderVersionedPath(path) {
  return headerVersionedPaths.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

// Register versioned routes
router.use(
  '/v1',
  negotiateApiVersion({ uriVersion: 'v1' }),
  deprecationHeaders,
  v1Router
);
router.use(
  '/v2',
  negotiateApiVersion({ uriVersion: 'v2' }),
  deprecationHeaders,
  v2Router
);
router.use((req, res, next) => {
  if (/^\/v\d+(?:\/|$)/i.test(req.path)) {
    return rejectUnsupportedUriVersion(req, res, next);
  }

  return next();
});
router.use('/oracle', oracleRouter);

// Default to v1 for backward compatibility, while allowing headers such as:
// Accept: application/vnd.soroban-playground.v2+json
// Accept-Version: v2
router.use(
  (req, res, next) => {
    if (!isHeaderVersionedPath(req.path)) return next();
    return negotiateApiVersion()(req, res, next);
  },
  (req, res, next) => {
    if (!req.apiVersion) return next();
    return deprecationHeaders(req, res, next);
  },
  (req, res, next) => {
    if (!req.apiVersion) return next();
    return dispatchByApiVersion(versionRouters)(req, res, next);
  }
);

router.use('/events', eventsRouter);
router.use('/patents', patentsRouter);
router.use('/token-burn', tokenBurnRouter);

import bugBountyRoutes from './bugBountyRoutes.js';
router.use('/bug-bounty', bugBountyRoutes);

import musicLicensingRoutes from './musicLicensingRoutes.js';
router.use('/music-licensing', musicLicensingRoutes);

router.use('/warranty', warrantyRoutes);
router.use('/favorites', favoritesRoutes);
export default router;
