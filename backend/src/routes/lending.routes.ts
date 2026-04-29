import { Request, Response, Router } from 'express';

const router = Router();

// Mock database
interface MockLoan {
  id: string;
  borrower: string;
  collateral_amount: number;
  loan_amount: number;
  interest_rate: number;
  creation_time: number;
  last_repayment: number;
  total_repaid: number;
  status: 'Active' | 'Repaid' | 'Liquidated' | 'Defaulted';
  collateral_token: string;
  remaining_debt?: number;
}

interface MockCreditScore {
  user: string;
  score: number;
  total_loans: number;
  successful_repayments: number;
  defaulted_loans: number;
  last_updated: number;
}

let loans: MockLoan[] = [];
let creditScores: MockCreditScore[] = [];

// GET /api/loans - Get all loans (admin) or user loans
router.get('/', async (req: Request, res: Response) => {
  try {
    const { user, status } = req.query;
    
    let filteredLoans = loans;
    if (user) {
      filteredLoans = filteredLoans.filter(l => l.borrower === user);
    }
    if (status) {
      filteredLoans = filteredLoans.filter(l => l.status === status);
    }
    
    // Calculate remaining debt for active loans
    const loansWithDebt = filteredLoans.map(loan => ({
      ...loan,
      remaining_debt: loan.status === 'Active' ? 
        loan.loan_amount * (1 + loan.interest_rate / 10000) - loan.total_repaid : 0
    }));
    
    res.json(loansWithDebt);
  } catch {
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
});

// GET /api/loans/:id - Get loan by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const loan = loans.find(l => l.id === id);
    
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }
    
    res.json(loan);
  } catch {
    res.status(500).json({ error: 'Failed to fetch loan' });
  }
});

// POST /api/loans - Create a new loan
router.post('/', async (req: Request, res: Response) => {
  try {
    const { borrower, collateral_amount, loan_amount } = req.body;
    
    if (!borrower || !collateral_amount || !loan_amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (collateral_amount < loan_amount * 1.5) {
      return res.status(400).json({ error: 'Insufficient collateral (min 150%)' });
    }
    
    const newLoan: MockLoan = {
      id: `loan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      borrower,
      collateral_amount,
      loan_amount,
      interest_rate: 500, // 5%
      creation_time: Math.floor(Date.now() / 1000),
      last_repayment: Math.floor(Date.now() / 1000),
      total_repaid: 0,
      status: 'Active',
      collateral_token: 'native',
    };
    
    loans.push(newLoan);
    
    // Update credit score
    let score = creditScores.find(s => s.user === borrower);
    if (!score) {
      score = {
        user: borrower,
        score: 500,
        total_loans: 0,
        successful_repayments: 0,
        defaulted_loans: 0,
        last_updated: Math.floor(Date.now() / 1000),
      };
    }
    score.total_loans += 1;
    score.last_updated = Math.floor(Date.now() / 1000);
    
    const scoreIndex = creditScores.findIndex(s => s.user === borrower);
    if (scoreIndex >= 0) {
      creditScores[scoreIndex] = score;
    } else {
      creditScores.push(score);
    }
    
    res.status(201).json(newLoan);
  } catch {
    res.status(500).json({ error: 'Failed to create loan' });
  }
});

// POST /api/loans/:id/repay - Repay loan
router.post('/:id/repay', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;
    
    const loanIndex = loans.findIndex(l => l.id === id);
    if (loanIndex === -1) {
      return res.status(404).json({ error: 'Loan not found' });
    }
    
    const loan = loans[loanIndex];
    if (loan.status !== 'Active') {
      return res.status(400).json({ error: 'Loan is not active' });
    }
    
    const interest = loan.loan_amount * (loan.interest_rate / 10000);
    const totalDebt = loan.loan_amount + interest;
    const remaining = totalDebt - loan.total_repaid;
    
    if (amount > remaining) {
      return res.status(400).json({ error: 'Repayment exceeds debt' });
    }
    
    loans[loanIndex] = {
      ...loan,
      total_repaid: loan.total_repaid + amount,
      last_repayment: Math.floor(Date.now() / 1000),
    };
    
    if (loans[loanIndex].total_repaid >= totalDebt) {
      loans[loanIndex].status = 'Repaid';
      
      // Update credit score for successful repayment
      let score = creditScores.find(s => s.user === loan.borrower);
      if (score) {
        score.successful_repayments += 1;
        score.score = Math.min(1000, score.score + 20);
        score.last_updated = Math.floor(Date.now() / 1000);
      }
    }
    
    res.json(loans[loanIndex]);
  } catch {
    res.status(500).json({ error: 'Failed to repay loan' });
  }
});

// POST /api/loans/:id/liquidate - Liquidate loan (admin)
router.post('/:id/liquidate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const loanIndex = loans.findIndex(l => l.id === id);
    if (loanIndex === -1) {
      return res.status(404).json({ error: 'Loan not found' });
    }
    
    const loan = loans[loanIndex];
    if (loan.status !== 'Active') {
      return res.status(400).json({ error: 'Loan is not active' });
    }
    
    const interest = loan.loan_amount * (loan.interest_rate / 10000);
    const totalDebt = loan.loan_amount + interest;
    const healthFactor = (loan.collateral_amount * 100) / totalDebt;
    
    if (healthFactor >= 150) {
      return res.status(400).json({ error: 'Liquidation threshold not reached' });
    }
    
    loans[loanIndex] = {
      ...loan,
      status: 'Liquidated',
    };
    
    // Update credit score for default
    let score = creditScores.find(s => s.user === loan.borrower);
    if (score) {
      score.defaulted_loans += 1;
      score.score = Math.max(0, score.score - 50);
      score.last_updated = Math.floor(Date.now() / 1000);
    }
    
    res.json(loans[loanIndex]);
  } catch {
    res.status(500).json({ error: 'Failed to liquidate loan' });
  }
});

// GET /api/credit-score/:user - Get user's credit score
router.get('/credit-score/:user', async (req: Request, res: Response) => {
  try {
    const { user } = req.params;
    
    let score = creditScores.find(s => s.user === user);
    if (!score) {
      score = {
        user,
        score: 500,
        total_loans: 0,
        successful_repayments: 0,
        defaulted_loans: 0,
        last_updated: Math.floor(Date.now() / 1000),
      };
    }
    
    res.json(score);
  } catch {
    res.status(500).json({ error: 'Failed to fetch credit score' });
  }
});

// GET /api/analytics - Get lending analytics (admin)
router.get('/analytics', async (req: Request, res: Response) => {
  try {
    const totalLoans = loans.length;
    const activeLoans = loans.filter(l => l.status === 'Active').length;
    const repaidLoans = loans.filter(l => l.status === 'Repaid').length;
    const liquidatedLoans = loans.filter(l => l.status === 'Liquidated').length;
    
    const totalBorrowed = loans.reduce((sum, l) => sum + l.loan_amount, 0);
    const totalRepaid = loans.reduce((sum, l) => sum + l.total_repaid, 0);
    
    const avgCreditScore = creditScores.length > 0 ?
      creditScores.reduce((sum, s) => sum + s.score, 0) / creditScores.length : 500;
    
    res.json({
      total_loans: totalLoans,
      active_loans: activeLoans,
      repaid_loans: repaidLoans,
      liquidated_loans: liquidatedLoans,
      total_borrowed: totalBorrowed,
      total_repaid: totalRepaid,
      average_credit_score: avgCreditScore,
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

export default router;
