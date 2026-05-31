/**
 * @openapi
 * /api/compile:
 *   post:
 *     summary: Compile Soroban Rust Code
 *     description: |
 *       Compiles provided Rust smart contract code into a WASM binary.
 *       The service handles project scaffolding, compilation using Cargo, and artifact management.
 *     tags:
 *       - Smart Contracts
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
 *                 description: The Rust source code to compile.
 *                 example: "pub fn add(a: u32, b: u32) -> u32 { a + b }"
 *               options:
 *                 type: object
 *                 properties:
 *                   optimization:
 *                     type: string
 *                     enum: [size, speed]
 *                     default: size
 *     responses:
 *       200:
 *         description: Compilation completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: string
 *                   example: completed
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
 *                       example: "contract.wasm"
 *                     sizeBytes:
 *                       type: integer
 *                       example: 45230
 *                     hash:
 *                       type: string
 *                       example: "sha256:..."
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid request parameters or source code
 *       500:
 *         description: Internal compilation error or timeout
 */
const compileDocs = {};
export default compileDocs;
