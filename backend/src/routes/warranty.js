import { Router } from 'express';
const router = Router();

// Mock database for rapid development
const warranties = [];

router.get('/', (req, res) => {
  res.json(warranties);
});

router.post('/register', (req, res) => {
  const { owner, productId, duration } = req.body;
  const newWarranty = {
    id: warranties.length + 1,
    owner,
    productId,
    expiry: Date.now() + (duration * 1000),
    status: 'Active'
  };
  warranties.push(newWarranty);
  res.status(201).json(newWarranty);
});

export default router;
