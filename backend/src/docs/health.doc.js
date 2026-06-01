/**
 * @openapi
 * /api/health:
 *   get:
 *     summary: System Health and Metrics
 *     description: Returns detailed health status, system metrics (CPU, Memory), and uptime information.
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
 *                       enum: [ok, degraded, error]
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
 *       500:
 *         description: Failed to retrieve health status
 */
const healthDocs = {};
export default healthDocs;
