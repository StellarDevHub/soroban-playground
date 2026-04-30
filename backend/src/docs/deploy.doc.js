/**
 * @openapi
 * /api/deploy:
 *   post:
 *     summary: Deploy a Soroban smart contract
 *     description: Deploys a compiled WASM contract to a specified network (simulated for MVP).
 *     tags:
 *       - Deploy
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wasmPath
 *               - contractName
 *             properties:
 *               wasmPath:
 *                 type: string
 *                 description: Path or identifier of the compiled WASM file.
 *               contractName:
 *                 type: string
 *                 description: Name for the contract.
 *               network:
 *                 type: string
 *                 default: testnet
 *                 enum: [testnet, futurenet, standalone]
 *     responses:
 *       200:
 *         description: Successfully deployed contract
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 status:
 *                   type: string
 *                 contractId:
 *                   type: string
 *                 contractName:
 *                   type: string
 *                 network:
 *                   type: string
 *                 wasmPath:
 *                   type: string
 *                 deployedAt:
 *                   type: string
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation failed
 *       500:
 *         description: Deployment failed
 */
const deployDocs = {};
export default deployDocs;
