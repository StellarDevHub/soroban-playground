/**
 * @openapi
 * /api/versions:
 *   get:
 *     summary: List supported API versions
 *     tags:
 *       - Versioning
 *     responses:
 *       200:
 *         description: Supported API versions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 */
const versioningDocs = {};
export default versioningDocs;
