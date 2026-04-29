import express from 'express';

import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';
import patentRegistryService from '../services/patentRegistryService.js';
import { sendSuccess } from '../utils/response.js';

const router = express.Router();

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseActor(req) {
  const headerActor = req.headers['x-actor-address'];
  if (typeof headerActor === 'string' && headerActor.trim()) {
    return headerActor.trim();
  }
  if (typeof req.body?.actor === 'string' && req.body.actor.trim()) {
    return req.body.actor.trim();
  }
  return '';
}

function validatePatentPayload(body) {
  const errors = [];

  if (!isNonEmptyString(body.owner)) {
    errors.push('owner is required');
  }
  if (!isNonEmptyString(body.title)) {
    errors.push('title is required');
  }
  if (!isNonEmptyString(body.description)) {
    errors.push('description is required');
  }
  if (!isNonEmptyString(body.contentHash)) {
    errors.push('contentHash is required');
  }
  if (!isNonEmptyString(body.metadataUri)) {
    errors.push('metadataUri is required');
  }

  return errors;
}

function validateOfferPayload(body) {
  const errors = [];

  if (!Number.isInteger(body.patentId) || body.patentId <= 0) {
    errors.push('patentId must be a positive integer');
  }
  if (!isNonEmptyString(body.owner)) {
    errors.push('owner is required');
  }
  if (!isNonEmptyString(body.terms)) {
    errors.push('terms is required');
  }
  if (typeof body.paymentAmount !== 'number' || body.paymentAmount <= 0) {
    errors.push('paymentAmount must be a positive number');
  }
  if (!isNonEmptyString(body.paymentToken)) {
    errors.push('paymentToken is required');
  }

  return errors;
}

function validatePatchPayload(body) {
  return validatePatentPayload({
    owner: 'placeholder',
    title: body.title,
    description: body.description,
    contentHash: body.contentHash,
    metadataUri: body.metadataUri,
  }).filter((message) => message !== 'owner is required');
}

function validateOfferPatch(body) {
  const errors = [];
  if (!isNonEmptyString(body.terms)) {
    errors.push('terms is required');
  }
  if (typeof body.paymentAmount !== 'number' || body.paymentAmount <= 0) {
    errors.push('paymentAmount must be a positive number');
  }
  if (!isNonEmptyString(body.paymentToken)) {
    errors.push('paymentToken is required');
  }
  return errors;
}

router.use(rateLimitMiddleware('patents'));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const data = await patentRegistryService.getDashboard();
    return sendSuccess(res, {
      data,
      message: 'Patent registry dashboard loaded',
    });
  })
);

router.get(
  '/config',
  asyncHandler(async (_req, res) => {
    return sendSuccess(res, {
      data: patentRegistryService.getConfig(),
      message: 'Patent registry config loaded',
    });
  })
);

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    return sendSuccess(res, {
      data: {
        status: 'ok',
        patents: (await patentRegistryService.listPatents()).length,
        offers: (await patentRegistryService.listOffers()).length,
      },
      message: 'Patent registry service healthy',
    });
  })
);

router.get(
  '/items',
  asyncHandler(async (req, res) => {
    const data = await patentRegistryService.listPatents({
      owner: req.query.owner,
      verificationStatus: req.query.verificationStatus,
    });
    return sendSuccess(res, {
      data,
      message: 'Patents loaded',
    });
  })
);

router.post(
  '/items',
  asyncHandler(async (req, res, next) => {
    const errors = validatePatentPayload(req.body || {});
    if (errors.length > 0) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    const patent = await patentRegistryService.createPatent({
      owner: req.body.owner.trim(),
      title: req.body.title.trim(),
      description: req.body.description.trim(),
      contentHash: req.body.contentHash.trim(),
      metadataUri: req.body.metadataUri.trim(),
    });

    return sendSuccess(res, {
      statusCode: 201,
      data: patent,
      message: 'Patent registered successfully',
    });
  })
);

router.get(
  '/items/:id',
  asyncHandler(async (req, res, next) => {
    const patent = await patentRegistryService.getPatent(req.params.id);
    if (!patent) {
      return next(createHttpError(404, 'Patent not found'));
    }

    return sendSuccess(res, {
      data: patent,
      message: 'Patent loaded',
    });
  })
);

