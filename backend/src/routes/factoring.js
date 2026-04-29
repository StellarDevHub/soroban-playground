import { Router } from 'express';
const router = Router();

const invoices = [];

// Get risk score for an invoice amount
router.post('/assess-risk', (req, res) => {
  const { amount } = req.body;
  // Mock risk logic: Higher amounts = higher risk score
  const riskScore = amount > 5000 ? 8 : 3;
  res.json({ riskScore });
});

router.post('/submit', (req, res) => {
  const { business, amount, riskScore } = req.body;
  const invoice = {
    id: invoices.length + 1,
    business,
    amount,
    riskScore,
    status: 'Pending',
    createdAt: new Date()
  };
  invoices.push(invoice);
  res.status(201).json(invoice);
});

export default router;
