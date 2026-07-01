// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * In-memory snippet store for shareable code snippets.
 * Keyed by a short random ID; production deployments should swap this
 * map for a persistent database or Redis instance.
 *
 * @module snippetService
 */

import { randomBytes } from 'crypto';

/** @type {Map<string, import('../types/index.ts').Snippet>} */
const store = new Map();

/**
 * Generate a URL-safe random ID (8 hex chars).
 * @returns {string}
 */
function generateId() {
  return randomBytes(4).toString('hex');
}

/**
 * Save a code snippet and return the persisted record.
 *
 * @param {import('../types/index.ts').SaveSnippetInput} input
 * @param {string} baseUrl - The request base URL used to build the share link.
 * @returns {import('../types/index.ts').Snippet}
 */
export function saveSnippet(input, baseUrl) {
  const id = generateId();
  const snippet = {
    id,
    code: input.code,
    language: input.language || 'rust',
    title: input.title || 'Untitled Snippet',
    createdAt: new Date().toISOString(),
    shareUrl: `${baseUrl}/snippets/${id}`,
  };
  store.set(id, snippet);
  return snippet;
}

/**
 * Retrieve a snippet by ID.
 *
 * @param {string} id
 * @returns {import('../types/index.ts').Snippet|null}
 */
export function getSnippet(id) {
  return store.get(id) ?? null;
}

/**
 * Return all snippets (for admin/debug use).
 *
 * @returns {import('../types/index.ts').Snippet[]}
 */
export function listSnippets() {
  return Array.from(store.values());
}
