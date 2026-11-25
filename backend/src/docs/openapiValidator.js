// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { collectRegisteredRoutes } from './zodOpenApi.js';

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

const DEFAULT_IGNORED_PREFIXES = ['/docs', '/api-docs'];

function resolveInternalRef(spec, ref) {
  if (!ref.startsWith('#/')) return true;
  const parts = ref
    .slice(2)
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur = spec;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object' || !(part in cur)) {
      return false;
    }
    cur = cur[part];
  }
  return true;
}

function inspectSchemaNode(node, spec, pointer, errors) {
  if (Array.isArray(node)) {
    node.forEach((item, idx) =>
      inspectSchemaNode(item, spec, `${pointer}[${idx}]`, errors)
    );
    return;
  }
  if (!node || typeof node !== 'object') return;

  if ('nullable' in node && typeof node.nullable === 'boolean') {
    errors.push(
      `${pointer}: uses OpenAPI 3.0 "nullable" keyword; OpenAPI 3.1.0 requires type arrays (e.g. ["string", "null"]) or anyOf`
    );
  }
  if (typeof node.exclusiveMinimum === 'boolean') {
    errors.push(
      `${pointer}: uses boolean "exclusiveMinimum"; OpenAPI 3.1.0 requires a numeric value`
    );
  }
  if (typeof node.exclusiveMaximum === 'boolean') {
    errors.push(
      `${pointer}: uses boolean "exclusiveMaximum"; OpenAPI 3.1.0 requires a numeric value`
    );
  }
  if (typeof node.$ref === 'string' && !resolveInternalRef(spec, node.$ref)) {
    errors.push(`${pointer}: unresolved $ref "${node.$ref}"`);
  }

  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === 'object') {
      inspectSchemaNode(value, spec, `${pointer}.${key}`, errors);
    }
  }
}

/**
 * Validate an OpenAPI 3.1.0 specification document for structural integrity,
 * OAS 3.1 compliance (no legacy OAS 3.0-only keywords), and valid `$ref` links.
 */
export function validateOpenApi31Spec(spec) {
  const errors = [];
  const warnings = [];

  if (!spec || typeof spec !== 'object') {
    return {
      valid: false,
      errors: ['Specification must be an object'],
      warnings,
    };
  }

  if (typeof spec.openapi !== 'string' || !/^3\.1\.\d+$/.test(spec.openapi)) {
    errors.push(
      `Expected OpenAPI 3.1.x version string, got "${spec.openapi ?? 'undefined'}"`
    );
  }

  if (!spec.info || typeof spec.info !== 'object') {
    errors.push('Missing required "info" object');
  } else {
    if (!spec.info.title || typeof spec.info.title !== 'string') {
      errors.push('Missing required "info.title" string');
    }
    if (!spec.info.version || typeof spec.info.version !== 'string') {
      errors.push('Missing required "info.version" string');
    }
  }

  if (!spec.paths || typeof spec.paths !== 'object') {
    errors.push('Missing required "paths" object');
  } else {
    const pathEntries = Object.entries(spec.paths);
    if (pathEntries.length === 0) {
      errors.push(
        'Specification "paths" object must contain at least one path'
      );
    }

    for (const [pathKey, pathItem] of pathEntries) {
      if (!pathKey.startsWith('/')) {
        errors.push(`Path "${pathKey}" must start with "/"`);
      }
      if (!pathItem || typeof pathItem !== 'object') {
        errors.push(`Path "${pathKey}" must be an object`);
        continue;
      }

      for (const [method, operation] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method)) continue;
        const opPtr = `paths.${pathKey}.${method}`;
        if (!operation || typeof operation !== 'object') {
          errors.push(`${opPtr}: operation must be an object`);
          continue;
        }
        if (
          !operation.responses ||
          typeof operation.responses !== 'object' ||
          Object.keys(operation.responses).length === 0
        ) {
          errors.push(`${opPtr}: missing required "responses" object`);
        }
        inspectSchemaNode(operation, spec, opPtr, errors);
      }
    }
  }

  if (spec.components) {
    inspectSchemaNode(spec.components, spec, 'components', errors);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Verify that every registered Express route on `app` has an accurate entry
 * in `spec.paths` (matching HTTP method, Zod-derived parameters, and requestBody).
 */
export function validateRouteCoverage(app, spec, options = {}) {
  const { ignorePrefixes = DEFAULT_IGNORED_PREFIXES } = options;
  const routes = collectRegisteredRoutes(app).filter(
    (route) =>
      !ignorePrefixes.some(
        (prefix) => route.path === prefix || route.path.startsWith(`${prefix}/`)
      )
  );

  const missing = [];
  const mismatches = [];
  let documentedRoutes = 0;

  for (const route of routes) {
    const operation = spec?.paths?.[route.path]?.[route.method];
    if (!operation) {
      missing.push(`${route.method.toUpperCase()} ${route.path}`);
      continue;
    }
    documentedRoutes += 1;

    if (route.hasZodValidation && route.openapi) {
      const { body, params, query } = route.openapi;
      if (
        body &&
        !operation.requestBody?.content?.['application/json']?.schema
      ) {
        mismatches.push(
          `${route.method.toUpperCase()} ${route.path}: missing requestBody schema from Zod body validator`
        );
      }
      if (params?.shape) {
        const declared = new Set(
          (operation.parameters || [])
            .filter((p) => p.in === 'path')
            .map((p) => p.name)
        );
        for (const name of Object.keys(params.shape)) {
          if (!declared.has(name)) {
            mismatches.push(
              `${route.method.toUpperCase()} ${route.path}: missing path parameter "${name}"`
            );
          }
        }
      }
      if (query?.shape) {
        const declared = new Set(
          (operation.parameters || [])
            .filter((p) => p.in === 'query')
            .map((p) => p.name)
        );
        for (const name of Object.keys(query.shape)) {
          if (!declared.has(name)) {
            mismatches.push(
              `${route.method.toUpperCase()} ${route.path}: missing query parameter "${name}"`
            );
          }
        }
      }
    }
  }

  return {
    valid: missing.length === 0 && mismatches.length === 0,
    totalRoutes: routes.length,
    documentedRoutes,
    missing,
    mismatches,
  };
}
