export type VestingType = "Linear" | "Milestone";

export interface MilestoneData {
  index: number;
  descriptionHash: number;
  pctBps: number;
  approved: boolean;
  description?: string;
}

export interface VestingScheduleData {
  id: number;
  beneficiary: string;
  token: string;
  symbol?: string;
  totalAmount: number;
  releasedAmount: number; // Tokens already claimed
  cliffTimestamp: number;
  startTimestamp: number;
  endTimestamp: number;
  vestingType: VestingType;
  milestones: MilestoneData[];
  revoked: boolean;
  revocable?: boolean;
  cliffUnlockPercentage?: number; // e.g., 20 for 20%
  cliffAmount?: number; // Absolute token amount unlocked at cliff
  revocationTimestamp?: number;
}

export interface VestingBreakdown {
  totalGranted: number;
  vestedAmount: number;
  vestedPercentage: number;
  claimedAmount: number;
  claimedPercentage: number;
  claimableAmount: number;
  claimablePercentage: number;
  lockedAmount: number;
  lockedPercentage: number;
  revocableAmount: number;
  nonRevocableAmount: number;
  isCliffReached: boolean;
  isMatured: boolean;
  nextMilestoneDate: Date | null;
  nextMilestoneLabel: string;
  secondsToNextMilestone: number;
}

export interface VestingTimelinePoint {
  timestamp: number;
  date: Date;
  dateFormatted: string;
  vestedAmount: number;
  vestedPercentage: number;
  lockedAmount: number;
  event?: "start" | "cliff" | "milestone" | "maturity" | "now";
  label?: string;
}
