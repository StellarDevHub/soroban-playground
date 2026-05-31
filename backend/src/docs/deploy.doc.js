/**
 * @openapi
 * /api/deploy:
 *   post:
 *     summary: Deploy Smart Contract
 *     description: |
 *       Deploys a compiled WASM contract artifact to the specified Stellar network.
 *       The deployment process includes uploading the WASM and instantiating the contract.
 *     tags:
 *       - Smart Contracts
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wasmHash
 *               - alias
 *             properties:
 *               wasmHash:
 *                 type: string
 *                 description: The unique hash of the compiled WASM artifact.
 *                 example: "sha256:..."
 *               alias:
 *                 type: string
 *                 description: A human-readable alias for the deployed contract.
 *                 example: "my_token"
 *               network:
 *                 type: string
 *                 enum: [testnet, futurenet, local]
 *                 default: testnet
 *               sourceAccount:
 *                 type: string
 *                 description: The Stellar account address used for deployment.
 *                 example: "G..."
 *     responses:
 *       200:
 *         description: Contract deployed successfully
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
 *                   example: deployed
 *                 contractId:
 *                   type: string
 *                   example: "C..."
 *                 alias:
 *                   type: string
 *                 network:
 *                   type: string
 *                 deployedAt:
 *                   type: string
 *                   format: date-time
 *                 transactionHash:
 *                   type: string
 *                   example: "0x..."
 *       400:
 *         description: Invalid WASM hash or missing required fields
 *       500:
 *         description: Deployment failed on network
 */
const deployDocs = {};
export default deployDocs;
