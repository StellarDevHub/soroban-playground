import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import eventSchemaService from '../services/eventSchemaService.js';
import { sendSuccess } from '../utils/response.js';

const router = express.Router();

function getClientIdentity(req) {
  return (
    req.headers['x-admin-user'] ||
    req.headers['x-user'] ||
    req.ip ||
    'api'
  );
}

router.get(
  '/schemas',
  asyncHandler(async (req, res) => {
    const schemas = eventSchemaService.listSchemas(req.query.eventType);
    return sendSuccess(res, {
      data: schemas,
      message: 'Event schemas retrieved',
      meta: { count: schemas.length },
    });
  })
);

router.post(
  '/schemas',
  asyncHandler(async (req, res, next) => {
    const result = eventSchemaService.registerSchema(req.body || {}, {
      allowBreaking: req.body?.allowBreaking === true,
      registeredBy: getClientIdentity(req),
    });

    if (!result.registered) {
      return next(
        createHttpError(
          result.statusCode || 400,
          result.statusCode === 409
            ? 'Schema evolution rejected'
            : 'Schema registration failed',
          {
            errors: result.errors,
            evolution: result.evolution,
          }
        )
      );
    }

    return sendSuccess(res, {
      statusCode: 201,
      data: {
        schema: result.schema,
        evolution: result.evolution,
      },
      message: 'Event schema registered',
    });
  })
);

router.post(
  '/schemas/detect',
  asyncHandler(async (req, res) => {
    const result = eventSchemaService.detectSchemaChanges(req.body || {});
    return sendSuccess(res, {
      data: result,
      message: result.compatible
        ? 'Schema detection completed'
        : 'Schema detection found breaking changes',
    });
  })
);

router.get(
  '/schemas/alerts',
  asyncHandler(async (_req, res) => {
    const alerts = eventSchemaService.listSchemaAlerts();
    return sendSuccess(res, {
      data: alerts,
      message: 'Schema detection alerts retrieved',
      meta: { count: alerts.length },
    });
  })
);

router.get(
  '/schemas/:eventType',
  asyncHandler(async (req, res, next) => {
    const schemas = eventSchemaService.listSchemas(req.params.eventType);
    if (schemas.length === 0) {
      return next(createHttpError(404, 'Schema not found'));
    }
    return sendSuccess(res, {
      data: schemas,
      message: 'Event schema versions retrieved',
      meta: { count: schemas.length },
    });
  })
);

router.get(
  '/schemas/:eventType/:version',
  asyncHandler(async (req, res, next) => {
    const schema = eventSchemaService.getSchema(
      req.params.eventType,
      req.params.version
    );
    if (!schema) {
      return next(createHttpError(404, 'Schema version not found'));
    }
    return sendSuccess(res, {
      data: schema,
      message: 'Event schema retrieved',
    });
  })
);

router.post(
  '/validate',
  asyncHandler(async (req, res) => {
    const validation = eventSchemaService.validateEvent(req.body || {}, {
      recordMetric: true,
      outcome: 'rejected',
    });
    return sendSuccess(res, {
      statusCode: validation.valid ? 200 : 422,
      data: validation,
      message: validation.valid
        ? 'Event is valid'
        : 'Event failed schema validation',
    });
  })
);

router.post(
  '/ingest',
  asyncHandler(async (req, res) => {
    const result = eventSchemaService.ingestEvent(req.body || {}, {
      quarantineInvalid: req.body?.quarantineInvalid !== false,
    });

    return sendSuccess(res, {
      statusCode: result.accepted ? 202 : 422,
      data: result,
      message: result.accepted
        ? 'Event ingested'
        : result.quarantined
          ? 'Event quarantined for review'
          : 'Event rejected',
    });
  })
);

router.get(
  '/records',
  asyncHandler(async (req, res) => {
    const events = eventSchemaService.readEvents({
      eventType: req.query.eventType,
      targetVersion: req.query.targetVersion,
    });

    return sendSuccess(res, {
      data: events,
      message: 'Accepted events retrieved',
      meta: { count: events.length },
    });
  })
);

router.post(
  '/records/migrate',
  asyncHandler(async (req, res) => {
    const result = eventSchemaService.migrateEvent(
      req.body?.event || req.body,
      req.body?.targetVersion || req.body?.target_version
    );

    return sendSuccess(res, {
      statusCode: result.migrated ? 200 : 422,
      data: result,
      message: result.migrated
        ? 'Event migrated successfully'
        : 'Event migration failed',
    });
  })
);

router.get(
  '/quarantine',
  asyncHandler(async (req, res) => {
    const items = eventSchemaService.listQuarantine(req.query.status);
    return sendSuccess(res, {
      data: items,
      message: 'Quarantined events retrieved',
      meta: { count: items.length },
    });
  })
);

router.patch(
  '/quarantine/:id',
  asyncHandler(async (req, res, next) => {
    const item = eventSchemaService.updateQuarantineItem(req.params.id, req.body);
    if (!item) {
      return next(createHttpError(404, 'Quarantine item not found'));
    }
    return sendSuccess(res, {
      data: item,
      message: 'Quarantine item updated',
    });
  })
);

router.post(
  '/quarantine/:id/reprocess',
  asyncHandler(async (req, res, next) => {
    const result = eventSchemaService.reprocessQuarantinedEvent(
      req.params.id,
      req.body?.event
    );
    if (!result) {
      return next(createHttpError(404, 'Quarantine item not found'));
    }
    return sendSuccess(res, {
      statusCode: result.result.accepted ? 200 : 422,
      data: result,
      message: result.result.accepted
        ? 'Quarantined event reprocessed'
        : 'Quarantined event still fails validation',
    });
  })
);

router.get(
  '/metrics',
  asyncHandler(async (_req, res) => {
    return sendSuccess(res, {
      data: eventSchemaService.getQualityMetrics(),
      message: 'Event data quality metrics retrieved',
    });
  })
);

export default router;
