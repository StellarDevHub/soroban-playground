/**
 * @openapi
 * /health:
 *   get:
 *     summary: Deep Health Check with Dependency Uptime
 *     description: Performs cached deep checks on SQLite, Redis, and Soroban RPC. Returns 503 when any core dependency is unhealthy.
 *     tags:
 *       - System
 *     parameters:
 *       - in: query
 *         name: refresh
 *         schema:
 *           type: boolean
 *         description: Bypass the 2-5s result cache when true
 *     responses:
 *       200:
 *         description: All dependencies healthy or degraded
 *       503:
 *         description: One or more core dependencies failed
 * /health/live:
 *   get:
 *     summary: Liveness Probe
 *     description: Fast liveness check finishing within 200ms for Kubernetes and external monitors.
 *     tags:
 *       - System
 *     responses:
 *       200:
 *         description: Process is alive
 * /api/health:
 *   get:
 *     summary: System Health and Metrics
 *     description: Returns detailed health status, dependency checks, system metrics (CPU, Memory), and uptime information.
 *     tags:
 *       - System
 *     responses:
 *       200:
 *         description: System health information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       enum: [ok, degraded, unhealthy]
 *                       example: ok
 *                     version:
 *                       type: string
 *                       example: 1.0.0
 *                     service:
 *                       type: string
 *                       example: soroban-playground-backend
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                     dependencies:
 *                       type: object
 *                     dependencyUptime:
 *                       type: object
 *                     uptime:
 *                       type: object
 *                       properties:
 *                         processHuman:
 *                           type: string
 *                           example: 2h 15m 30s
 *                         systemHuman:
 *                           type: string
 *                           example: 10d 4h 2m
 *                     cpu:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           core:
 *                             type: integer
 *                           usedPercent:
 *                             type: number
 *                     memory:
 *                       type: object
 *                       properties:
 *                         totalMB:
 *                           type: number
 *                         usedMB:
 *                           type: number
 *                         usedPercent:
 *                           type: number
 *       503:
 *         description: One or more core dependencies failed
 */
const healthDocs = {};
export default healthDocs;
