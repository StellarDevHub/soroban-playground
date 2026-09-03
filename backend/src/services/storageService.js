// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Production: Compiler Artifact S3 / Cloudflare R2 Persistent Storage Adapter
// Uploads compiled WASM binaries and build logs to S3-compatible object storage

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
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
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.S3_BUCKET || process.env.R2_BUCKET || 'soroban-playground',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  signatureVersion: process.env.S3_SIGNATURE_VERSION || 'v4',
};

// Initialize S3 client
const s3Client = new S3Client({
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
 * Generate storage key for artifact
 * @param {string} contractId - Contract ID
 * @param {string} network - Network identifier
 * @param {string} artifactType - Type of artifact
 * @param {string} filename - Original filename
 * @returns {string} Storage key (path)
 */
export function generateStorageKey(contractId, network, artifactType, filename) {
  const timestamp = Date.now();
  const ext = path.extname(filename);
  const baseName = path.basename(filename, ext);
  const sanitized = baseName.replace(/[^a-zA-Z0-9-_]/g, '_');
  return `artifacts/${network}/${contractId}/${artifactType}/${timestamp}_${sanitized}${ext}`;
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
 * StorageService - S3/R2 persistent storage for compiler artifacts
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
    const key = generateStorageKey(contractId, metadata.network || NETWORK.TESTNET, ARTIFACT_TYPE.WASM_BINARY, metadata.filename || 'contract.wasm');
    
    await uploadBuffer(wasmBuffer, key, {
      ...metadata,
      artifactType: ARTIFACT_TYPE.WASM_BINARY,
      contractId,
    });

    return { key, bucket: this.bucket, size: wasmBuffer.length, contentHash: computeContentHash(wasmBuffer) };
  }

  /**
   * Upload build log
   * @param {string|Buffer} logContent - Build log content
   * @param {string} contractId - Contract ID
   * @param {object} metadata - Build metadata
   * @returns {Promise<object>} Upload result
   */
  async uploadBuildLog(logContent, contractId, metadata = {}) {
    const buffer = typeof logContent === 'string' ? Buffer.from(logContent) : logContent;
    const key = generateStorageKey(contractId, metadata.network || NETWORK.TESTNET, ARTIFACT_TYPE.BUILD_LOG, metadata.filename || 'build.log');
    
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
    const key = generateStorageKey(contractId, metadata.network || NETWORK.TESTNET, ARTIFACT_TYPE.SOURCE_MAP, metadata.filename || 'source.map');
    
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
    const key = generateStorageKey(contractId, metadata.network || NETWORK.TESTNET, ARTIFACT_TYPE.COMPILE_METADATA, 'metadata.json');
    
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
    const key = generateStorageKey(contractId, metadata.network || NETWORK.TESTNET, ARTIFACT_TYPE.CONTRACT_ARTIFACT, 'artifact.json');
    
    await uploadBuffer(buffer, key, {
      ...metadata,
      artifactType: ARTIFACT_TYPE.CONTRACT_ARTIFACT,
      contractId,
      sorobanVersion: artifact.sorobanVersion,
    });

    return { key, bucket: this.bucket, size: buffer.length };
  }

  /**
   * Download artifact by key
   * @param {string} key - Storage key
   * @returns {Promise<object>} Downloaded content
   */
  async download(key) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);
    const buffer = await streamToBuffer(response.Body);
    
    return {
      content: buffer,
      contentType: response.ContentType,
      metadata: response.Metadata,
      contentLength: response.ContentLength,
    };
  }

  /**
   * Get artifact metadata without downloading
   * @param {string} key - Storage key
   * @returns {Promise<object>} Head result
   */
  async getMetadata(key) {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);
    return {
      contentLength: response.ContentLength,
      contentType: response.ContentType,
      lastModified: response.LastModified,
      metadata: response.Metadata,
      etag: response.ETag,
    };
  }

  /**
   * Delete artifact by key
   * @param {string} key - Storage key
   * @returns {Promise<void>}
   */
  async delete(key) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.client.send(command);
  }

  /**
   * List artifacts for a contract
   * @param {string} contractId - Contract ID
   * @param {string} network - Network identifier
   * @returns {Promise<Array>} List of artifacts
   */
  async listArtifacts(contractId, network) {
    const prefix = `artifacts/${network}/${contractId}/`;
    
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
    });

    const response = await this.client.send(command);
    return response.Contents?.map(item => ({
      key: item.Key,
      size: item.Size,
      lastModified: item.LastModified,
    })) || [];
  }

  /**
   * Verify artifact integrity by comparing hash
   * @param {string} key - Storage key
   * @param {string} expectedHash - Expected SHA-256 hash
   * @returns {Promise<boolean>} True if verified
   */
  async verifyIntegrity(key, expectedHash) {
    const { metadata } = await this.getMetadata(key);
    return metadata?.contentHash === expectedHash;
  }

  /**
   * Generate pre-signed URL for direct upload
   * @param {string} key - Storage key
   * @param {number} expiresIn - Expiration time in seconds
   * @returns {Promise<string>} Pre-signed URL
   */
  async getUploadUrl(key, expiresIn = 3600) {
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: getContentType(key),
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Generate pre-signed URL for download
   * @param {string} key - Storage key
   * @param {number} expiresIn - Expiration time in seconds
   * @returns {Promise<string>} Pre-signed URL
   */
  async getDownloadUrl(key, expiresIn = 3600) {
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }
}

// Singleton instance
let storageServiceInstance = null;

/**
 * Get or create StorageService singleton
 * @returns {StorageService}
 */
export function getStorageService() {
  if (!storageServiceInstance) {
    storageServiceInstance = new StorageService();
  }
  return storageServiceInstance;
}

export default StorageService;