/**
 * @openapi
 * /api/patents:
 *   get:
 *     summary: Load patent dashboard data
 *     tags:
 *       - Patents
 *     responses:
 *       200:
 *         description: Patent dashboard payload
 * /api/patents/items:
 *   get:
 *     summary: List patents
 *     tags:
 *       - Patents
 *   post:
 *     summary: Register a patent
 *     tags:
 *       - Patents
 * /api/patents/items/{id}:
 *   patch:
 *     summary: Update a patent
 *     tags:
 *       - Patents
 * /api/patents/items/{id}/verify:
 *   post:
 *     summary: Verify a patent
 *     tags:
 *       - Patents
 * /api/patents/licenses:
 *   get:
 *     summary: List license offers
 *     tags:
 *       - Patents
 *   post:
 *     summary: Create a license offer
 *     tags:
 *       - Patents
 * /api/patents/licenses/{id}:
 *   patch:
 *     summary: Update a license offer
 *     tags:
 *       - Patents
 * /api/patents/licenses/{id}/accept:
 *   post:
 *     summary: Accept a license offer
 *     tags:
 *       - Patents
 * /api/patents/history:
 *   get:
 *     summary: List transaction history
 *     tags:
 *       - Patents
 */
const patentDocs = {};

export default patentDocs;
