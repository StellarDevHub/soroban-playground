// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Envelope-encrypted key management for custodial testnet faucets.
 *
 * A per-secret data key encrypts the Stellar secret seed (AES-256-GCM). The
 * data key is then wrapped by AWS KMS, HashiCorp Vault Transit, or a local
 * master key (development / tests). Rotation issues a new data key and keeps
 * the previous ciphertext for a configurable grace window.
 */

import crypto from 'crypto';

const AES_ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const DEK_LENGTH = 32;
const DEFAULT_GRACE_MS = 15 * 60 * 1000;
const STELLAR_SECRET_PATTERN = /^S[A-Z2-7]{55}$/;

function nowIso() {
  return new Date().toISOString();
}

function assertAlias(alias) {
  if (typeof alias !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(alias)) {
    throw new Error('Invalid faucet key alias');
  }
  return alias;
}

function assertSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 8) {
    throw new Error('Invalid faucet secret');
  }
  return secret;
}

function encryptWithDek(dek, plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(AES_ALGO, dek, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptWithDek(dek, envelope) {
  const decipher = crypto.createDecipheriv(
    AES_ALGO,
    dek,
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export class LocalMasterKeyProvider {
  constructor(masterKey = process.env.KMS_LOCAL_MASTER_KEY) {
    const material = masterKey || crypto.randomBytes(32).toString('hex');
    this.key = crypto.createHash('sha256').update(String(material)).digest();
    this.name = 'local';
  }

  async wrap(dek) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(AES_ALGO, this.key, iv);
    const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), wrapped]).toString('base64');
  }

  async unwrap(wrappedB64) {
    const buf = Buffer.from(wrappedB64, 'base64');
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
    const wrapped = buf.subarray(IV_LENGTH + 16);
    const decipher = crypto.createDecipheriv(AES_ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(wrapped), decipher.final()]);
  }
}

export class AwsKmsProvider {
  constructor({
    keyId = process.env.AWS_KMS_KEY_ID,
    region = process.env.AWS_REGION || 'us-east-1',
    client,
  } = {}) {
    this.keyId = keyId;
    this.region = region;
    this.client = client || null;
    this.name = 'aws-kms';
  }

  async #client() {
    if (this.client) return this.client;
    const { KMSClient, EncryptCommand, DecryptCommand } = await import(
      '@aws-sdk/client-kms'
    );
    this.client = new KMSClient({ region: this.region });
    this._EncryptCommand = EncryptCommand;
    this._DecryptCommand = DecryptCommand;
    return this.client;
  }

  async wrap(dek) {
    if (!this.keyId) {
      throw new Error('AWS_KMS_KEY_ID is required for the aws-kms provider');
    }
    const client = await this.#client();
    const EncryptCommand =
      this._EncryptCommand ||
      (await import('@aws-sdk/client-kms')).EncryptCommand;
    const result = await client.send(
      new EncryptCommand({ KeyId: this.keyId, Plaintext: dek })
    );
    return Buffer.from(result.CiphertextBlob).toString('base64');
  }

  async unwrap(wrappedB64) {
    const client = await this.#client();
    const DecryptCommand =
      this._DecryptCommand ||
      (await import('@aws-sdk/client-kms')).DecryptCommand;
    const result = await client.send(
      new DecryptCommand({
        CiphertextBlob: Buffer.from(wrappedB64, 'base64'),
        KeyId: this.keyId,
      })
    );
    return Buffer.from(result.Plaintext);
  }
}

export class VaultTransitProvider {
  constructor({
    address = process.env.VAULT_ADDR,
    token = process.env.VAULT_TOKEN,
    mount = process.env.VAULT_TRANSIT_MOUNT || 'transit',
    keyName = process.env.VAULT_TRANSIT_KEY || 'faucet',
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.address = address;
    this.token = token;
    this.mount = mount.replace(/^\//, '').replace(/\/$/, '');
    this.keyName = keyName;
    this.fetchImpl = fetchImpl;
    this.name = 'vault';
  }

  #headers() {
    if (!this.address || !this.token) {
      throw new Error('VAULT_ADDR and VAULT_TOKEN are required');
    }
    return {
      'X-Vault-Token': this.token,
      'Content-Type': 'application/json',
    };
  }

  async wrap(dek) {
    const url = `${this.address}/v1/${this.mount}/encrypt/${this.keyName}`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify({ plaintext: dek.toString('base64') }),
    });
    if (!response.ok) {
      throw new Error(`Vault encrypt failed (${response.status})`);
    }
    const body = await response.json();
    const ciphertext = body?.data?.ciphertext;
    if (!ciphertext) {
      throw new Error('Vault encrypt response missing ciphertext');
    }
    return ciphertext;
  }

  async unwrap(ciphertext) {
    const url = `${this.address}/v1/${this.mount}/decrypt/${this.keyName}`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify({ ciphertext }),
    });
    if (!response.ok) {
      throw new Error(`Vault decrypt failed (${response.status})`);
    }
    const body = await response.json();
    const plaintext = body?.data?.plaintext;
    if (!plaintext) {
      throw new Error('Vault decrypt response missing plaintext');
    }
    return Buffer.from(plaintext, 'base64');
  }
}

