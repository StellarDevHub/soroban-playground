// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Automated CI validation for the OpenAPI 3.1.0 specification and registered
 * Zod-validated routes.
 *
 * Exits with code 0 when the spec is valid OpenAPI 3.1.0 with zero errors and
 * zero warnings and all checked routes have accurate OpenAPI definitions.
 */
import express from 'express';
import { z } from 'zod';
import {
  swaggerSpec,
  buildLiveSpec,
  setupSwagger,
} from '../src/docs/swagger.js';
import {
  validateOpenApi31Spec,
  validateRouteCoverage,
} from '../src/docs/openapiValidator.js';
import { validateRequest } from '../src/middleware/validation.js';

function assertResult(label, result) {
  if (!result.valid || (result.warnings && result.warnings.length > 0)) {
    console.error(`[openapi:validate] ${label} FAILED:`);
    for (const err of result.errors || []) console.error(`  ERROR: ${err}`);
    for (const warn of result.warnings || []) console.error(`  WARN:  ${warn}`);
    for (const item of result.missing || [])
      console.error(`  MISSING: ${item}`);
    for (const item of result.mismatches || []) {
      console.error(`  MISMATCH: ${item}`);
    }
    process.exit(1);
  }
}

const staticCheck = validateOpenApi31Spec(swaggerSpec);
assertResult('Static OpenAPI 3.1.0 spec', staticCheck);

const app = express();
app.use(express.json());
app.post(
  '/api/ci-openapi-check/:id',
  validateRequest(
    {
      params: z.object({ id: z.string().uuid() }),
      query: z.object({ dryRun: z.coerce.boolean().optional() }),
      body: z.object({
        name: z.string().min(1),
        note: z.string().nullable(),
        count: z.number().int().positive(),
      }),
    },
    { summary: 'CI OpenAPI 3.1 route validation probe', tags: ['CI'] }
  ),
  (_req, res) => res.json({ ok: true })
);
setupSwagger(app);

const liveSpec = buildLiveSpec(app);
const liveSpecCheck = validateOpenApi31Spec(liveSpec);
assertResult('Live OpenAPI 3.1.0 spec', liveSpecCheck);

const coverageCheck = validateRouteCoverage(app, liveSpec);
assertResult('Registered route OpenAPI coverage', coverageCheck);

console.log(
  `[openapi:validate] OK — OpenAPI ${liveSpec.openapi}, ${Object.keys(liveSpec.paths).length} documented paths, ${coverageCheck.documentedRoutes}/${coverageCheck.totalRoutes} mounted routes verified.`
);
