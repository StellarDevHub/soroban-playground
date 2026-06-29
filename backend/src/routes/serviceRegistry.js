// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { serviceRegistry } from '../services/serviceRegistry.js';

const router = express.Router();

/** GET /api/registry/services — list all service names */
router.get('/services', (_req, res) => {
  res.json({ success: true, data: serviceRegistry.listServices() });
});

/** GET /api/registry/services/:name — list instances for a service */
router.get(
  '/services/:name',
  asyncHandler(async (req, res) => {
    const { name } = req.params;
    const instances = serviceRegistry.list(name);
    res.json({ success: true, data: instances });
  }),
);

/** GET /api/registry/services/:name/resolve — round-robin lookup */
router.get(
  '/services/:name/resolve',
  asyncHandler(async (req, res) => {
    const { name } = req.params;
    const instance = serviceRegistry.lookup(name);
    if (!instance) {
      return res.status(404).json({ error: `No healthy instances for service '${name}'` });
    }
    res.json({ success: true, data: instance });
  }),
);

/** POST /api/registry/register — register a service instance */
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { name, instanceId, host, port, metadata } = req.body;
    if (!name || !instanceId || !host || !port) {
      return res.status(400).json({ error: 'name, instanceId, host, and port are required' });
    }
    serviceRegistry.register({ name, instanceId, host, port: Number(port), metadata });
    res.status(201).json({ success: true, data: { instanceId } });
  }),
);

/** POST /api/registry/heartbeat — update heartbeat for an instance */
router.post(
  '/heartbeat',
  asyncHandler(async (req, res) => {
    const { name, instanceId } = req.body;
    if (!name || !instanceId) {
      return res.status(400).json({ error: 'name and instanceId are required' });
    }
    serviceRegistry.heartbeat(name, instanceId);
    res.json({ success: true });
  }),
);

/** DELETE /api/registry/services/:name/:instanceId — deregister */
router.delete(
  '/services/:name/:instanceId',
  asyncHandler(async (req, res) => {
    const { name, instanceId } = req.params;
    serviceRegistry.deregister(name, instanceId);
    res.json({ success: true });
  }),
);

export default router;
