/**
 * Jest test suite for Governance Mathematical Algorithms and Simulations.
 */

import {
  calculateQuadraticVotes,
  calculateQuadraticCost,
  calculateMarginalCost,
  calculateQuadraticMetrics,
  generateQuadraticCurvePoints,
  calculateQuorumProgress,
  calculateApprovalProgress,
  simulateProposalStateDiff,
  calculateTreasuryImpact,
} from '../../lib/gov/govMath';
import { INITIAL_GOVERNANCE_PROPOSALS } from '../../lib/gov/mockProposals';

describe('Governance Mathematics & Quorum Engine', () => {
  describe('Quadratic Voting Engine', () => {
    it('calculates votes as floor(sqrt(credits))', () => {
      expect(calculateQuadraticVotes(0)).toBe(0);
      expect(calculateQuadraticVotes(1)).toBe(1);
      expect(calculateQuadraticVotes(4)).toBe(2);
      expect(calculateQuadraticVotes(9)).toBe(3);
      expect(calculateQuadraticVotes(16)).toBe(4);
      expect(calculateQuadraticVotes(100)).toBe(10);
    });

    it('calculates cost as votes^2', () => {
      expect(calculateQuadraticCost(3)).toBe(9);
      expect(calculateQuadraticCost(10)).toBe(100);
    });

    it('calculates marginal cost of the next vote as 2V + 1', () => {
      expect(calculateMarginalCost(0)).toBe(1);
      expect(calculateMarginalCost(1)).toBe(3);
      expect(calculateMarginalCost(2)).toBe(5);
      expect(calculateMarginalCost(10)).toBe(21);
    });

    it('produces quadratic voting metrics bundle', () => {
      const metrics = calculateQuadraticMetrics(64);
      expect(metrics.creditsAllocated).toBe(64);
      expect(metrics.votesEarned).toBe(8);
      expect(metrics.marginalCostNextVote).toBe(17);
    });

    it('generates coordinate samples for plotting', () => {
      const points = generateQuadraticCurvePoints(100, 10);
      expect(points.length).toBeGreaterThanOrEqual(10);
      expect(points[0].credits).toBe(0);
      expect(points[points.length - 1].credits).toBe(100);
    });
  });

  describe('Quorum Calculation', () => {
    it('accurately computes quorum percentage and reached state', () => {
      const below = calculateQuorumProgress(40000, 100000);
      expect(below.reached).toBe(false);
      expect(below.progressPct).toBe(40);
      expect(below.tokensRemaining).toBe(60000);

      const reached = calculateQuorumProgress(120000, 100000);
      expect(reached.reached).toBe(true);
      expect(reached.progressPct).toBe(100);
      expect(reached.tokensRemaining).toBe(0);
    });
  });

  describe('Approval Ratios', () => {
    it('computes approval percentage excluding abstentions', () => {
      const res = calculateApprovalProgress(75, 25, 20, 50);
      expect(res.approvalPct).toBe(75);
      expect(res.isPassing).toBe(true);
      expect(res.totalVotes).toBe(120);
    });
  });

  describe('State Diff Simulation', () => {
    it('generates added, modified, and security-critical diffs', () => {
      const payload = {
        targetContract: 'CTEST',
        functionName: 'update_admin',
        args: {
          admin: 'GNEWADMIN...',
          param: 10,
        },
        estimatedGasStroops: 1000,
      };

      const diffs = simulateProposalStateDiff(payload, { admin: 'GOLDADMIN...' });
      const adminDiff = diffs.find((d) => d.key === 'admin');
      expect(adminDiff?.diffType).toBe('modified');
      expect(adminDiff?.isSecurityCritical).toBe(true);
    });
  });

  describe('Treasury Impact Simulation', () => {
    it('simulates drawdown from prospective state diffs', () => {
      const pip11 = INITIAL_GOVERNANCE_PROPOSALS.find((p) => p.id === 'PIP-11');
      expect(pip11).toBeDefined();
      const impact = calculateTreasuryImpact(pip11);
      expect(impact.baselineBalance).toBe(25000000);
      expect(impact.simulatedBalance).toBe(24500000);
      expect(impact.netDelta).toBe(-500000);
      expect(impact.deltaPct).toBe(-2);
      expect(impact.impactType).toBe('drawdown');
    });

    it('simulates fee rate adjustments', () => {
      const pip14 = INITIAL_GOVERNANCE_PROPOSALS.find((p) => p.id === 'PIP-14');
      expect(pip14).toBeDefined();
      const impact = calculateTreasuryImpact(pip14);
      expect(impact.impactType).toBe('fee_adjustment');
      expect(impact.deltaPct).toBe(-33.3);
    });

    it('defaults to neutral impact for non-financial proposals', () => {
      const pip15 = INITIAL_GOVERNANCE_PROPOSALS.find((p) => p.id === 'PIP-15');
      expect(pip15).toBeDefined();
      const impact = calculateTreasuryImpact(pip15);
      expect(impact.impactType).toBe('neutral');
      expect(impact.netDelta).toBe(0);
    });
  });

  describe('Proposals Dataset', () => {
    it('contains diverse proposal statuses', () => {
      expect(INITIAL_GOVERNANCE_PROPOSALS.length).toBeGreaterThanOrEqual(4);
      const active = INITIAL_GOVERNANCE_PROPOSALS.find((p) => p.status === 'Active');
      expect(active).toBeDefined();
    });
  });
});
