/**
 * Pure mathematical algorithms and simulation routines for:
 * - Quadratic voting curve generation and marginal cost analysis
 * - Quorum progress and approval threshold calculations
 * - Prospective ledger state diff forecasting
 */

import type {
  ApprovalStatus,
  GovernanceProposal,
  LedgerStateDiff,
  ProposalExecutablePayload,
  QuadraticVotingMetrics,
  QuorumStatus,
  TreasuryImpactSimulation,
} from './types';

/**
 * Calculates effective quadratic votes from allocated token credits:
 * Votes = floor(sqrt(credits))
 */
export function calculateQuadraticVotes(credits: number): number {
  if (typeof credits !== 'number' || isNaN(credits) || credits <= 0) {
    return 0;
  }
  return Math.floor(Math.sqrt(credits));
}

/**
 * Calculates required token credits to obtain a desired number of votes:
 * Credits = votes^2
 */
export function calculateQuadraticCost(votes: number): number {
  if (typeof votes !== 'number' || isNaN(votes) || votes <= 0) {
    return 0;
  }
  const cleanVotes = Math.floor(votes);
  return cleanVotes * cleanVotes;
}

/**
 * Computes marginal token cost to obtain the next incremental vote:
 * MarginalCost = (V + 1)^2 - V^2 = 2V + 1
 */
export function calculateMarginalCost(currentVotes: number): number {
  const v = Math.max(0, Math.floor(currentVotes || 0));
  return 2 * v + 1;
}

/**
 * Generates comprehensive quadratic voting metrics for a given credit allocation.
 */
export function calculateQuadraticMetrics(credits: number): QuadraticVotingMetrics {
  const safeCredits = Math.max(0, Math.floor(credits || 0));
  const votesEarned = calculateQuadraticVotes(safeCredits);
  const marginalCostNextVote = calculateMarginalCost(votesEarned);
  const efficiencyPct = safeCredits > 0 ? Math.min(100, (votesEarned / safeCredits) * 100) : 100;

  return {
    creditsAllocated: safeCredits,
    votesEarned,
    marginalCostNextVote,
    efficiencyPct: Number(efficiencyPct.toFixed(1)),
  };
}

/**
 * Generates coordinate samples (x = credits, y = votes) for SVG curve rendering.
 */
export function generateQuadraticCurvePoints(
  maxCredits: number = 100,
  stepCount: number = 30,
): { credits: number; votes: number }[] {
  const safeMax = Math.max(10, Math.floor(maxCredits || 100));
  const steps = Math.max(5, Math.min(50, stepCount));
  const stepSize = safeMax / steps;
  const points: { credits: number; votes: number }[] = [];

  for (let i = 0; i <= steps; i++) {
    const credits = Math.round(i * stepSize);
    const votes = calculateQuadraticVotes(credits);
    points.push({ credits, votes });
  }

  return points;
}

/**
 * Evaluates quorum progress based on total tokens voted vs required quorum threshold.
 */
export function calculateQuorumProgress(
  totalTokensVoted: number,
  quorumThreshold: number,
): QuorumStatus {
  const safeTotal = Math.max(0, totalTokensVoted || 0);
  const safeThreshold = Math.max(1, quorumThreshold || 1);

  const rawPct = (safeTotal / safeThreshold) * 100;
  const progressPct = Number(Math.min(100, rawPct).toFixed(1));
  const reached = safeTotal >= safeThreshold;
  const tokensRemaining = Math.max(0, safeThreshold - safeTotal);

  return {
    reached,
    progressPct,
    tokensRemaining,
  };
}

/**
 * Calculates proposal approval percentage and determines passing status:
 * ApprovalPct = VotesFor / (VotesFor + VotesAgainst) * 100
 */
export function calculateApprovalProgress(
  votesFor: number,
  votesAgainst: number,
  votesAbstain: number = 0,
  thresholdPct: number = 50,
): ApprovalStatus {
  const safeFor = Math.max(0, votesFor || 0);
  const safeAgainst = Math.max(0, votesAgainst || 0);
  const safeAbstain = Math.max(0, votesAbstain || 0);

  const decisiveVotes = safeFor + safeAgainst;
  const totalVotes = decisiveVotes + safeAbstain;

  if (decisiveVotes === 0) {
    return {
      approvalPct: 0,
      isPassing: false,
      totalVotes,
    };
  }

  const rawPct = (safeFor / decisiveVotes) * 100;
  const approvalPct = Number(rawPct.toFixed(1));
  const isPassing = approvalPct >= thresholdPct;

  return {
    approvalPct,
    isPassing,
    totalVotes,
  };
}

/**
 * Known security-sensitive ledger keys that warrant critical alert indicators.
 */
const SECURITY_CRITICAL_KEYS = new Set([
  'admin',
  'fee_rate_bps',
  'paused',
  'circuit_breaker_active',
  'circuit_breaker_cooldown',
  'trusted_oracles',
  'emergency_council',
  'withdrawal_limit',
  'upgrade_timelock_ledgers',
]);

/**
 * Simulates prospective contract execution state diffs from an executable payload.
 */
