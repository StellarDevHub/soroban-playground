/**
 * Sensitive Data & Credentials Redaction Engine
 * Complies with OWASP CWE-209 (Information Exposure Through Error Messages).
 * Recursively cleanses objects, error messages, and URI connection strings.
 */

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /connection_?string/i,
  /private_?key/i,
  /api_?key/i,
  /auth/i,
  /credential/i,
  /database_?url/i,
  /db_?url/i,
  /cookie/i,
  /session/i,
  /jwt/i,
  /seed/i,
  /mnemonic/i,
];

// Matches database and cache connection strings (e.g., postgres://user:pass@host:port/db)
const URI_CREDENTIAL_REGEX =
  /((?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp|mssql):\/\/[^:\s]+:)([^@\s]+)(@)/gi;

// Matches Stellar secret seeds (starts with 'S', 56 uppercase alphanumeric chars)
const STELLAR_SECRET_SEED_REGEX = /\b(S[A-Z0-9]{55})\b/g;

// Matches 64-char hex private keys (optionally prefixed with 0x)
const HEX_PRIVATE_KEY_REGEX = /\b(?:0x)?[a-fA-F0-9]{64}\b/g;

// Matches Bearer authentication tokens
const BEARER_TOKEN_REGEX = /(Bearer\s+)([A-Za-z0-9._~+/-]+=*)/gi;

/**
 * Redacts sensitive patterns inside a string.
 * @param {string} str
 * @returns {string}
 */
export function redactString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(URI_CREDENTIAL_REGEX, '$1[REDACTED]$3')
    .replace(STELLAR_SECRET_SEED_REGEX, 'S[REDACTED]')
    .replace(HEX_PRIVATE_KEY_REGEX, '[REDACTED_KEY]')
    .replace(BEARER_TOKEN_REGEX, '$1[REDACTED]');
}

/**
 * Checks if a key name corresponds to sensitive information.
 * @param {string} key
 * @returns {boolean}
 */
export function isSensitiveKey(key) {
  if (typeof key !== 'string') return false;
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Recursively scrubs sensitive values and connection strings from arbitrary data.
 * Protects against circular structures using a WeakSet.
 * @param {*} data
 * @param {WeakSet} seen
 * @returns {*}
 */
export function redactSensitiveData(data, seen = new WeakSet()) {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    return redactString(data);
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (seen.has(data)) {
    return '[CIRCULAR]';
  }
  seen.add(data);

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item, seen));
  }

  if (data instanceof Error) {
    return {
      name: data.name,
      message: redactString(data.message),
      code: data.code,
      statusCode: data.statusCode,
      details: redactSensitiveData(data.details, seen),
      ...(process.env.NODE_ENV !== 'production' && data.stack
        ? { stack: redactString(data.stack) }
        : {}),
    };
  }

  const sanitized = {};
  for (const [key, val] of Object.entries(data)) {
    if (isSensitiveKey(key)) {
      if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
        sanitized[key] = redactSensitiveData(val, seen);
      } else {
        sanitized[key] = '[REDACTED]';
      }
    } else {
      sanitized[key] = redactSensitiveData(val, seen);
    }
  }

  return sanitized;
}
