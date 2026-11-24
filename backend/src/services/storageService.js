// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Production: Compiler Artifact S3 / Cloudflare R2 Persistent Storage Adapter
// Uploads compiled WASM binaries and build logs to S3-compatible object storage

// Unified Patent Registry & Licensing Marketplace Suite
// Extended to support IPFS-backed patent document previewers, licensing payment
// escrow evidence bundles, and dispute dashboard artifacts.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Storage configuration from environment variables
 */
const STORAGE_CONFIG = {
  endpoint: process.env.S3_ENDPOINT || process.env.R2_ENDPOINT,
  region: process.env.S3_REGION || 'us-east-1',
  accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID,
  secretAccessKey:
    process.env.S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY,
  bucket:
    process.env.S3_BUCKET || process.env.R2_BUCKET || 'soroban-playground',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  signatureVersion: process.env.S3_SIGNATURE_VERSION || 'v4',
};

// Initialize S3 client
const sa3Client = new S3Client({
  endpoint: STORAGE_CONFIG.endpoint,
  region: STORAGE_CONFIG.region,
  credentials: {
    accessKeyId: STORAGE_CONFIG.accessKeyId,
    secretAccessKey: STORAGE_CONFIG.secretAccessKey,
  },
  forcePathStyle: STORAGE_CONFIG.forcePathStyle,
});

/**
 * Artifact types for storage organization
 */
export const ARTIFACT_TYPE = {
  WASM_BINARY: 'wasm',
  BUILD_LOG: 'log',
  SOURCE_MAP: 'sourcemap',
  COMPILE_METADATA: 'metadata',
  CONTRACT_ARTIFACT: 'artifact',
  PATENT_DOCUMENT: 'patent-doc',
  LICENSING_ESCROW: 'licensing-escrow',
  DISPUTE_EVIDENCE: 'dispute-evidence',
  IPFS_MANIFEST: 'ipfs-manifest',
};

/**
 * Network identifiers
 */
export const NETWORK = {
  FUTURENET: 'futurenet',
  TESTNET: 'testnet',
  MAINNET: 'mainnet',
  LOCAL: 'local',
};

/**
 * Patent registry storage namespaces
 */
export const PATENT_STORAGE_NAMESPACE = {
  PATENTS: 'patents',
  LICENSING: 'licensing',
  DISPUTIES: 'disputes',
};

/**
 * Generate storage key for artifact
 * @param {string} contractId - Contract ID
 * @param {string} network - Network identifier
 * @param {string} artifactType - Type of artifact
 * @param {string} filename - Original filename
 * @returns {string} Storage key (path)
 */
export function generateStorageKey(
  contractId,
  network,
  artifactType,
  filename
) {
  const timestamp = Date.now();
  const ext = path.extname(filename);
  const baseName = path.basename(filename, ext);
  const sanitized = baseName.replace(/[^a-zA-Z0-9-_]/g, '_');
  return `artifacts/${network}/${contractId}/${artifactType}/${timestamp}_${sanitized}${ext}`;
}

/**
 * Generate a storage key for a patent registry object.
 * @param {string} namespace - One of PATENT_STORAGE_NAMESPACE
 * @param {string} entityId - Patent, license, or dispute ID
 * @param {string} artifactType - Artifact type
 * @param {string} filename - Original filename
 * @returns {string} Storage key
 */
export function generatePatentStorageKey(
  namespace,
  entityId,
  artifactType,
  filename
) {
  if (!Object.values(PATENT_STORAGE_NAMESPACE).includes(namespace)) {
    throw new Error(`Invalid patent storage namespace: ${namespace}`);
  }
  const timestamp = Date.now();
  const ext = path.extname(filename);
  const baseName = path.basename(filename, ext);
  const sanitized = baseName.replace(/[^a-zA-Z0-9-_]/g, '_');
  return `${namespace}/${entityId}/${artifactType}/${timestamp}_${sanitized}${ext}`;
}

/**
 * Generate hash of file content for integrity verification
 * @param {Buffer|string} content - File content
 * @returns {string} SHA-256 hash
 */
export function computeContentHash(content) {
  const hash = crypto.createHash('sha256');
  hash.update(typeof content === 'string' ? Buffer.from(content) : content);
  return hash.digest('hex');
}

