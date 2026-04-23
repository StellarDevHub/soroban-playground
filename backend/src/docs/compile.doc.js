/**
 * @openapi
 * /api/compile:
 *   post:
 *     summary: Compile a Soroban smart contract
 *     description: Takes Rust code, scaffolds a temporary project, and compiles it into a WASM binary.
 *     tags:
 *       - Compile
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *             properties:
 *               code:
 *                 type: string
 *                 description: The Rust code of the smart contract to compile.
 *     responses:
 *       200:
 *         description: Successfully compiled contract
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 status:
 *                   type: string
 *                 message:
 *                   type: string
 *                 logs:
 *                   type: array
 *                   items:
 *                     type: string
 *                 artifact:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     sizeBytes:
 *                       type: integer
 *                     createdAt:
 *                       type: string
 *       400:
 *         description: Bad request (no code provided)
 *       500:
 *         description: Compilation failed or internal server error
 */
const compileDocs = {};
export default compileDocs;
