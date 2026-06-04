/**
 * @openapi
 * /api/invoke:
 *   post:
 *     summary: Invoke Contract Function
 *     description: |
 *       Executes a specific function on a deployed Soroban contract.
 *       Supports both read-only (get) and state-changing (set) functions on Stellar Testnet.
 *     tags:
 *       - Smart Contracts
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contractId
 *               - functionName
 *             properties:
 *               contractId:
 *                 type: string
 *                 description: The unique identifier of the deployed contract.
 *                 example: "C..."
 *               functionName:
 *                 type: string
 *                 description: The name of the function to be invoked.
 *                 example: "hello"
 *               args:
 *                 type: object
 *                 description: JSON object representing the function arguments.
 *                 example: { "name": "Stellar" }
 *               network:
 *                 type: string
 *                 enum: [testnet, futurenet, local]
 *                 default: testnet
 *     responses:
 *       200:
 *         description: Invocation successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 output:
 *                   type: object
 *                   description: The parsed output from the contract function.
 *                 stdout:
 *                   type: string
 *                   description: Raw CLI output.
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation failed (invalid contract ID or function name)
 *       502:
 *         description: Contract invocation failed (CLI error)
 *       504:
 *         description: Invocation timed out
 */
const invokeDocs = {};
export default invokeDocs;
