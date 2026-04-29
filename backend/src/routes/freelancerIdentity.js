import express from 'express';
import freelancerIdentityService from '../services/freelancerIdentityService.js';
import logger from '../utils/logger.js';
import { sendError, sendSuccess } from '../utils/response.js';

const router = express.Router();

function handleError(res, error) {
  logger.warn('Freelancer identity API error', {
    message: error.message,
    statusCode: error.statusCode || 500,
  });
  return sendError(res, {
    message: error.message,
    statusCode: error.statusCode || 500,
  });
}

router.get('/health', (_req, res) => {
  sendSuccess(res, {
    message: 'Freelancer identity service healthy',
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
    },
  });
});

router.get('/profiles', (req, res) => {
  try {
    const profiles = freelancerIdentityService.listProfiles(req.query);
    sendSuccess(res, { data: profiles });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/profiles', (req, res) => {
  try {
    const profile = freelancerIdentityService.createProfile(req.body);
    sendSuccess(res, {
      statusCode: 201,
      message: 'Freelancer profile created',
      data: profile,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/profiles/:owner', (req, res) => {
  try {
    sendSuccess(res, {
      data: freelancerIdentityService.getProfile(req.params.owner),
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/portfolio-verifications', (req, res) => {
  try {
    const result = freelancerIdentityService.verifyPortfolio(req.body);
    sendSuccess(res, {
      statusCode: 201,
      message: 'Portfolio verification recorded',
      data: result,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/skill-endorsements', (req, res) => {
  try {
    const result = freelancerIdentityService.endorseSkill(req.body);
    sendSuccess(res, {
      statusCode: 201,
      message: 'Skill endorsement recorded',
      data: result,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/analytics', (_req, res) => {
  sendSuccess(res, {
    data: freelancerIdentityService.analytics(),
  });
});

export default router;