/**
 * Compute a deterministic IPFS-compatible content identifier (CID) for a buffer.
 * This mirrors the multibase base32 'b' multihash format used by IPFS.
 * @param {Buffer|string} content - File content
 * @returns {string} CID string (sha256 multihash)
 */
export function computeContentIdentifier(content) {
  const buffer = typeof content === 'string' ? Buffer.from(content) : content;
  // multihash: 0x12 (sha256) + 0x20 (32 bytes) + digest
  const digest = crypto.createHash('sha256').update(buffer).digest();
  const multiHash = Buffer.concat([Buffer.from([0x12, 0x20]), digest]);
  return `b${encodeBase32(multiHash)}`;
}

/**
 * Encode a buffer as lowercase base32 without padding (RFC4648 alphabet).
 * @param {Buffer} buffer
 * @returns {string}
 */
function encodeBase32(buffer) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

/**
 * Upload buffer to S3/R2
 * @param {Buffer} buffer - File content
 * @param {string} key - Storage key
 * @param {object} metadata - Optional metadata
 * @returns {Promise<object>} Upload result
 */
async function uploadBuffer(buffer, key, metadata = {}) {
  const contentHash = computeContentHash(buffer);
  const params = {
    Bucket: STORAGE_CONFIG.bucket,
    Key: key,
    Body: buffer,
    ContentType: getContentType(key),
    Metadata: {
      ...metadata,
      contentHash,
      uploadedAt: new Date().toISOString(),
    },
  };

  // Use multipart upload for large files (> 5MB)
  if (buffer.length > 5 * 1024 * 1024) {
    const upload = new Upload({
      client: s3Client,
      params,
      queueSize: 4,
      partSize: 10 * 1024 * 1024,
      leavePartsOnError: false,
    });

    return upload.done();
  }

  const command = new PutObjectCommand(params);
  return s3Client.send(command);
}

/**
 * Get content type from file extension
 * @param {string} filename
 * @returns {string} MIME type
 */
function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const types = {
    '.wasm': 'application/wasm',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.log': 'text/plain',
    '.map': 'application/json',
    '.md': 'text/markdown',
    '.tar.gz': 'application/gzip',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };
  return types[ext] || 'application/octet-stream';
}

/**
 * Convert stream to buffer
 * @param {Readable} stream
 * @returns {Promise<Buffer>}
 */
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * StorageService - S3/R2 persistent storage for compiler artifacts and
 * patent registry objects.
 */
export class StorageService {
  constructor(options = {}) {
    this.bucket = options.bucket || STORAGE_CONFIG.bucket;
    this.client = options.client || s3Client;
  }

  /**
   * Upload compiled WASM binary
   * @param {Buffer} wasmBuffer - Compiled WASM content
   * @param {string} contractId - Contract ID
   * @param {object} metadata - Build metadata
   * @returns {Promise<object>} Upload result with key
   */
  async uploadWasmBinary(wasmBuffer, contractId, metadata = {}) {
    const key = generateStorageKey(
      contractId,
      metadata.network || NETWORK.TESTNET,
      ARTIFACT_TYPE.WASM_BINARY,
      metadata.filename || 'contract.wasm'
    );

    await uploadBuffer(wasmBuffer, key, {
      ...metadata,
      artifactType: ARTIFACT_TYPE.WASM_BINARY,
      contractId,
    });

    return {
      key,
      bucket: this.bucket,
      size: wasmBuffer.length,
      contentHash: computeContentHash(wasmBuffer),
    };
  }

  /**
   * Upload build log
   * @param {string|Buffer} logContent - Build log content
   * @param {string} contractId - Contract ID
   * @param {object} metadata - Build metadata
   * @returns {Promise<object>} Upload result
   */
  async uploadBuildLog(logContent, contractId, metadata = {}) {
    const buffer =
      typeof logContent === 'string' ? Buffer.from(logContent) : logContent;
    const key = generateStorageKey(
      contractId,
      metadata.network || NETWORK.TESTNET,
      ARTIFACT_TYPE.BUILD_LOG,
      metadata.filename || 'build.log'
    );

    await uploadBuffer(buffer, key, {
      ...metadata,
      artifactType: ARTIFACT_TYPE.BUILD_LOG,
      contractId,
    });

    return { key, bucket: this.bucket, size: buffer.length };
  }

