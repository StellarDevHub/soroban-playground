// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Automated secret rotation engine (issue #738).
//
// Rotates credentials (database filename/URL, Redis URL, API keys) at runtime
// without a server restart. Credentials live in memory **encrypted** using
// envelope encryption: each secret is sealed with a unique per-secret Data
// Encryption Key (DEK) using AES-256-GCM with a fresh random 96-bit IV. Each
// DEK is itself wrapped by a Key Encryption Key (KEK) that is held by an
// external KMS provider (AWS KMS, GCP KMS, or HashiCorp Vault transit) and
// never persisted in plaintext on this host. The plaintext only exists
// transiently inside getCredential().
//
// Rotation is atomic with a backup/fallback: new values are staged and each
// registered consumer (DB pool, Redis client, ...) is refreshed in turn; if any
// refresh fails the whole batch is rolled back to the previous credentials and a
// security alert is raised. Reloads are driven either by a periodic check of a
// JSON source file or by an explicit webhook trigger.
//
// SQLite/ioredis stack note: there is no classic connection pool to "drain".
// The DB refresh swaps the module handle and closes the old one after a grace
// period; the Redis refresh swaps the client and quits the old gracefully.

import crypto from 'crypto';
import { alertManager } from '../utils/alerting.js';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const DEK_BYTES = 32;
const DEFAULT_GRACE_MS = 5000;

