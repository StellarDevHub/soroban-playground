// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Live OpenAPI 3.1.0 generation from the Zod schemas routes actually validate with.
//
// `validateRequest(schemas, docs)` (middleware/validation.js) tags the
// middleware it returns with `openapi` metadata. `collectZodOperations(app)`
// walks the mounted Express router tree, recovers each route's full path and
// turns the attached schemas into OpenAPI 3.1.0 operations, so the published
// spec can never drift from the validation that runs in production.

const HTTP_METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'patch',
  'head',
  'options',
]);

function withDescription(result, schema) {
  return schema?.description
    ? { ...result, description: schema.description }
    : result;
}

function stringSchema(def) {
  const out = { type: 'string' };
  for (const check of def.checks || []) {
    switch (check.kind) {
      case 'min':
        out.minLength = check.value;
        break;
      case 'max':
        out.maxLength = check.value;
        break;
      case 'length':
        out.minLength = check.value;
        out.maxLength = check.value;
        break;
      case 'regex':
        out.pattern = check.regex.source;
        break;
      case 'email':
      case 'uuid':
        out.format = check.kind;
        break;
      case 'url':
        out.format = 'uri';
        break;
      case 'datetime':
        out.format = 'date-time';
        break;
      case 'date':
        out.format = 'date';
        break;
      default:
        break;
    }
  }
  return out;
}

function numberSchema(def) {
  const out = { type: 'number' };
  for (const check of def.checks || []) {
    switch (check.kind) {
      case 'int':
        out.type = 'integer';
        break;
      case 'min':
        if (check.inclusive) {
          out.minimum = check.value;
        } else {
          out.exclusiveMinimum = check.value;
        }
        break;
      case 'max':
        if (check.inclusive) {
          out.maximum = check.value;
        } else {
          out.exclusiveMaximum = check.value;
        }
        break;
      case 'multipleOf':
        out.multipleOf = check.value;
        break;
      default:
        break;
    }
  }
  return out;
}

function objectSchema(schema) {
  const def = schema._def;
  const properties = {};
  const required = [];
  for (const [key, value] of Object.entries(schema.shape)) {
    properties[key] = zodToOpenApi(value);
    if (!value.isOptional()) required.push(key);
  }
  const out = { type: 'object', properties };
  if (required.length) out.required = required;
  if (def.unknownKeys === 'strict') out.additionalProperties = false;
  const catchall = def.catchall?._def?.typeName;
  if (catchall && catchall !== 'ZodNever') {
    out.additionalProperties = zodToOpenApi(def.catchall);
  }
  return out;
}

/**
 * Convert a Zod (v3) schema to an OpenAPI 3.1.0 (JSON Schema 2020-12) schema
 * object describing the accepted *input*.
 */
export function zodToOpenApi(schema) {
  if (!schema?._def) return {};
  const def = schema._def;

  switch (def.typeName) {
    case 'ZodString':
      return withDescription(stringSchema(def), schema);
    case 'ZodNumber':
      return withDescription(numberSchema(def), schema);
    case 'ZodBigInt':
      return withDescription({ type: 'integer', format: 'int64' }, schema);
    case 'ZodBoolean':
      return withDescription({ type: 'boolean' }, schema);
    case 'ZodDate':
      return withDescription({ type: 'string', format: 'date-time' }, schema);
    case 'ZodLiteral':
      return withDescription(
        { type: typeof def.value, enum: [def.value] },
        schema
      );
    case 'ZodEnum':
      return withDescription({ type: 'string', enum: [...def.values] }, schema);
    case 'ZodNativeEnum': {
      const values = Object.values(def.values).filter(
        (v) => typeof def.values[v] !== 'number'
      );
      return withDescription({ enum: values }, schema);
    }
    case 'ZodArray': {
      const out = { type: 'array', items: zodToOpenApi(def.type) };
      if (def.minLength) out.minItems = def.minLength.value;
      if (def.maxLength) out.maxItems = def.maxLength.value;
      if (def.exactLength) {
        out.minItems = def.exactLength.value;
        out.maxItems = def.exactLength.value;
      }
      return withDescription(out, schema);
    }
    case 'ZodTuple':
      return withDescription(
        {
          type: 'array',
          minItems: def.items.length,
          maxItems: def.items.length,
          prefixItems: def.items.map(zodToOpenApi),
        },
        schema
      );
    case 'ZodObject':
      return withDescription(objectSchema(schema), schema);
    case 'ZodRecord':
      return withDescription(
        { type: 'object', additionalProperties: zodToOpenApi(def.valueType) },
        schema
      );
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      return withDescription(
        { oneOf: [...def.options.values()].map(zodToOpenApi) },
        schema
      );
    case 'ZodIntersection':
      return withDescription(
        { allOf: [zodToOpenApi(def.left), zodToOpenApi(def.right)] },
        schema
      );
    case 'ZodOptional':
      return withDescription(zodToOpenApi(def.innerType), schema);
    case 'ZodNullable': {
      const inner = zodToOpenApi(def.innerType);
      if (typeof inner.type === 'string') {
        return withDescription(
          { ...inner, type: [inner.type, 'null'] },
          schema
        );
      }
      if (Array.isArray(inner.type)) {
        const types = inner.type.includes('null')
          ? inner.type
          : [...inner.type, 'null'];
        return withDescription({ ...inner, type: types }, schema);
      }
      return withDescription({ anyOf: [inner, { type: 'null' }] }, schema);
    }
    case 'ZodDefault':
      return withDescription(
        { ...zodToOpenApi(def.innerType), default: def.defaultValue() },
        schema
      );
    case 'ZodCatch':
    case 'ZodReadonly':
      return withDescription(zodToOpenApi(def.innerType), schema);
    case 'ZodBranded':
      return withDescription(zodToOpenApi(def.type), schema);
    case 'ZodEffects':
      return withDescription(zodToOpenApi(def.schema), schema);
    case 'ZodPipeline':
      return withDescription(zodToOpenApi(def.in), schema);
    case 'ZodLazy':
      return withDescription(zodToOpenApi(def.getter()), schema);
    default:
      // ZodAny / ZodUnknown / anything exotic: accept any value.
      return withDescription({}, schema);
  }
}

