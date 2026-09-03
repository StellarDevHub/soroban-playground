// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Production: OpenAPI 3.1 Specification Auto-Generator & Swagger UI Interactive Explorer
// Generates dynamic OpenAPI documentation from Zod validation schemas

import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { versions } from '../config/versions.js';

/**
 * Map Zod types to OpenAPI 3.1 schema types
 */
const ZOD_TYPE_MAP = {
  string: { type: 'string' },
  number: { type: 'number' },
  bigint: { type: 'integer', format: 'int64' },
  boolean: { type: 'boolean' },
  date: { type: 'string', format: 'date-time' },
  undefined: { type: 'null' },
  z: { type: 'object' },
};

/**
 * Converts Zod schema to OpenAPI 3.1 schema definition
 * @param {import('zod').ZodType} zodSchema - Zod schema to convert
 * @returns {object} OpenAPI schema object
 */
export function zodToOpenAPI(zodSchema) {
  if (!zodSchema) return { type: 'object' };

  const schema = zodSchema._def;
  const typeName = schema.typeName;

  switch (typeName) {
    case 'ZodString':
      const stringSchema = { type: 'string' };
      if (schema.minLength !== undefined) stringSchema.minLength = schema.minLength;
      if (schema.maxLength !== undefined) stringSchema.maxLength = schema.maxLength;
      if (schema.regex) stringSchema.pattern = schema.regex.source;
      if (schema.format) stringSchema.format = schema.format;
      return stringSchema;

    case 'ZodNumber':
      const numberSchema = { type: 'number' };
      if (schema.minimum !== undefined) numberSchema.minimum = schema.minimum;
      if (schema.maximum !== undefined) numberSchema.maximum = schema.maximum;
      if (schema.isInteger) numberSchema.type = 'integer';
      return numberSchema;

    case 'ZodBigInt':
      return { type: 'integer', format: 'int64' };

    case 'ZodBoolean':
      return { type: 'boolean' };

    case 'ZodDate':
      return { type: 'string', format: 'date-time' };

    case 'ZodOptional':
      return {
        ...zodToOpenAPI(schema.innerType),
        nullable: true,
      };

    case 'ZodNullable':
      return {
        ...zodToOpenAPI(schema.innerType),
        nullable: true,
      };

    case 'ZodArray':
      return {
        type: 'array',
        items: zodToOpenAPI(schema.type),
      };

    case 'ZodObject':
      const properties = {};
      const required = [];
      for (const [key, propSchema] of Object.entries(schema.shape())) {
        const openapiProp = zodToOpenAPI(propSchema);
        if (!propSchema.isOptional()) {
          required.push(key);
        }
        properties[key] = openapiProp;
      }
      return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
      };

    case 'ZodEnum':
      return {
        type: 'string',
        enum: schema.enum,
      };

    case 'ZodLiteral':
      return {
        type: typeof schema.value,
        enum: [schema.value],
      };

    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      return {
        oneOf: schema.options.map(opt => zodToOpenAPI(opt)),
      };

    case 'ZodRecord':
      return {
        type: 'object',
        additionalProperties: zodToOpenAPI(schema.valueType),
      };

    case 'ZodMap':
      return {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: {
            key: zodToOpenAPI(schema.keyType),
            value: zodToOpenAPI(schema.valueType),
          },
        },
      };

    case 'ZodTuple':
      return {
        type: 'array',
        items: schema.items.map(item => zodToOpenAPI(item)),
        minItems: schema.items.length,
        maxItems: schema.items.length,
      };

    case 'ZodEffects':
      return zodToOpenAPI(schema.schema);

    case 'ZodBranded':
      return zodToOpenAPI(schema.type);

    case 'ZodPipeline':
      return zodToOpenAPI(schema.second);

    default:
      return { type: 'object' };
  }
}

/**
 * Extracts request/response schemas from route handlers
 * @param {object} app - Express application
 * @returns {object} Collected schemas
 */
export function extractSchemasFromRoutes(app) {
  const schemas = {};
  const routes = [];

  app._router.stack.forEach(middleware => {
    if (middleware.route) {
      routes.push(middleware.route);
    } else if (middleware.name === 'router') {
      middleware.handle.stack.forEach(handler => {
        if (handler.route) {
          routes.push(handler.route);
        }
      });
    }
  });

  for (const route of routes) {
    const path = route.path;
    const methods = Object.keys(route.methods);

    for (const method of methods) {
      const handler = route.stack[0].handle;
      if (handler.schema) {
        const operationId = `${method}_${path.replace(/\//g, '_')}`;
        schemas[operationId] = handler.schema;
      }
    }
  }

  return schemas;
}

