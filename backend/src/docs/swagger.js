// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { versions } from '../config/versions.js';
import {
  collectZodOperations,
  mergeZodOperations,
  normalizeSchemaToOpenApi31,
} from './zodOpenApi.js';

const versionedRoutePrefixes = [
  '/compile',
  '/deploy',
  '/invoke',
  '/identity',
  '/lottery',
];

const options = {
  definition: {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
    info: {
      title: 'Soroban Playground API',
      version: '1.0.0',
      description:
        'REST API for compiling, deploying, and invoking Soroban smart contracts on Stellar.',
    },
    servers: [
      { url: '/api', description: 'Default server' },
      ...Object.keys(versions).map((version) => ({
        url: `/api/${version}`,
        description: `${version.toUpperCase()} API server`,
      })),
    ],
    tags: [
      { name: 'Versioning', description: 'API version discovery and routing' },
      {
        name: 'Contract Compiler',
        description: 'Synchronous and Asynchronous WASM Compilation',
      },
      {
        name: 'Deploy & Invoke',
        description: 'Contract deployment and invocation operations',
      },
      {
        name: 'Contract Verification',
        description:
          'Source-to-WASM hash verification for deployed Soroban contracts',
      },
      {
        name: 'RPC Network Manager',
        description: 'Circuit breaker & RPC health status',
      },
      ...Object.keys(versions).map((version) => ({
        name: `API ${version}`,
        description: `${version.toUpperCase()} endpoints`,
      })),
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      parameters: {
        VerificationId: {
          in: 'path',
          name: 'id',
          required: true,
          schema: { type: 'string' },
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        CompileRequest: {
          type: 'object',
          required: ['source'],
          properties: {
            source: {
              type: 'string',
              description: 'Rust source code for Soroban smart contract',
            },
            contractName: {
              type: 'string',
              description: 'Optional name of the contract',
            },
          },
        },
        AsyncCompileResponse: {
          type: 'object',
          properties: {
            jobId: {
              type: 'string',
              description: 'Unique background compilation job ID',
            },
            status: { type: 'string', example: 'queued' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        VerificationRequest: {
          type: 'object',
          required: ['contractId', 'sourceCode'],
          properties: {
            contractId: {
              type: 'string',
              description: 'Stellar Soroban contract ID',
            },
            network: { type: 'string', default: 'testnet' },
            sourceCode: {
              type: 'string',
              description: 'Rust source for src/lib.rs',
            },
            dependencies: {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
            metadata: { type: 'object' },
            wasmBase64: {
              type: 'string',
              description: 'Optional compiled WASM artifact',
            },
            wasmPath: {
              type: 'string',
              description:
                'Optional artifact path inside VERIFICATION_ARTIFACT_ROOT',
            },
          },
        },
        VerificationRecord: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            contractId: { type: 'string' },
            network: { type: 'string' },
            sourceHash: { type: 'string' },
            wasmHash: { type: ['string', 'null'] },
            onChainWasmHash: { type: ['string', 'null'] },
            status: {
              type: 'string',
              enum: ['pending', 'verified', 'mismatch', 'failed'],
            },
            verified: { type: 'boolean' },
          },
        },
        CompileJobStatus: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
            status: {
              type: 'string',
              enum: ['queued', 'processing', 'completed', 'failed'],
            },
            result: { type: 'object' },
            error: { type: 'string' },
          },
        },
        RpcStatusResponse: {
          type: 'object',
          properties: {
            activeEndpoint: { type: 'string' },
            circuitBreakerState: {
              type: 'string',
              enum: ['CLOSED', 'OPEN', 'HALF_OPEN'],
            },
            endpoints: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  url: { type: 'string' },
                  isHealthy: { type: 'boolean' },
                  failCount: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
  },
  apis: ['./src/routes/**/*.js', './src/docs/*.doc.js'],
};

export function cloneOperation(operation, version) {
  const cloned = JSON.parse(JSON.stringify(operation));
  const tags = new Set([`API ${version}`, ...(cloned.tags || [])]);
  cloned.tags = Array.from(tags);
  return cloned;
}

export function clonePathItem(pathItem, version) {
  const cloned = JSON.parse(JSON.stringify(pathItem));
  for (const [method, operation] of Object.entries(cloned)) {
    if (operation && typeof operation === 'object') {
      cloned[method] = cloneOperation(operation, version);
    }
  }
  return cloned;
}

export function isVersionablePath(pathName) {
  if (!pathName.startsWith('/api/')) return false;
  const pathWithoutApiPrefix = pathName.slice('/api'.length);
  return versionedRoutePrefixes.some(
    (prefix) =>
      pathWithoutApiPrefix === prefix ||
      pathWithoutApiPrefix.startsWith(`${prefix}/`)
  );
}

export function withVersionedDocumentation(spec) {
  const documentedSpec = {
    ...spec,
    paths: { ...(spec.paths || {}) },
  };

  for (const [pathName, pathItem] of Object.entries(spec.paths || {})) {
    const versionMatch = pathName.match(/^\/api\/(v\d+)(?:\/|$)/);
    if (versionMatch) {
      documentedSpec.paths[pathName] = clonePathItem(pathItem, versionMatch[1]);
      continue;
    }

    if (!isVersionablePath(pathName)) continue;

    const legacyVersion = 'v1';
    documentedSpec.paths[pathName] = clonePathItem(pathItem, legacyVersion);

    for (const version of Object.keys(versions)) {
      const versionedPath = pathName.replace('/api', `/api/${version}`);
      if (!documentedSpec.paths[versionedPath]) {
        documentedSpec.paths[versionedPath] = clonePathItem(pathItem, version);
      }
    }
  }

  return documentedSpec;
}

const HTTP_METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'patch',
  'head',
  'options',
  'trace',
]);

function ensureOperationResponses(spec) {
  const paths = {};
  for (const [pathKey, pathItem] of Object.entries(spec.paths || {})) {
    const normalizedItem = { ...pathItem };
    for (const [method, operation] of Object.entries(normalizedItem)) {
      if (
        HTTP_METHODS.has(method) &&
        operation &&
        typeof operation === 'object' &&
        (!operation.responses || Object.keys(operation.responses).length === 0)
      ) {
        normalizedItem[method] = {
          ...operation,
          responses: { 200: { description: 'Successful response' } },
        };
      }
    }
    paths[pathKey] = normalizedItem;
  }
  return { ...spec, paths };
}

const baseSpec = ensureOperationResponses(
  normalizeSchemaToOpenApi31(swaggerJsdoc(options))
);

// Static JSDoc-only spec (no live routes). Kept for callers that need the
// spec without an app instance.
export const swaggerSpec = withVersionedDocumentation(baseSpec);

/**
 * Build the spec for a running app: JSDoc annotations merged with the Zod
 * schemas attached to every mounted `validateRequest` route. Generated from
 * the live router tree, so it always matches what the server validates.
 */
export function buildLiveSpec(app) {
  return normalizeSchemaToOpenApi31(
    withVersionedDocumentation(
      mergeZodOperations(baseSpec, collectZodOperations(app))
    )
  );
}

const uiOptions = (specUrl) => ({
  customSiteTitle: 'Soroban Playground API Docs',
  swaggerOptions: {
    url: specUrl,
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
  },
});

export function setupSwagger(app) {
  const sendSpec = (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(buildLiveSpec(app));
  };

  // `/docs` is the canonical location; `/api-docs` is kept for existing links.
  for (const [base, specPath] of [
    ['/docs', '/docs/openapi.json'],
    ['/api-docs', '/api-docs/spec.json'],
  ]) {
    app.get(specPath, sendSpec);
    app.use(
      base,
      swaggerUi.serveFiles(null, uiOptions(specPath)),
      swaggerUi.setup(null, uiOptions(specPath))
    );
  }
}
