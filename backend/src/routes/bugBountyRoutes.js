import express from 'express';
import bugBountyService from '../services/bugBountyService.js';

const router = express.Router();

router.post('/submit', async (req, res) => {
  try {
    const report = await bugBountyService.submitReport(req.body);
    res.status(201).json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/reports', async (req, res) => {
  try {
    const reports = await bugBountyService.getReports();
    res.json({ success: true, data: reports });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/review/:id', async (req, res) => {
  try {
    const report = await bugBountyService.reviewReport(req.params.id, req.body);
    res.json({ success: true, data: report });
  } catch (error) {
    res.status(404).json({ success: false, error: error.message });
  }
});

export default router;