/**
 * Generate OpenAPI spec from Zod schemas and route definitions
 * @param {Array} routes - Array of route definitions with Zod schemas
 * @param {object} options - Additional OpenAPI options
 * @returns {object} OpenAPI 3.1 specification
 */
export function generateOpenAPISpec(routes = [], options = {}) {
  const paths = {};

  for (const route of routes) {
    const { method, path, summary, description, parameters, requestSchema, responseSchema, tags = [] } = route;
    
    if (!paths[path]) paths[path] = {};
    
    paths[path][method.toLowerCase()] = {
      summary,
      description,
      operationId: `${method.toLowerCase()}_${path.replace(/\//g, '_').replace(/[^a-zA-Z0-9]/g, '_')}`,
      tags: ['API v1', ...tags],
      parameters: parameters?.map(param => ({
        name: param.name,
        in: param.in || 'query',
        required: param.required || false,
        schema: zodToOpenAPI(param.schema),
        description: param.description,
      })) || [],
      requestBody: requestSchema ? {
        required: true,
        content: {
          'application/json': {
            schema: zodToOpenAPI(requestSchema),
          },
        },
      } : undefined,
      responses: responseSchema ? {
        '200': {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: zodToOpenAPI(responseSchema),
            },
          },
        },
      } : {
        '200': { description: 'Successful response' },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: options.title || 'Soroban Playground API',
      version: options.version || '1.0.0',
      description: options.description || 'REST API for compiling, deploying, and invoking Soroban smart contracts on Stellar.',
    },
    servers: [
      { url: '/api', description: 'Default server' },
      ...Object.keys(versions).map(version => ({
        url: `/api/${version}`,
        description: `${version.toUpperCase()} API server`,
      })),
    ],
    tags: [
      { name: 'Versioning', description: 'API version discovery and routing' },
      { name: 'Contract Compiler', description: 'Synchronous and Asynchronous WASM Compilation' },
      { name: 'Deploy & Invoke', description: 'Contract deployment and invocation operations' },
      { name: 'Contract Verification', description: 'Source-to-WASM hash verification for deployed Soroban contracts' },
      { name: 'RPC Network Manager', description: 'Circuit breaker & RPC health status' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {},
    },
    paths,
  };
}

// Versioned route prefixes
const versionedRoutePrefixes = [
  '/compile',
  '/deploy',
  '/invoke',
  '/identity',
  '/lottery',
];

/**
 * Clone operation with version tag
 */
function cloneOperation(operation, version) {
  const cloned = JSON.parse(JSON.stringify(operation));
  const tags = new Set([`API ${version}`, ...(cloned.tags || [])]);
  cloned.tags = Array.from(tags);
  return cloned;
}

/**
 * Clone path item with version tags
 */
function clonePathItem(pathItem, version) {
  const cloned = JSON.parse(JSON.stringify(pathItem));
  for (const [method, operation] of Object.entries(cloned)) {
    if (operation && typeof operation === 'object') {
      cloned[method] = cloneOperation(operation, version);
    }
  }
  return cloned;
}

/**
 * Check if path is versionable
 */
function isVersionablePath(pathName) {
  if (!pathName.startsWith('/api/')) return false;
  const pathWithoutApiPrefix = pathName.slice('/api'.length);
  return versionedRoutePrefixes.some(
    prefix =>
      pathWithoutApiPrefix === prefix ||
      pathWithoutApiPrefix.startsWith(`${prefix}/`)
  );
}

/**
 * Add versioned documentation to spec
 */
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

/**
 * Create OpenAPI spec from swagger-jsdoc options
 * @param {object} options - swagger-jsdoc options
 * @returns {object} Processed OpenAPI spec
 */
export function createOpenAPISpec(options) {
  const spec = swaggerJsdoc(options);
  return withVersionedDocumentation(spec);
}

/**
 * Setup Swagger UI middleware
 * @param {object} app - Express application
 * @param {object} spec - OpenAPI spec
 */
export function setupSwaggerUI(app, spec) {
  app.get('/api-docs/spec.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(spec);
  });

  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: 'Soroban Playground API Docs',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
      },
    })
  );
}

export { swaggerJsdoc, swaggerUi };