import express from 'express';

const router = express.Router();

// Mock lottery endpoints to prevent 404 flood
router.get('/status', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'inactive',
      message: 'Lottery functionality not yet implemented',
    },
  });
});

router.get('/rounds', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({
    success: true,
    data: Array.from({ length: Math.min(limit, 10) }, (_, i) => ({
      id: i + 1,
      status: 'Completed',
      startTime: Date.now() - 86400000 * (i + 1),
      endTime: Date.now() - 86400000 * i,
      ticketPriceStroops: 10000000,
      ticketPriceXlm: '0.1',
      totalTickets: 100,
      prizePoolStroops: 1000000000,
      prizePoolXlm: '10.0',
      winnerTicketId: null,
      winner: null,
      committedSeed: '',
      claimed: false,
    })),
  });
});

router.get('/analytics', (req, res) => {
  res.json({
    success: true,
    data: {
      totalRounds: 0,
      completedRounds: 0,
      cancelledRounds: 0,
      totalTicketsSold: 0,
      totalPrizePool: 0,
      totalPrizesClaimed: 0,
      totalPrizePoolXlm: '0.0',
    },
  });
});

export default router;
