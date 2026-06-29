// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @swagger
 * tags:
 *   name: Snippets
 *   description: Save and retrieve shareable code snippets
 */

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { saveSnippet, getSnippet } from '../services/snippetService.js';

const router = express.Router();

/**
 * @swagger
 * /snippets:
 *   post:
 *     summary: Save a code snippet and get a shareable URL
 *     tags: [Snippets]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code:
 *                 type: string
 *                 description: The source code to save
 *               language:
 *                 type: string
 *                 default: rust
 *               title:
 *                 type: string
 *                 default: Untitled Snippet
 *     responses:
 *       201:
 *         description: Snippet saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 snippet:
 *                   $ref: '#/components/schemas/Snippet'
 *       400:
 *         description: Missing code
 */
router.post(
  '/',
  asyncHandler(async (req, res, next) => {
    const { code, language, title } = req.body || {};
    if (!code) return next(createHttpError(400, 'code is required'));

    const baseUrl = `${req.protocol}://${req.get('host')}/api`;
    const snippet = saveSnippet({ code, language, title }, baseUrl);

    return res.status(201).json({ success: true, snippet });
  }),
);

/**
 * @swagger
 * /snippets/{id}:
 *   get:
 *     summary: Retrieve a code snippet by ID
 *     tags: [Snippets]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Snippet ID
 *     responses:
 *       200:
 *         description: The snippet
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 snippet:
 *                   $ref: '#/components/schemas/Snippet'
 *       404:
 *         description: Snippet not found
 */
router.get(
  '/:id',
  asyncHandler(async (req, res, next) => {
    const snippet = getSnippet(req.params.id);
    if (!snippet) return next(createHttpError(404, 'Snippet not found'));
    return res.json({ success: true, snippet });
  }),
);

export default router;