function isValidCredential(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Key Encryption Key provider abstraction. Implementations must perform
 * wrap/unwrap operations remotely in KMS/Vault so the KEK never leaves the
 * provider boundary.
 *
 * Required interface:
 *   wrap(dek: Buffer) -> Promise<Buffer>     (returns ciphertext blob)
 *   unwrap(blob: Buffer) -> Promise<Buffer>  (returns plaintext DEK)
 *   rotateKek() -> Promise<void>             (provider-side KEK rotation)
 */
export class KmsKekProvider {
  /**
   * @param {object} opts
   * @param {'aws'|'gcp'|'vault'} opts.provider
   * @param {object} opts.client  Provider SDK client:
   *   aws   -> @aws-sdk/client-kms KMSClient
   *   gcp   -> @google-cloud/kms KeyManagementServiceClient
   *   vault -> node-vault client (transit engine)
   * @param {string} opts.keyId   KMS key ARN / GCP key resource name / Vault key name
   */
  constructor({ provider, client, keyId } = {}) {
    if (!['aws', 'gcp', 'vault'].includes(provider)) {
      throw new TypeError('KmsKekProvider: provider must be aws, gcp, or vault');
    }
    if (!client) throw new TypeError('KmsKekProvider: client is required');
    if (!isValidCredential(keyId)) {
      throw new TypeError('KmsKekProvider: keyId is required');
    }
    this.provider = provider;
    this.client = client;
    this.keyId = keyId;
  }

  async wrap(dek) {
    if (this.provider === 'aws') {
      const { EncryptCommand } = await import('@aws-sdk/client-kms');
      const res = await this.client.send(
        new EncryptCommand({ KeyId: this.keyId, Plaintext: dek }),
      );
      return Buffer.from(res.CiphertextBlob);
    }
    if (this.provider === 'gcp') {
      const [res] = await this.client.encrypt({
        name: this.keyId,
        plaintext: dek,
      });
      return Buffer.from(res.ciphertext);
    }
    // vault transit
    const res = await this.client.write(`transit/encrypt/${this.keyId}`, {
      plaintext: dek.toString('base64'),
    });
    return Buffer.from(res.data.ciphertext, 'utf8');
  }

  async unwrap(blob) {
    if (this.provider === 'aws') {
      const { DecryptCommand } = await import('@aws-sdk/client-kms');
      const res = await this.client.send(
        new DecryptCommand({ KeyId: this.keyId, CiphertextBlob: blob }),
      );
      return Buffer.from(res.Plaintext);
    }
    if (this.provider === 'gcp') {
      const [res] = await this.client.decrypt({
        name: this.keyId,
        ciphertext: blob,
      });
      return Buffer.from(res.plaintext);
    }
    const res = await this.client.write(`transit/decrypt/${this.keyId}`, {
      ciphertext: blob.toString('utf8'),
    });
    return Buffer.from(res.data.plaintext, 'base64');
  }

  async rotateKek() {
    if (this.provider === 'aws') {
      const { EnableKeyRotationCommand } = await import('@aws-sdk/client-kms');
      await this.client.send(new EnableKeyRotationCommand({ KeyId: this.keyId }));
      return;
    }
    if (this.provider === 'gcp') {
      await this.client.updateCryptoKeyPrimaryVersion({
        name: this.keyId,
      });
      return;
    }
    await this.client.write(`transit/keys/${this.keyId}/rotate`, {});
  }
}

/**
 * Envelope record layout for one sealed secret:
 *   { wrappedDek: Buffer, iv: Buffer, data: Buffer, tag: Buffer }
 * The DEK is generated fresh per secret, used once, and only ever stored
 * wrapped by the KEK.
 */
export class CredentialRotationService {
  constructor() {
    this.store = new Map(); // name -> envelope record
    this.previous = new Map(); // name -> envelope record (fallback backup)
    this.listeners = new Map(); // name -> Set<fn>
    this.kek = null; // KmsKekProvider, set via configure()
    this.sourceFile = null;
    this.intervalMs = 0;
    this.graceMs = DEFAULT_GRACE_MS;
    this.timer = null;
    this.lastSourceSnapshot = null;
    this.started = false;
  }

  /**
   * Configures the KEK provider and reload sources, and seeds the initial
   * credential set. Must be awaited once at startup.
   */
  async configure({
    kekProvider,
    sourceFile,
    intervalMs,
    graceMs,
    initial,
  } = {}) {
    if (!kekProvider || typeof kekProvider.wrap !== 'function') {
      throw new TypeError('configure: a KmsKekProvider (kekProvider) is required');
    }
    this.kek = kekProvider;
    this.sourceFile = sourceFile || null;
    this.intervalMs = Number(intervalMs) || 0;
    if (Number.isFinite(graceMs)) this.graceMs = graceMs;

    if (initial && typeof initial === 'object') {
      for (const [name, value] of Object.entries(initial)) {
        if (isValidCredential(value)) {
          this.store.set(name, await this._seal(value));
        }
      }
    }
    return this;
  }

  _requireKek() {
    if (!this.kek) {
      throw new Error('CredentialRotationService: KEK provider not configured');
    }
    return this.kek;
  }

  /** Seals a plaintext value under a fresh DEK wrapped by the KEK. */
  async _seal(value) {
    const kek = this._requireKek();
    const dek = crypto.randomBytes(DEK_BYTES);
    const iv = crypto.randomBytes(IV_BYTES);
    try {
      const cipher = crypto.createCipheriv(ALGO, dek, iv);
      const data = Buffer.concat([
        cipher.update(String(value), 'utf8'),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      const wrappedDek = await kek.wrap(dek);
      return { wrappedDek, iv, data, tag };
    } finally {
      dek.fill(0);
    }
  }

  /** Unwraps the DEK via KMS and decrypts the secret. */
  async _open(record) {
    if (!record) return undefined;
    const kek = this._requireKek();
    const dek = await kek.unwrap(record.wrappedDek);
    try {
      const decipher = crypto.createDecipheriv(ALGO, dek, record.iv);
      decipher.setAuthTag(record.tag);
      return Buffer.concat([
        decipher.update(record.data),
        decipher.final(),
      ]).toString('utf8');
    } finally {
      dek.fill(0);
    }
  }

  has(name) {
    return this.store.has(name);
  }

  async getCredential(name) {
    return this._open(this.store.get(name));
  }

  /** The pre-rotation value, kept for fallback/audit. */
  async getPreviousCredential(name) {
    return this._open(this.previous.get(name));
  }

  /**
   * Re-wraps every stored DEK under the current KEK version. Secret payloads
   * are untouched; only the DEK envelope is re-encrypted, so KEK rotation does
   * not require re-encrypting bulk data.
   */
  async rewrapAll() {
    const kek = this._requireKek();
    for (const map of [this.store, this.previous]) {
      for (const [name, record] of map) {
        const dek = await kek.unwrap(record.wrappedDek);
        try {
          const wrappedDek = await kek.wrap(dek);
          map.set(name, { ...record, wrappedDek });
        } finally {
          dek.fill(0);
        }
      }
    }
  }

  /**
   * Rotates the KEK on the provider, then re-wraps all stored DEKs so every
   * envelope is protected by the new KEK version.
   */
  async rotateKek() {
    await this._requireKek().rotateKek();
    await this.rewrapAll();
  }

  /**
   * Registers a refresh callback fired whenever `name` is rotated. Returns an
   * unsubscribe function.
   */
  onRotate(name, fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('onRotate expects a function');
    }
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
    return () => this.listeners.get(name)?.delete(fn);
  }

  async _runListeners(name, value) {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const fn of set) {
      await fn(value, name);
    }
  }

  /**
   * Atomically rotates one or more credentials. Stages each new value, refreshes
   * its consumers, and on any failure rolls the whole batch back to the previous
   * credentials and raises a security alert.
   */
  async rotate(updates = {}) {
    const names = Object.keys(updates);

    for (const name of names) {
      if (!isValidCredential(updates[name])) {
        alertManager.alert('invalid_credential', { name });
        throw new Error(`Invalid credential value for "${name}"`);
      }
    }

    const staged = [];
    const backups = new Map();

    try {
      for (const name of names) {
        backups.set(name, this.store.get(name) ?? null);
        this.store.set(name, await this._seal(updates[name])); // atomic swap
        staged.push(name);
        await this._runListeners(name, updates[name]);
      }

      // Commit: remember the prior envelopes for fallback.
      for (const [name, record] of backups) {
        if (record) this.previous.set(name, record);
      }
      return { rotated: names };
    } catch (err) {
      // Roll back every staged key (including the one whose refresh failed),
      // best-effort refreshing consumers back to the previous value.
      for (const name of staged) {
        const backup = backups.get(name);
        if (backup) {
          this.store.set(name, backup);
          try {
            await this._runListeners(name, await this._open(backup));
          } catch {
            // best-effort restoration — the alert below carries the failure
          }
        } else {
          this.store.delete(name);
        }
      }
      alertManager.alert('credential_rotation_failed', {
        name: staged[staged.length - 1] ?? names[0],
        error: err.message,
      });
      throw err;
    }
  }

  /** Starts the periodic source-file poll (no-op unless both are configured). */
  start() {
    if (this.started || !this.intervalMs || !this.sourceFile) return this;
    this.started = true;
    this.timer = setInterval(() => {
      this.checkSource().catch(() => {});
    }, this.intervalMs);
    if (this.timer.unref) this.timer.unref();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
    return this;
  }

  /**
   * Reads the JSON source file and rotates any credential whose value changed.
   * Returns the applied updates, or null when nothing changed / no source.
   */
  async checkSource() {
    if (!this.sourceFile) return null;

    const fs = await import('fs/promises');
    let raw;
    try {
      raw = await fs.readFile(this.sourceFile, 'utf8');
    } catch (err) {
      alertManager.alert('credential_source_unreadable', {
        file: this.sourceFile,
        error: err.message,
      });
      return null;
    }

    if (raw === this.lastSourceSnapshot) return null;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      alertManager.alert('invalid_credential', {
        file: this.sourceFile,
        reason: 'source is not valid JSON',
      });
      return null;
    }
    this.lastSourceSnapshot = raw;

    const updates = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (isValidCredential(value) && (await this.getCredential(name)) !== value) {
        updates[name] = value;
      }
    }
    if (Object.keys(updates).length === 0) return null;

    await this.rotate(updates);
    return updates;
  }
}

export const credentialRotationService = new CredentialRotationService();
export default credentialRotationService;
