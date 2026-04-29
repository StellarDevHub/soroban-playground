import express from 'express';

import compileRoute from './compile.js';
import deployRoute from './deploy.js';
import eventsRouter from './events.js';
import invokeRoute from './invoke.js';
import patentsRoute from './patents.js';
import searchRoute from './search.js';

const router = express.Router();

router.use('/compile', compileRoute);
router.use('/deploy', deployRoute);
router.use('/invoke', invokeRoute);
router.use('/events', eventsRouter);
router.use('/search', searchRoute);
router.use('/patents', patentsRoute);

export default router;
