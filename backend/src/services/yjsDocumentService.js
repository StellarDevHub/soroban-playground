// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import * as Y from 'yjs';
import { getDatabase } from '../database/connection.js';

function normalizeId(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim().slice(0, 256);
}

function decodeBase64(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a base64 string`);
  }
  try {
    return Uint8Array.from(Buffer.from(value, 'base64'));
  } catch {
    throw new Error(`${name} is not valid base64`);
  }
}

function encodeBase64(value) {
  return Buffer.from(value).toString('base64');
}

function toUint8Array(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Buffer.isBuffer(value)) return Uint8Array.from(value);
  if (typeof value === 'string') {
    return Uint8Array.from(Buffer.from(value, 'base64'));
  }
  return null;
}

const inMemoryDocs = new Map();

function roomDoc(projectId, documentId) {
  const key = `${projectId}:${documentId}`;
  if (!inMemoryDocs.has(key)) inMemoryDocs.set(key, new Y.Doc());
  return inMemoryDocs.get(key);
}

export async function loadYjsDocument(projectId, documentId) {
  const project = normalizeId(projectId, 'projectId');
  const docId = normalizeId(documentId, 'documentId');
  const db = getDatabase();
  const row = await db.get(
    'SELECT snapshot FROM yjs_documents WHERE project_id = ? AND document_id = ?',
    [project, docId]
  );
  const doc = roomDoc(project, docId);
  if (row?.snapshot) {
    const snapshot = toUint8Array(row.snapshot);
    if (snapshot?.length) Y.applyUpdate(doc, snapshot);
  }
  return doc;
}

export async function applyYjsUpdate(projectId, documentId, updateValue) {
  const project = normalizeId(projectId, 'projectId');
  const docId = normalizeId(documentId, 'documentId');
  const update = typeof updateValue === 'string'
    ? decodeBase64(updateValue, 'update')
    : toUint8Array(updateValue);
  if (!update?.length) throw new Error('update must contain Yjs binary data');

  const db = getDatabase();
  const doc = await loadYjsDocument(project, docId);
  Y.applyUpdate(doc, update);

  const fullState = Y.encodeStateAsUpdate(doc);
  const stateVector = Y.encodeStateVector(doc);
  await db.run(
    `INSERT INTO yjs_documents (project_id, document_id, snapshot, state_vector, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(project_id, document_id) DO UPDATE SET
       snapshot = excluded.snapshot,
       state_vector = excluded.state_vector,
       updated_at = CURRENT_TIMESTAMP`,
    [project, docId, encodeBase64(fullState), encodeBase64(stateVector)]
  );
  await db.run(
    `INSERT INTO yjs_document_updates (project_id, document_id, update_data, state_vector)
     VALUES (?, ?, ?, ?)`,
    [project, docId, encodeBase64(update), encodeBase64(stateVector)]
  );

  return {
    projectId: project,
    documentId: docId,
    update: encodeBase64(update),
    snapshot: encodeBase64(fullState),
    stateVector: encodeBase64(stateVector),
  };
}

export async function getYjsDocumentState(projectId, documentId) {
  const project = normalizeId(projectId, 'projectId');
  const docId = normalizeId(documentId, 'documentId');
  const db = getDatabase();
  const row = await db.get(
    'SELECT snapshot, state_vector, updated_at FROM yjs_documents WHERE project_id = ? AND document_id = ?',
    [project, docId]
  );
  if (!row) {
    const doc = roomDoc(project, docId);
    return {
      projectId: project,
      documentId: docId,
      snapshot: encodeBase64(Y.encodeStateAsUpdate(doc)),
      stateVector: encodeBase64(Y.encodeStateVector(doc)),
      updatedAt: null,
    };
  }
  return {
    projectId: project,
    documentId: docId,
    snapshot: typeof row.snapshot === 'string' ? row.snapshot : encodeBase64(toUint8Array(row.snapshot) ?? new Uint8Array()),
    stateVector: typeof row.state_vector === 'string' ? row.state_vector : encodeBase64(toUint8Array(row.state_vector) ?? new Uint8Array()),
    updatedAt: row.updated_at,
  };
}

export async function getYjsUpdatesSince(projectId, documentId, sinceId = 0) {
  const project = normalizeId(projectId, 'projectId');
  const docId = normalizeId(documentId, 'documentId');
  const db = getDatabase();
  const rows = await db.all(
    'SELECT id, update_data, state_vector, created_at FROM yjs_document_updates WHERE project_id = ? AND document_id = ? AND id > ? ORDER BY id ASC',
    [project, docId, Number(sinceId) || 0]
  );
  return rows.map((row) => ({
    id: row.id,
    update: typeof row.update_data === 'string' ? row.update_data : encodeBase64(toUint8Array(row.update_data) ?? new Uint8Array()),
    stateVector: typeof row.state_vector === 'string' ? row.state_vector : encodeBase64(toUint8Array(row.state_vector) ?? new Uint8Array()),
    createdAt: row.created_at,
  }));
}
