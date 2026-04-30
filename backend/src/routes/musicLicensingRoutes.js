import express from 'express';
import musicLicensingService from '../services/musicLicensingService.js';

const router = express.Router();

router.post('/tracks', async (req, res) => {
  try {
    const track = await musicLicensingService.registerTrack(req.body);
    res.status(201).json({ success: true, data: track });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/tracks', async (req, res) => {
  try {
    const tracks = await musicLicensingService.getTracks();
    res.json({ success: true, data: tracks });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/licenses', async (req, res) => {
  try {
    const { trackId, buyerData } = req.body;
    const license = await musicLicensingService.purchaseLicense(trackId, buyerData);
    res.json({ success: true, data: license });
  } catch (error) {
    res.status(404).json({ success: false, error: error.message });
  }
});

export default router;