export function simulateProposalStateDiff(
  payload: ProposalExecutablePayload,
  baseStorage: Record<string, unknown> = {},
): LedgerStateDiff[] {
  const diffs: LedgerStateDiff[] = [];
  const args = payload.args || {};

  // Infer mutated storage keys based on entrypoint and arguments
  Object.entries(args).forEach(([argKey, argValue]) => {
    const storageKey = argKey;
    const isSecurityCritical = SECURITY_CRITICAL_KEYS.has(storageKey.toLowerCase());
    const previous = baseStorage[storageKey];

    if (previous === undefined) {
      diffs.push({
        key: storageKey,
        previousValue: null,
        proposedValue: argValue,
        diffType: 'added',
        isSecurityCritical,
        category: 'persistent',
      });
    } else if (JSON.stringify(previous) !== JSON.stringify(argValue)) {
      diffs.push({
        key: storageKey,
        previousValue: previous,
        proposedValue: argValue,
        diffType: 'modified',
        isSecurityCritical,
        category: 'instance',
      });
    }
  });

  // Handle specific well-known contract operations
  const func = (payload.functionName || '').toLowerCase();
  if (func.includes('deprecate') || func.includes('remove') || func.includes('delete')) {
    const targetKey = (args.target_key as string) || 'legacy_module_v1';
    diffs.push({
      key: targetKey,
      previousValue: 'ACTIVE_DEPLOYMENT_HASH',
      proposedValue: null,
      diffType: 'removed',
      isSecurityCritical: true,
      category: 'persistent',
    });
  }

  return diffs;
}

/**
 * Calculates simulated treasury balance impact if a governance proposal passes and is executed.
 */
export function calculateTreasuryImpact(
  proposal?: GovernanceProposal | null,
  baseTreasury: number = 25_000_000,
): TreasuryImpactSimulation {
  if (!proposal) {
    return {
      baselineBalance: baseTreasury,
      simulatedBalance: baseTreasury,
      netDelta: 0,
      deltaPct: 0,
      currency: 'XLM',
      impactType: 'neutral',
      description: 'No proposal selected.',
    };
  }

  // Check state diffs for direct treasury reserve changes
  const treasuryDiff = proposal.prospectiveStateDiff?.find(
    (d) =>
      d.key.toLowerCase().includes('treasury') ||
      d.key.toLowerCase().includes('reserve_balance') ||
      d.key.toLowerCase().includes('grant_reserve'),
  );

  if (treasuryDiff && typeof treasuryDiff.proposedValue === 'number') {
    const prev =
      typeof treasuryDiff.previousValue === 'number'
        ? treasuryDiff.previousValue
        : baseTreasury;
    const proposed = treasuryDiff.proposedValue;
    const delta = proposed - prev;
    const deltaPct = prev > 0 ? Number(((delta / prev) * 100).toFixed(2)) : 0;

    return {
      baselineBalance: prev,
      simulatedBalance: proposed,
      netDelta: delta,
      deltaPct,
      currency: 'XLM',
      impactType: delta < 0 ? 'drawdown' : delta > 0 ? 'inflow' : 'neutral',
      description:
        delta < 0
          ? `Disburses ${Math.abs(delta).toLocaleString()} XLM from community treasury upon execution.`
          : delta > 0
          ? `Deposits ${delta.toLocaleString()} XLM to community treasury upon execution.`
          : 'Treasury reserve remains unchanged.',
    };
  }

  // Check executable payload args for grants / payouts (e.g. amount_stroops or amount)
  const args = proposal.executablePayload?.args || {};
  if (args.amount_stroops && typeof args.amount_stroops === 'number') {
    const amountXlm = args.amount_stroops / 10_000_000;
    const simulated = Math.max(0, baseTreasury - amountXlm);
    const delta = -amountXlm;
    const deltaPct =
      baseTreasury > 0 ? Number(((delta / baseTreasury) * 100).toFixed(2)) : 0;
    return {
      baselineBalance: baseTreasury,
      simulatedBalance: simulated,
      netDelta: delta,
      deltaPct,
      currency: 'XLM',
      impactType: 'drawdown',
      description: `Disburses ${amountXlm.toLocaleString()} XLM from community treasury upon execution.`,
    };
  }

  // Check fee adjustments (e.g. fee_rate_bps)
  const feeDiff = proposal.prospectiveStateDiff?.find((d) =>
    d.key.includes('fee_rate_bps'),
  );
  if (
    feeDiff &&
    typeof feeDiff.proposedValue === 'number' &&
    typeof feeDiff.previousValue === 'number'
  ) {
    const feeChangePct = Number(
      (
        ((feeDiff.proposedValue - feeDiff.previousValue) /
          feeDiff.previousValue) *
        100
      ).toFixed(1),
    );
    return {
      baselineBalance: baseTreasury,
      simulatedBalance: baseTreasury,
      netDelta: 0,
      deltaPct: feeChangePct,
      currency: 'XLM',
      impactType: 'fee_adjustment',
      description: `Adjusts protocol swap fee rate from ${feeDiff.previousValue} bps to ${feeDiff.proposedValue} bps (${feeChangePct > 0 ? '+' : ''}${feeChangePct}% revenue rate impact).`,
    };
  }

  // Default: Net neutral / No direct reserve balance drawdown
  return {
    baselineBalance: baseTreasury,
    simulatedBalance: baseTreasury,
    netDelta: 0,
    deltaPct: 0,
    currency: 'XLM',
    impactType: 'neutral',
    description: 'No direct treasury reserve drawdown required for this proposal.',
  };
}