function unwrapObject(schema) {
  let current = schema;
  while (current?._def) {
    const { typeName } = current._def;
    if (typeName === 'ZodObject') return current;
    if (typeName === 'ZodEffects') current = current._def.schema;
    else if (typeName === 'ZodPipeline') current = current._def.in;
    else if (
      ['ZodOptional', 'ZodDefault', 'ZodNullable', 'ZodReadonly'].includes(
        typeName
      )
    )
      current = current._def.innerType;
    else return null;
  }
  return null;
}

function parametersFrom(schema, location) {
  const object = unwrapObject(schema);
  if (!object) return [];
  return Object.entries(object.shape).map(([name, value]) => {
    const param = {
      name,
      in: location,
      required: location === 'path' ? true : !value.isOptional(),
      schema: zodToOpenApi(value),
    };
    if (value.description) param.description = value.description;
    return param;
  });
}

/** Express path (`/items/:id`) to OpenAPI path (`/items/{id}`). */
export function toOpenApiPath(expressPath) {
  return expressPath.replace(/:([A-Za-z0-9_]+)\??/g, '{$1}');
}

/**
 * Recover the mount path of a router layer from its compiled regexp
 * (Express 4 does not keep the original string).
 */
export function mountPathFromLayer(layer) {
  if (layer.regexp?.fast_slash) return '';
  const keys = [...(layer.keys || [])];
  let source = layer.regexp.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '') // trailing `\/?(?=\/|$)`
    .replace(/\\\/\?\$$/, ''); // trailing `\/?$`
  source = source.replace(/\(\?:\\\/\(\[\^\/\]\+\?\)\)\??/g, () => {
    const key = keys.shift();
    return `/:${key ? key.name : 'param'}`;
  });
  return source.replace(/\\(.)/g, '$1');
}

function joinPaths(prefix, path) {
  const joined = `${prefix}/${path}`.replace(/\/{2,}/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

function walk(stack, prefix, visit) {
  for (const layer of stack || []) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path)
        ? layer.route.path
        : [layer.route.path];
      for (const path of paths) {
        if (typeof path === 'string') visit(joinPaths(prefix, path), layer);
      }
    } else if (layer.handle?.stack) {
      walk(
        layer.handle.stack,
        joinPaths(prefix, mountPathFromLayer(layer)),
        visit
      );
    }
  }
}

const VALIDATION_ERROR_RESPONSE = {
  description: 'Request failed schema validation',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ValidationError' },
    },
  },
};

export const VALIDATION_ERROR_SCHEMA = {
  type: 'object',
  properties: {
    success: { type: 'boolean', example: false },
    error: { type: 'string', example: 'Unprocessable Entity' },
    message: { type: 'string' },
    details: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          message: { type: 'string' },
          code: { type: 'string' },
          location: { type: 'string', enum: ['body', 'query', 'params'] },
        },
      },
    },
  },
};

function buildOperation(meta) {
  const { body, query, params, docs = {} } = meta;
  const operation = {
    ...(docs.summary && { summary: docs.summary }),
    ...(docs.description && { description: docs.description }),
    ...(docs.tags && { tags: docs.tags }),
    ...(docs.operationId && { operationId: docs.operationId }),
    ...(docs.security && { security: docs.security }),
    ...(docs.deprecated && { deprecated: true }),
  };

  const parameters = [
    ...parametersFrom(params, 'path'),
    ...parametersFrom(query, 'query'),
  ];
  if (parameters.length) operation.parameters = parameters;

  if (body) {
    operation.requestBody = {
      required: !body.isOptional(),
      content: { 'application/json': { schema: zodToOpenApi(body) } },
    };
  }

  operation.responses = {
    ...(docs.responses || { 200: { description: 'Successful response' } }),
    422: VALIDATION_ERROR_RESPONSE,
  };
  return operation;
}

