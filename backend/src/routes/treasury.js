import { Router } from 'express';
import { treasuryService } from '../services/treasuryService.js';
import rateLimit from 'express-rate-limit';

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

router.use(limiter);

// GET all proposals
router.get('/proposals', async (req, res) => {
  try {
    const proposals = await treasuryService.getProposals();
    res.json(proposals);
  } catch (error) {
    console.error('Error fetching proposals:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET proposal by ID
router.get('/proposals/:id', async (req, res) => {
  try {
    const proposal = await treasuryService.getProposalById(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Not found' });
    res.json(proposal);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST new proposal
router.post('/proposals', async (req, res) => {
  try {
    await treasuryService.createProposal(req.body);
    res.status(201).json({ message: 'Proposal created' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST update proposal status (e.g., from Indexer)
router.patch('/proposals/:id/status', async (req, res) => {
  try {
    await treasuryService.updateProposalStatus(req.params.id, req.body.status);
    res.json({ message: 'Status updated' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST record approval
router.post('/proposals/:id/approve', async (req, res) => {
  try {
    await treasuryService.recordApproval(req.params.id, req.body.signer);
    res.json({ message: 'Approval recorded' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// GET treasury history
router.get('/history', async (req, res) => {
  try {
    const history = await treasuryService.getHistory();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
