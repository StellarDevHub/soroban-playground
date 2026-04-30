/**
 * @openapi
 * tags:
 *   - name: OrderBook
 *     description: Limit Order Book — place, cancel, and query orders and trades
 *
 * components:
 *   schemas:
 *     Order:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         owner:
 *           type: string
 *         side:
 *           type: string
 *           enum: [buy, sell]
 *         price:
 *           type: number
 *         quantity:
 *           type: number
 *         remaining:
 *           type: number
 *         status:
 *           type: string
 *           enum: [open, partially_filled, filled, cancelled]
 *         createdAt:
 *           type: integer
 *           description: Unix timestamp in milliseconds
 *     Trade:
 *       type: object
 *       properties:
 *         buyOrderId:
 *           type: integer
 *         sellOrderId:
 *           type: integer
 *         price:
 *           type: number
 *         quantity:
 *           type: number
 *         executedAt:
 *           type: integer
 *
 * /api/orderbook:
 *   get:
 *     summary: Get current order book
 *     description: Returns all open and partially-filled bids (sorted best price first) and asks.
 *     tags: [OrderBook]
 *     responses:
 *       200:
 *         description: Order book snapshot
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     bids:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Order'
 *                     asks:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Order'
 *
 * /api/orderbook/orders:
 *   post:
 *     summary: Place a limit order
 *     tags: [OrderBook]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [owner, side, price, quantity]
 *             properties:
 *               owner:
 *                 type: string
 *                 example: "GABC...XYZ"
 *               side:
 *                 type: string
 *                 enum: [buy, sell]
 *               price:
 *                 type: number
 *                 example: 10000000
 *               quantity:
 *                 type: number
 *                 example: 5000000
 *     responses:
 *       201:
 *         description: Order placed; includes any immediate trades
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     order:
 *                       $ref: '#/components/schemas/Order'
 *                     trades:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Trade'
 *       400:
 *         description: Validation error
 *
 * /api/orderbook/orders/{id}:
 *   get:
 *     summary: Get a single order
 *     tags: [OrderBook]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Order details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Order'
 *       404:
 *         description: Order not found
 *
 * /api/orderbook/orders/{id}/cancel:
 *   post:
 *     summary: Cancel an order
 *     tags: [OrderBook]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [owner]
 *             properties:
 *               owner:
 *                 type: string
 *     responses:
 *       200:
 *         description: Order cancelled
 *       403:
 *         description: Not order owner
 *       404:
 *         description: Order not found
 *       409:
 *         description: Order already inactive
 *
 * /api/orderbook/trades:
 *   get:
 *     summary: Get trade history
 *     tags: [OrderBook]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Paginated trade history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     trades:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Trade'
 *                     total:
 *                       type: integer
 *
 * /api/orderbook/stats:
 *   get:
 *     summary: Get order book statistics
 *     tags: [OrderBook]
 *     responses:
 *       200:
 *         description: Aggregate statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalOrders:
 *                       type: integer
 *                     openOrders:
 *                       type: integer
 *                     totalTrades:
 *                       type: integer
 *                     totalVolume:
 *                       type: number
 */
const orderBookDocs = {};
export default orderBookDocs;
