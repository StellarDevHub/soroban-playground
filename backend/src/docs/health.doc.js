/**
 * @openapi
 * /api/health:
 *   get:
 *     summary: API Health Check
 *     description: Check the health of the API
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: API is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 message:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                 service:
 *                   type: string
 */
const healthDocs = {};
export default healthDocs;