router.patch(
  '/items/:id',
  asyncHandler(async (req, res, next) => {
    const actor = parseActor(req);
    if (!actor) {
      return next(createHttpError(400, 'Validation failed', ['actor is required']));
    }

    const errors = validatePatchPayload(req.body || {});
    if (errors.length > 0) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    try {
      const patent = await patentRegistryService.updatePatent(req.params.id, actor, {
        title: req.body.title.trim(),
        description: req.body.description.trim(),
        contentHash: req.body.contentHash.trim(),
        metadataUri: req.body.metadataUri.trim(),
      });

      if (!patent) {
        return next(createHttpError(404, 'Patent not found'));
      }

      return sendSuccess(res, {
        data: patent,
        message: 'Patent updated successfully',
      });
    } catch (error) {
      return next(createHttpError(error.statusCode || 500, error.message));
    }
  })
);

router.post(
  '/items/:id/verify',
  asyncHandler(async (req, res, next) => {
    const actor = parseActor(req);
    if (!actor) {
      return next(createHttpError(400, 'Validation failed', ['actor is required']));
    }

    try {
      const patent = await patentRegistryService.verifyPatent(req.params.id, actor);
      if (!patent) {
        return next(createHttpError(404, 'Patent not found'));
      }

      return sendSuccess(res, {
        data: patent,
        message: 'Patent verified successfully',
      });
    } catch (error) {
      return next(createHttpError(error.statusCode || 500, error.message));
    }
  })
);

router.get(
  '/licenses',
  asyncHandler(async (req, res) => {
    const data = await patentRegistryService.listOffers({
      patentId: req.query.patentId ? Number(req.query.patentId) : undefined,
      owner: req.query.owner,
      status: req.query.status,
    });

    return sendSuccess(res, {
      data,
      message: 'License offers loaded',
    });
  })
);

router.post(
  '/licenses',
  asyncHandler(async (req, res, next) => {
    const body = {
      ...req.body,
      patentId: Number(req.body?.patentId),
      paymentAmount: Number(req.body?.paymentAmount),
    };
    const errors = validateOfferPayload(body);
    if (errors.length > 0) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    try {
      const offer = await patentRegistryService.createOffer({
        patentId: body.patentId,
        owner: body.owner.trim(),
        terms: body.terms.trim(),
        paymentAmount: body.paymentAmount,
        paymentToken: body.paymentToken.trim(),
      });

      if (!offer) {
        return next(createHttpError(404, 'Patent not found'));
      }

      return sendSuccess(res, {
        statusCode: 201,
        data: offer,
        message: 'License offer created successfully',
      });
    } catch (error) {
      return next(createHttpError(error.statusCode || 500, error.message));
    }
  })
);

router.get(
  '/licenses/:id',
  asyncHandler(async (req, res, next) => {
    const offer = await patentRegistryService.getOffer(req.params.id);
    if (!offer) {
      return next(createHttpError(404, 'License offer not found'));
    }

    return sendSuccess(res, {
      data: offer,
      message: 'License offer loaded',
    });
  })
);

router.patch(
  '/licenses/:id',
  asyncHandler(async (req, res, next) => {
    const actor = parseActor(req);
    if (!actor) {
      return next(createHttpError(400, 'Validation failed', ['actor is required']));
    }

    const body = {
      ...req.body,
      paymentAmount: Number(req.body?.paymentAmount),
    };
    const errors = validateOfferPatch(body);
    if (errors.length > 0) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    try {
      const offer = await patentRegistryService.updateOffer(req.params.id, actor, {
        terms: body.terms.trim(),
        paymentAmount: body.paymentAmount,
        paymentToken: body.paymentToken.trim(),
      });

      if (!offer) {
        return next(createHttpError(404, 'License offer not found'));
      }

      return sendSuccess(res, {
        data: offer,
        message: 'License offer updated successfully',
      });
    } catch (error) {
      return next(createHttpError(error.statusCode || 500, error.message));
    }
  })
);

router.post(
  '/licenses/:id/accept',
  asyncHandler(async (req, res, next) => {
    const actor = parseActor(req);
    if (!actor) {
      return next(createHttpError(400, 'Validation failed', ['actor is required']));
    }

    try {
      const offer = await patentRegistryService.acceptOffer(req.params.id, actor);
      if (!offer) {
        return next(createHttpError(404, 'License offer not found'));
      }

      return sendSuccess(res, {
        data: offer,
        message: 'License offer accepted successfully',
      });
    } catch (error) {
      return next(createHttpError(error.statusCode || 500, error.message));
    }
  })
);

router.get(
  '/history',
  asyncHandler(async (req, res) => {
    const data = await patentRegistryService.listHistory({
      patentId: req.query.patentId ? Number(req.query.patentId) : undefined,
    });

    return sendSuccess(res, {
      data,
      message: 'Transaction history loaded',
    });
  })
);

export default router;