  /**
   * Upload source map
   * @param {object} sourceMap - Source map content
   * @param {string} contractId - Contract ID
   * @param {object} metadata - Build metadata
   * @returns {Promise<object>} Upload result
   */
  async uploadSourceMap(sourceMap, contractId, metadata = {}) {
    const content = JSON.stringify(sourceMap, null, 2);
    const buffer = Buffer.from(content);
    const key = generateStorageKey(
      contractId,
      metadata.network || NETWORK.TESTNET,
      ARTIFACT_TYPE.SOURCE_MAP,
      metadata.filename || 'source.map'
    );

    await uploadBuffer(buffer, key, {
      ...metadata,
      artifactType: ARTIFACT_TYPE.SOURCE_MAP,
      contractId,
    });

    return { key, bucket: this.bucket, size: buffer.length };
  }

  /**
   * Upload compile metadata
   * @param {object} metadata - Compile metadata
   * @param {string} contractId - Contract ID
   * @returns {Promise<object>} Upload result
   */
  async uploadCompileMetadata(metadata, contractId) {
    const content = JSON.stringify(metadata, null, 2);
    const buffer = Buffer.from(content);
    const key = generateStorageKey(
      contractId,
      metadata.network || NETWORK.TESTNET,
      ARTIFACT_TYPE.COMPILE_METADATA,
      'metadata.json'
    );

    await uploadBuffer(buffer, key, {
      artifactType: ARTIFACT_TYPE.COMPILE_METADATA,
      contractId,
      rustcVersion: metadata.rustcVersion,
      cargoVersion: metadata.cargoVersion,
      timestamp: metadata.timestamp,
    });

    return { key, bucket: this.bucket, size: buffer.length };
  }

  /**
   * Upload contract artifact bundle
   * @param {object} artifact - Contract artifact object
   * @param {string} contractId - Contract ID
   * @param {object} metadata - Additional metadata
   * @returns {Promise<object>} Upload result
   */
  async uploadContractArtifact(artifact, contractId, metadata = {}) {
    const content = JSON.stringify(artifact, null, 2);
    const buffer = Buffer.from(content);
    const key = generateStorageKey(
      contractId,
      metadata.network || NETWORK.TESTNET,
      ARTIFACT_TYPE.CONTRACT_ARTIFACT,
      'artifact.json'
    );

    await uploadBuffer(buffer, key, {
      ...metadata,
      artifactType: ARTIFACT_TYPE.CONTRACT_ARTIFACT,
      contractId,
      sorobanVersion: artifact.sorobanVersion,
    });

    return { key, bucket: this.bucket, size: buffer.length };
  }

  /**
   * Upload a patent document (PDF/Markdown/etc.) and return an IPFS content identifier.
   * @param {Buffer|string} documentContent - Document bytes
   * @param {string} patentId - Patent ID
   * @param {object} metadata - Metadata (filename, mimeType, owner, etc)
   * @returns {Promise<object>} Upload result with CID and hash
   */
  async uploadPatentDocument(documentContent, patentId, metadata = {}) {
    if (!patentId) {
      throw new Error('patentId is required to upload a patent document');
    }
    const buffer =
      typeof documentContent === 'string'
        ? Buffer.from(documentContent)
        : documentContent;
    const cid = computeContentIdentifier(buffer);
    const contentHash = computeContentHash(buffer);
    const key = generatePatentStorageKey(
      PATENT_STORAGE_NAMESPACE.PATENTS,
      patentId,
      ARTIFACT_TYPE.PATENT_DOCUMENT,
      metadata.filename || 'patent.pdf'
    );

    await uploadBuffer(buffer, key, {
      ...metadata,
      artifactType: ARTIFACT_TYPE.PATENT_DOCUMENT,
      patentId,
      cid,
      contentHash,
    });

    return {
      key,
      bucket: this.bucket,
      size: buffer.length,
      cid,
      contentHash,
    };
  }

  /**
   * Upload a licensing escrow evidence bundle.
   * @param {object|string} escrowPayload - Escrow evidence
   * @param {string} licenseId - License ID
   * @param {object} metadata - Metadata
   * @returns {Promise<object>} Upload result
   */
  async uploadLicensingEscrow(escrowPayload, licenseId, metadata = {}) {
    if (!licenseId) {
      throw new Error('licenseId is required to upload an escrow bundle');
    }
    const content =
      typeof escrowPayload === 'string'
        ? escrowPayload
        : JSON.stringify(escrowPayload, null, 2);
    const buffer = Buffer.from(content);
    const contentHash = computeContentHash(buffer);
    const key = generatePatentStorageKey(
      PATENT_STORAGE_NAMESPACE.LICENSING,
      licenseId,
      ARTIFACT_TYPE.LICENSING_ESCROW,
      metadata.filename || 'escrow.json'
    );

    await uploadBuffer(buffer, key, {
      ...metadata,
      artifactType: ARTIFACT_TYPE.LICENSING_ESCROW,
      licenseId,
      contentHash,
    });

    return { key, bucket: this.bucket, size: buffer.length, contentHash };
  }

