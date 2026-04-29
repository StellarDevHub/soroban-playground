import express from 'express';
import { treasuryService } from '../services/treasuryService.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.get('/info', rateLimiter('standard'), async (req, res, next) => {
  try {
    const info = await treasuryService.getTreasuryInfo();
    res.json(info);
  } catch (error) {
    logger.error('Failed to fetch treasury info', { error: error.message });
    next(error);
  }
});

router.get('/proposals', rateLimiter('standard'), async (req, res, next) => {
  try {
    const proposals = await treasuryService.getProposals();
    res.json(proposals);
  } catch (error) {
    logger.error('Failed to fetch proposals', { error: error.message });
    next(error);
  }
});

router.post('/proposals', rateLimiter('standard'), async (req, res, next) => {
  try {
    const { recipient, amount, description, duration } = req.body;
    const userId = req.user?.id || 'anonymous';

    if (!recipient || !amount || !description) {
      return res.status(400).json({ error: 'recipient, amount, and description are required' });
    }

    const result = await treasuryService.createProposal(
      userId,
      recipient,
      amount,
      description,
      duration || 86400
    );
    res.json(result);
  } catch (error) {
    logger.error('Failed to create proposal', { error: error.message });
    next(error);
  }
});

router.post('/proposals/:id/sign', rateLimiter('standard'), async (req, res, next) => {
  try {
    const proposalId = parseInt(req.params.id);
    const userId = req.user?.id || 'anonymous';

    const result = await treasuryService.signProposal(userId, proposalId);
    res.json(result);
  } catch (error) {
    logger.error('Failed to sign proposal', { error: error.message });
    next(error);
  }
});

router.post('/proposals/:id/execute', rateLimiter('standard'), async (req, res, next) => {
  try {
    const proposalId = parseInt(req.params.id);
    const userId = req.user?.id || 'anonymous';

    const result = await treasuryService.executeProposal(userId, proposalId);
    res.json(result);
  } catch (error) {
    logger.error('Failed to execute proposal', { error: error.message });
    next(error);
  }
});

router.get('/signers', rateLimiter('standard'), async (req, res, next) => {
  try {
    const signers = await treasuryService.getSigners();
    res.json(signers);
  } catch (error) {
    logger.error('Failed to fetch signers', { error: error.message });
    next(error);
  }
});

router.get('/threshold', rateLimiter('standard'), async (req, res, next) => {
  try {
    const threshold = await treasuryService.getThreshold();
    res.json(threshold);
  } catch (error) {
    logger.error('Failed to fetch threshold', { error: error.message });
    next(error);
  }
});

router.post('/signers', rateLimiter('admin'), async (req, res, next) => {
  try {
    const { signer } = req.body;
    const adminId = req.user?.id || 'admin';

    if (!signer) {
      return res.status(400).json({ error: 'signer is required' });
    }

    const result = await treasuryService.addSigner(adminId, signer);
    res.json(result);
  } catch (error) {
    logger.error('Failed to add signer', { error: error.message });
    next(error);
  }
});

router.delete('/signers/:signer', rateLimiter('admin'), async (req, res, next) => {
  try {
    const { signer } = req.params;
    const adminId = req.user?.id || 'admin';

    const result = await treasuryService.removeSigner(adminId, signer);
    res.json(result);
  } catch (error) {
    logger.error('Failed to remove signer', { error: error.message });
    next(error);
  }
});

router.put('/threshold', rateLimiter('admin'), async (req, res, next) => {
  try {
    const { threshold } = req.body;
    const adminId = req.user?.id || 'admin';

    if (!threshold || threshold <= 0) {
      return res.status(400).json({ error: 'valid threshold is required' });
    }

    const result = await treasuryService.updateThreshold(adminId, threshold);
    res.json(result);
  } catch (error) {
    logger.error('Failed to update threshold', { error: error.message });
    next(error);
  }
});

router.post('/deposit', rateLimiter('standard'), async (req, res, next) => {
  try {
    const { token, amount } = req.body;
    const userId = req.user?.id || 'anonymous';

    if (!token || !amount) {
      return res.status(400).json({ error: 'token and amount are required' });
    }

    const result = await treasuryService.deposit(userId, token, amount);
    res.json(result);
  } catch (error) {
    logger.error('Failed to deposit', { error: error.message });
    next(error);
  }
});

export default router;