export function createKeyProvider(kind = process.env.KMS_PROVIDER || 'local') {
  switch (String(kind).toLowerCase()) {
    case 'aws':
    case 'aws-kms':
    case 'kms':
      return new AwsKmsProvider();
    case 'vault':
    case 'hashicorp':
      return new VaultTransitProvider();
    default:
      return new LocalMasterKeyProvider();
  }
}

export class KmsService {
  constructor({
    provider,
    providerKind,
    graceMs = Number(process.env.KMS_ROTATION_GRACE_MS) || DEFAULT_GRACE_MS,
    rotationMs = Number(process.env.KMS_ROTATION_INTERVAL_MS) || 0,
    requireStellarSecret = process.env.KMS_REQUIRE_STELLAR_SECRET === 'true',
  } = {}) {
    this.provider = provider || createKeyProvider(providerKind);
    this.graceMs = graceMs;
    this.rotationMs = rotationMs;
    this.requireStellarSecret = requireStellarSecret;
    this.store = new Map();
    this.timer = null;
    this.audit = [];
  }

  #record(action, alias, extra = {}) {
    this.audit.push({
      action,
      alias,
      at: nowIso(),
      provider: this.provider?.name,
      ...extra,
    });
    if (this.audit.length > 200) this.audit.shift();
  }

  async #seal(secret) {
    const dek = crypto.randomBytes(DEK_LENGTH);
    const envelope = encryptWithDek(dek, secret);
    const wrappedDek = await this.provider.wrap(dek);
    dek.fill(0);
    return { ...envelope, wrappedDek, provider: this.provider.name };
  }

  async #open(record) {
    const dek = await this.provider.unwrap(record.wrappedDek);
    try {
      return decryptWithDek(dek, record);
    } finally {
      dek.fill(0);
    }
  }

  async storeFaucetKey({
    alias,
    secret,
    network = 'testnet',
    metadata = {},
  } = {}) {
    const name = assertAlias(alias);
    const value = assertSecret(secret);
    if (this.requireStellarSecret && !STELLAR_SECRET_PATTERN.test(value)) {
      throw new Error('Secret is not a Stellar secret seed');
    }
    const sealed = await this.#seal(value);
    const previous = this.store.get(name) || null;
    const entry = {
      alias: name,
      network,
      metadata: { ...metadata },
      version: (previous?.version || 0) + 1,
      createdAt: previous?.createdAt || nowIso(),
      rotatedAt: nowIso(),
      previous: previous
        ? { ...previous.current, expiresAt: Date.now() + this.graceMs }
        : null,
      current: sealed,
    };
    this.store.set(name, entry);
    this.#record('store', name, { network, version: entry.version });
    return this.describe(name);
  }

  async getFaucetKey(alias, { allowPrevious = true } = {}) {
    const name = assertAlias(alias);
    const entry = this.store.get(name);
    if (!entry) {
      throw new Error(`Unknown faucet key "${name}"`);
    }
    try {
      return await this.#open(entry.current);
    } catch (err) {
      if (allowPrevious && entry.previous) {
        this.#record('unwrap-fallback', name);
        return this.#open(entry.previous);
      }
      throw err;
    }
  }

  async rotateFaucetKey(alias, { secret } = {}) {
    const name = assertAlias(alias);
    const entry = this.store.get(name);
    if (!entry) {
      throw new Error(`Unknown faucet key "${name}"`);
    }
    const nextSecret = secret || (await this.getFaucetKey(name));
    return this.storeFaucetKey({
      alias: name,
      secret: nextSecret,
      network: entry.network,
      metadata: entry.metadata,
    });
  }

  async rotateDueKeys(now = Date.now()) {
    if (!this.rotationMs) return [];
    const rotated = [];
    for (const [alias, entry] of this.store.entries()) {
      const age = now - Date.parse(entry.rotatedAt);
      if (Number.isFinite(age) && age >= this.rotationMs) {
        await this.rotateFaucetKey(alias);
        rotated.push(alias);
      }
    }
    return rotated;
  }

  start() {
    if (this.timer || !this.rotationMs) return this;
    const timer = setInterval(() => {
      this.rotateDueKeys().catch((err) => {
        console.error('[KmsService] rotation failed:', err.message);
      });
    }, Math.min(this.rotationMs, 60_000));
    if (timer.unref) timer.unref();
    this.timer = timer;
    return this;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async destroy(alias) {
    const name = assertAlias(alias);
    const existed = this.store.delete(name);
    this.#record('destroy', name, { existed });
    return existed;
  }

  describe(alias) {
    const entry = this.store.get(alias);
    if (!entry) return null;
    return {
      alias: entry.alias,
      network: entry.network,
      version: entry.version,
      createdAt: entry.createdAt,
      rotatedAt: entry.rotatedAt,
      provider: entry.current.provider,
      hasPrevious: Boolean(entry.previous),
      metadata: entry.metadata,
    };
  }

  listAliases() {
    return [...this.store.keys()].map((alias) => this.describe(alias));
  }

  getStatus() {
    return {
      provider: this.provider?.name,
      keys: this.store.size,
      rotationMs: this.rotationMs,
      graceMs: this.graceMs,
      running: Boolean(this.timer),
    };
  }
}

const kmsService = new KmsService();
export default kmsService;
