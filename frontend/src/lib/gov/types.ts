/**
 * Types and interfaces for the On-Chain Governance Voting & Proposal Impact Visualizer.
 */

export type ProposalStatus = 'Active' | 'Passed' | 'Defeated' | 'Executed' | 'Queued';

export type VoteChoice = 'For' | 'Against' | 'Abstain';

export type DiffType = 'added' | 'modified' | 'removed';

export interface ProposalExecutablePayload {
  targetContract: string;
  functionName: string;
  args: Record<string, unknown>;
  estimatedGasStroops: number;
}

export interface LedgerStateDiff {
  key: string;
  previousValue: unknown;
  proposedValue: unknown;
  diffType: DiffType;
  isSecurityCritical: boolean;
  category: 'instance' | 'persistent' | 'temporary';
}

export interface GovernanceProposal {
  id: string;
  title: string;
  description: string;
  proposer: string;
  startLedger: number;
  endLedger: number;
  currentLedger: number;
  status: ProposalStatus;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  totalTokensVoted: number;
  votersCount: number;
  quorumThresholdTokens: number;
  approvalThresholdPct: number;
  executablePayload: ProposalExecutablePayload;
  prospectiveStateDiff: LedgerStateDiff[];
  quadraticVotingEnabled: boolean;
  createdAt: string;
}

export interface QuadraticVotingMetrics {
  creditsAllocated: number;
  votesEarned: number;
  marginalCostNextVote: number;
  efficiencyPct: number;
}

export interface QuorumStatus {
  reached: boolean;
  progressPct: number;
  tokensRemaining: number;
}

export interface ApprovalStatus {
  approvalPct: number;
  isPassing: boolean;
  totalVotes: number;
}

export interface UserVoteRecord {
  proposalId: string;
  choice: VoteChoice;
  creditsAllocated: number;
  effectiveVotes: number;
  timestamp: number;
  txHash?: string;
}

export interface BatchVoteItem {
  proposalId: string;
  choice: VoteChoice;
  credits: number;
}

export interface TreasuryImpactSimulation {
  baselineBalance: number;
  simulatedBalance: number;
  netDelta: number;
  deltaPct: number;
  currency: string;
  impactType: 'drawdown' | 'inflow' | 'neutral' | 'fee_adjustment';
  description: string;
}