  /**
   * Upload dispute evidence for the dispute dashboard.
   * @param {object|string} evidence - Dispute evidence
   * @param {string} disputeId - Dispute ID
   * @param {object} metadata - Metadata
   * @returns {Promise<object>} Upload result
   */
  async uploadDisputeEvidence(evidence, disputeId, metadata = {}) {
    if (!disputeId) {
      throw new Error('disputeId is required to upload dispute evidence');
    }
    const content =
      typeof evidence === 'string'
        ? evidence
        : JSON.stringify(evidence, null, 2);
    const buffer = Buffer.from(content);
    const contentHash = computeContentHash(buffer);
    const key = generatePatentStorageKey(
      PATENT_STORAGE_NAMESPACE.DISPUTIES,
      disputeId,
      ARTIFACT_TYPE.DISPUTE_EVIDENCE,
      metadata.filename || 'evidence.json'
    );

    await uploadBuffer(buffer, key, {
      ...metadata,
      artifactType: ARTIFACT_TYPE.DISPUTE_EVIDENCE,
      disputeId,
      contentHash,
    });

    return { key, bucket: this.bucket, size: buffer.length, contentHash };
  }

  /**
   * Upload an IPFS manifest describing a patent document bundle.
   * @param {object} manifest - IPFS manifest object
   * @param {string} patentId - Patent ID
   * @param {object} metadata - Metadata
   * @returns {Promise<object>} Upload result
   */
  async uploadIpfsManifest(manifest, patentId, metadata = {}) {
    if (!patentId) {
      throw new Error('patentId is required to upload an IPFS manifest');
    }
    const content = JSON.stringify(manifest, null, 2);
    const buffer = Buffer.from(content);
    const cid = computeContentIdentifier(buffer);
    const key = generatePatentStorageKey(
      PATENT_STORAGE_NAMESPACE.PATENTS,
      patentId,
      ARTIFACT_TYPE.IPFS_MANIFEST,
      metadata.filename || 'manifest.json'
    );

    await uploadBuffer(buffer, key, {
      ...metadata,
      artifactType: ARTIFACT_TYPE.IPFS_MANIFEST,
      patentId,
      cid,
    });

    return { key, bucket: this.bucket, size: buffer.length, cid };
  }

  /**
   * Upload an arbitrary object (used by the IPFS document cache).
   * @param {string} key - Storage key
   * @param {Buffer|string} content - Object bytes
   * @param {object} metadata - Optional metadata
   * @returns {Promise<object>} Upload result
   */
  async putObject(key, content, metadata = {}) {
    const buffer =
      typeof content === 'string' ? Buffer.from(content) : content;
    await uploadBuffer(buffer, key, metadata);
    return {
      key,
      bucket: this.bucket,
      size: buffer.length,
      contentHash: computeContentHash(buffer),
    };
  }

  /**
   * Download an object as a Buffer.
   * @param {string} key - Storage key
   * @returns {Promise<Buffer>}
   */
  async download(key) {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const response = await this.client.send(command);
    return streamToBuffer(response.Body);
  }

  /**
   * Check if an object exists.
   * @param {string} key - Storage key
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    try {
      const command = new HeadObjectCommand({ Bucket: this.bucket, Key: key });
      await this.client.send(command);
      return true;
    } catch (err) {
      if (err.$metadata && err.$metadata.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Delete an object.
   * @param {string} key - Storage key
   * @returns {Promise<void>}
   */
  async delete(key) {
    const command = new DeleteObjectCommand({ Bucket: this.bucket, Key: key });
    await this.client.send(command);
  }

  /**
   * List objects under a prefix.
   * @param {string} prefix - Key prefix
   * @returns {Promise<Array<object>>}
   */
  async list(prefix = '') {
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
    });
    const response = await this.client.send(command);
    return response.Contents || [];
  }
}

export const storageService = new StorageService();
export default storageService;