/**
 * Walk the app's router tree and return every registered route with its
 * normalized OpenAPI path, HTTP method, and optional Zod `openapi` metadata.
 */
export function collectRegisteredRoutes(app) {
  const routes = [];
  const stack = app?._router?.stack;
  walk(stack, '', (fullPath, layer) => {
    const meta =
      layer.route.stack.find((l) => l.handle?.openapi)?.handle.openapi || null;
    const methods = Object.keys(layer.route.methods).filter((m) =>
      HTTP_METHODS.has(m)
    );
    const openApiPath = toOpenApiPath(fullPath);
    for (const method of methods) {
      routes.push({
        path: openApiPath,
        method,
        hasZodValidation: Boolean(meta),
        openapi: meta,
      });
    }
  });
  return routes;
}

/**
 * Recursively normalize legacy OpenAPI 3.0 schema keywords (such as
 * `nullable: true` and boolean `exclusiveMinimum`/`exclusiveMaximum`) into
 * valid OpenAPI 3.1.0 / JSON Schema 2020-12 constructs.
 */
export function normalizeSchemaToOpenApi31(node) {
  if (Array.isArray(node)) {
    return node.map(normalizeSchemaToOpenApi31);
  }
  if (!node || typeof node !== 'object') {
    return node;
  }

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'nullable') continue;
    out[key] = normalizeSchemaToOpenApi31(value);
  }

  if (node.nullable === true) {
    if (typeof out.type === 'string') {
      out.type = [out.type, 'null'];
    } else if (Array.isArray(out.type)) {
      if (!out.type.includes('null')) out.type = [...out.type, 'null'];
    } else if (out.$ref || out.oneOf || out.anyOf || out.allOf) {
      const inner = { ...out };
      for (const k of Object.keys(out)) delete out[k];
      out.anyOf = [inner, { type: 'null' }];
    }
  }

  if (typeof node.exclusiveMinimum === 'boolean') {
    if (node.exclusiveMinimum && typeof out.minimum === 'number') {
      out.exclusiveMinimum = out.minimum;
      delete out.minimum;
    } else {
      delete out.exclusiveMinimum;
    }
  }

  if (typeof node.exclusiveMaximum === 'boolean') {
    if (node.exclusiveMaximum && typeof out.maximum === 'number') {
      out.exclusiveMaximum = out.maximum;
      delete out.maximum;
    } else {
      delete out.exclusiveMaximum;
    }
  }

  return out;
}

/**
 * Walk the app's router tree and return `{ [path]: { [method]: operation } }`
 * for every route guarded by a Zod `validateRequest` middleware.
 */
export function collectZodOperations(app) {
  const paths = {};
  const stack = app?._router?.stack;
  walk(stack, '', (fullPath, layer) => {
    const meta = layer.route.stack.find((l) => l.handle?.openapi)?.handle
      .openapi;
    if (!meta) return;
    const methods = Object.keys(layer.route.methods).filter((m) =>
      HTTP_METHODS.has(m)
    );
    const openApiPath = toOpenApiPath(fullPath);
    for (const method of methods) {
      paths[openApiPath] ??= {};
      paths[openApiPath][method] = buildOperation(meta);
    }
  });
  return paths;
}

function mergeParameters(existing = [], generated = []) {
  const key = (p) => `${p.in}:${p.name}`;
  const generatedKeys = new Set(generated.map(key));
  return [...existing.filter((p) => !generatedKeys.has(key(p))), ...generated];
}

/**
 * Merge Zod-derived operations into a hand-written (swagger-jsdoc) spec.
 * JSDoc keeps prose (summary, description, response bodies); request
 * parameters and bodies always come from the live Zod schemas.
 */
export function mergeZodOperations(baseSpec, zodPaths) {
  const paths = { ...(baseSpec.paths || {}) };
  for (const [path, operations] of Object.entries(zodPaths)) {
    paths[path] = { ...(paths[path] || {}) };
    for (const [method, generated] of Object.entries(operations)) {
      const existing = paths[path][method];
      if (!existing) {
        paths[path][method] = generated;
        continue;
      }
      // Hand-written responses replace the generated placeholder; only the
      // validation-failure response is always added.
      const merged = {
        ...generated,
        ...existing,
        responses: existing.responses
          ? { ...existing.responses, 422: generated.responses[422] }
          : generated.responses,
      };
      const parameters = mergeParameters(
        existing.parameters,
        generated.parameters
      );
      if (parameters.length) merged.parameters = parameters;
      if (generated.requestBody) merged.requestBody = generated.requestBody;
      paths[path][method] = merged;
    }
  }
  return {
    ...baseSpec,
    components: {
      ...(baseSpec.components || {}),
      schemas: {
        ...(baseSpec.components?.schemas || {}),
        ValidationError: VALIDATION_ERROR_SCHEMA,
      },
    },
    paths,
  };
}
