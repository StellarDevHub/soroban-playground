/**
 * Node-runnable test suite for Governance Mathematical Algorithms,
 * Quadratic Voting Curves, Quorum Calculations, and State Diff Simulations.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
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
} from '../../lib/gov/govMath.ts';
import { INITIAL_GOVERNANCE_PROPOSALS } from '../../lib/gov/mockProposals.ts';

test('1. Quadratic Voting Formulations', async (t) => {
  await t.test('calculateQuadraticVotes returns floor(sqrt(credits))', () => {
    assert.equal(calculateQuadraticVotes(0), 0);
    assert.equal(calculateQuadraticVotes(-10), 0);
    assert.equal(calculateQuadraticVotes(1), 1);
    assert.equal(calculateQuadraticVotes(3), 1);
    assert.equal(calculateQuadraticVotes(4), 2);
    assert.equal(calculateQuadraticVotes(8), 2);
    assert.equal(calculateQuadraticVotes(9), 3);
    assert.equal(calculateQuadraticVotes(16), 4);
    assert.equal(calculateQuadraticVotes(25), 5);
    assert.equal(calculateQuadraticVotes(100), 10);
    assert.equal(calculateQuadraticVotes(225), 15);
  });

  await t.test('calculateQuadraticCost returns votes^2', () => {
    assert.equal(calculateQuadraticCost(0), 0);
    assert.equal(calculateQuadraticCost(1), 1);
    assert.equal(calculateQuadraticCost(2), 4);
    assert.equal(calculateQuadraticCost(5), 25);
    assert.equal(calculateQuadraticCost(10), 100);
  });

  await t.test('calculateMarginalCost returns 2V + 1 for next vote', () => {
    assert.equal(calculateMarginalCost(0), 1); // 0 -> 1 costs 1 credit
    assert.equal(calculateMarginalCost(1), 3); // 1 -> 2 costs 4 - 1 = 3 credits
    assert.equal(calculateMarginalCost(2), 5); // 2 -> 3 costs 9 - 4 = 5 credits
    assert.equal(calculateMarginalCost(3), 7); // 3 -> 4 costs 16 - 9 = 7 credits
    assert.equal(calculateMarginalCost(10), 21); // 10 -> 11 costs 121 - 100 = 21 credits
  });

  await t.test('calculateQuadraticMetrics returns complete metrics bundle', () => {
    const metrics = calculateQuadraticMetrics(100);
    assert.equal(metrics.creditsAllocated, 100);
    assert.equal(metrics.votesEarned, 10);
    assert.equal(metrics.marginalCostNextVote, 21);
    assert.equal(metrics.efficiencyPct, 10);
  });

  await t.test('generateQuadraticCurvePoints produces bounded coordinates', () => {
    const points = generateQuadraticCurvePoints(100, 10);
    assert.ok(points.length >= 10);
    assert.equal(points[0].credits, 0);
    assert.equal(points[0].votes, 0);
    assert.equal(points[points.length - 1].credits, 100);
    assert.equal(points[points.length - 1].votes, 10);
  });
});

test('2. Quorum Threshold Dynamics', async (t) => {
  await t.test('detects when quorum has not been reached', () => {
    const q = calculateQuorumProgress(50000, 100000);
    assert.equal(q.reached, false);
    assert.equal(q.progressPct, 50);
    assert.equal(q.tokensRemaining, 50000);
  });

  await t.test('detects exact quorum attainment', () => {
    const q = calculateQuorumProgress(100000, 100000);
    assert.equal(q.reached, true);
    assert.equal(q.progressPct, 100);
    assert.equal(q.tokensRemaining, 0);
  });

  await t.test('caps progress at 100% when exceeding quorum', () => {
    const q = calculateQuorumProgress(150000, 100000);
    assert.equal(q.reached, true);
    assert.equal(q.progressPct, 100);
    assert.equal(q.tokensRemaining, 0);
  });
});

test('3. Approval Progress & Thresholds', async (t) => {
  await t.test('evaluates passing proposal above 50% majority', () => {
    const app = calculateApprovalProgress(600, 400, 100, 50);
    assert.equal(app.approvalPct, 60);
    assert.equal(app.isPassing, true);
    assert.equal(app.totalVotes, 1100);
  });

  await t.test('evaluates failing proposal below 50% threshold', () => {
    const app = calculateApprovalProgress(300, 700, 50, 50);
    assert.equal(app.approvalPct, 30);
    assert.equal(app.isPassing, false);
  });

  await t.test('evaluates supermajority requirement of 66%', () => {
    const passSuper = calculateApprovalProgress(700, 300, 0, 66);
    assert.equal(passSuper.approvalPct, 70);
    assert.equal(passSuper.isPassing, true);

    const failSuper = calculateApprovalProgress(600, 400, 0, 66);
    assert.equal(failSuper.approvalPct, 60);
    assert.equal(failSuper.isPassing, false);
  });

  await t.test('handles zero decisive votes safely without NaN', () => {
    const app = calculateApprovalProgress(0, 0, 50, 50);
    assert.equal(app.approvalPct, 0);
    assert.equal(app.isPassing, false);
    assert.equal(app.totalVotes, 50);
  });
});

test('4. Ledger State Diff Simulation', async (t) => {
  await t.test('detects modified and added keys with critical security flag', () => {
    const baseStorage = {
      fee_rate_bps: 30,
      protocol_name: 'SorobanAMM',
    };

    const payload = {
      targetContract: 'CAMM123',
      functionName: 'update_fee',
      args: {
        fee_rate_bps: 20,
        new_treasury_vault: 'GABC456',
      },
      estimatedGasStroops: 2500,
    };

    const diffs = simulateProposalStateDiff(payload, baseStorage);
    assert.equal(diffs.length, 2);

    const feeDiff = diffs.find((d) => d.key === 'fee_rate_bps');
    assert.ok(feeDiff);
    assert.equal(feeDiff.diffType, 'modified');
    assert.equal(feeDiff.previousValue, 30);
    assert.equal(feeDiff.proposedValue, 20);
    assert.equal(feeDiff.isSecurityCritical, true);

    const vaultDiff = diffs.find((d) => d.key === 'new_treasury_vault');
    assert.ok(vaultDiff);
    assert.equal(vaultDiff.diffType, 'added');
    assert.equal(vaultDiff.previousValue, null);
    assert.equal(vaultDiff.proposedValue, 'GABC456');
  });

  await t.test('detects removed keys for deprecation entrypoints', () => {
    const payload = {
      targetContract: 'CBRIDGE',
      functionName: 'deprecate_bridge_v1',
      args: {
        target_key: 'legacy_bridge_v1_active',
      },
      estimatedGasStroops: 1800,
    };

    const diffs = simulateProposalStateDiff(payload);
    const removedDiff = diffs.find((d) => d.diffType === 'removed');
    assert.ok(removedDiff);
    assert.equal(removedDiff.key, 'legacy_bridge_v1_active');
    assert.equal(removedDiff.proposedValue, null);
    assert.equal(removedDiff.isSecurityCritical, true);
  });
});

test('5. Sample Proposal Integrity', async (t) => {
  await t.test('initial proposals include active, passed, defeated, and executed states', () => {
    assert.ok(INITIAL_GOVERNANCE_PROPOSALS.length >= 4);

    const statuses = new Set(INITIAL_GOVERNANCE_PROPOSALS.map((p) => p.status));
    assert.ok(statuses.has('Active'));
    assert.ok(statuses.has('Passed'));
    assert.ok(statuses.has('Defeated'));
    assert.ok(statuses.has('Executed'));
  });
});

test('6. Treasury Impact Simulation Dynamics', async (t) => {
  await t.test('calculates accurate drawdown from proposal state diffs', () => {
    const pip11 = INITIAL_GOVERNANCE_PROPOSALS.find((p) => p.id === 'PIP-11');
    assert.ok(pip11);
    const impact = calculateTreasuryImpact(pip11);
    assert.equal(impact.baselineBalance, 25000000);
    assert.equal(impact.simulatedBalance, 24500000);
    assert.equal(impact.netDelta, -500000);
    assert.equal(impact.deltaPct, -2);
    assert.equal(impact.impactType, 'drawdown');
  });

  await t.test('calculates fee rate revenue percentage delta', () => {
    const pip14 = INITIAL_GOVERNANCE_PROPOSALS.find((p) => p.id === 'PIP-14');
    assert.ok(pip14);
    const impact = calculateTreasuryImpact(pip14);
    assert.equal(impact.impactType, 'fee_adjustment');
    assert.equal(impact.deltaPct, -33.3);
  });

  await t.test('handles non-financial proposals as net neutral', () => {
    const pip15 = INITIAL_GOVERNANCE_PROPOSALS.find((p) => p.id === 'PIP-15');
    assert.ok(pip15);
    const impact = calculateTreasuryImpact(pip15);
    assert.equal(impact.impactType, 'neutral');
    assert.equal(impact.netDelta, 0);
  });
});
