/**
 * @openapi
 * /api/freelancer-identity/profiles:
 *   get:
 *     summary: List freelancer identity profiles
 *     tags:
 *       - Freelancer Identity
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *       - in: query
 *         name: verifiedOnly
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Profiles sorted by reputation
 *   post:
 *     summary: Create a freelancer identity profile
 *     tags:
 *       - Freelancer Identity
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - owner
 *               - handle
 *               - portfolioUrl
 *             properties:
 *               owner:
 *                 type: string
 *               handle:
 *                 type: string
 *               bio:
 *                 type: string
 *               portfolioUrl:
 *                 type: string
 *               skills:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Profile created
 *
 * /api/freelancer-identity/portfolio-verifications:
 *   post:
 *     summary: Record a portfolio verification
 *     tags:
 *       - Freelancer Identity
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - owner
 *               - verifier
 *               - score
 *             properties:
 *               owner:
 *                 type: string
 *               verifier:
 *                 type: string
 *               projectUrl:
 *                 type: string
 *               evidenceUrl:
 *                 type: string
 *               score:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 100
 *     responses:
 *       201:
 *         description: Verification recorded
 *
 * /api/freelancer-identity/skill-endorsements:
 *   post:
 *     summary: Record a skill endorsement
 *     tags:
 *       - Freelancer Identity
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - owner
 *               - endorser
 *               - skill
 *               - weight
 *             properties:
 *               owner:
 *                 type: string
 *               endorser:
 *                 type: string
 *               skill:
 *                 type: string
 *               evidenceUrl:
 *                 type: string
 *               weight:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 10
 *     responses:
 *       201:
 *         description: Endorsement recorded
 *
 * /api/freelancer-identity/analytics:
 *   get:
 *     summary: Get freelancer identity analytics
 *     tags:
 *       - Freelancer Identity
 *     responses:
 *       200:
 *         description: Aggregate identity metrics
 */
const freelancerIdentityDocs = {};
export default freelancerIdentityDocs;
