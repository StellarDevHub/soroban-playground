export type VestingType = "Linear" | "Milestone";

export interface MilestoneData {
  index: number;
  descriptionHash: number;
  pctBps: number;
  approved: boolean;
}

export interface VestingScheduleData {
  id: number;
  beneficiary: string;
  token: string;
  totalAmount: number;
  releasedAmount: number;
  cliffTimestamp: number;
  startTimestamp: number;
  endTimestamp: number;
  vestingType: VestingType;
  milestones: MilestoneData[];
  revoked: boolean;
  revokedTimestamp?: number;
  revokedAmount?: number;
}

export function vestedAmountAt(
  schedule: VestingScheduleData,
  timestamp: number,
): number {
  if (schedule.totalAmount <= 0) return 0;
  if (schedule.vestingType === "Milestone") {
    const approvedBps = schedule.milestones
      .filter((milestone) => milestone.approved)
      .reduce((total, milestone) => total + milestone.pctBps, 0);
    return Math.min(
      schedule.totalAmount,
      Math.floor((schedule.totalAmount * approvedBps) / 10000),
    );
  }
  const effectiveTimestamp =
    schedule.revoked && schedule.revokedTimestamp !== undefined
      ? Math.min(timestamp, schedule.revokedTimestamp)
      : timestamp;
  if (
    effectiveTimestamp < schedule.cliffTimestamp ||
    schedule.endTimestamp <= schedule.cliffTimestamp
  ) {
    return 0;
  }
  if (effectiveTimestamp >= schedule.endTimestamp) return schedule.totalAmount;
  return Math.floor(
    (schedule.totalAmount *
      (effectiveTimestamp - schedule.cliffTimestamp)) /
      (schedule.endTimestamp - schedule.cliffTimestamp),
  );
}

export function claimedAmount(schedule: VestingScheduleData): number {
  return Math.min(
    Math.max(schedule.releasedAmount, 0),
    Math.max(schedule.totalAmount, 0),
  );
}

export function claimableAmount(
  schedule: VestingScheduleData,
  timestamp: number,
): number {
  return Math.max(
    vestedAmountAt(schedule, timestamp) - claimedAmount(schedule),
    0,
  );
}

export function revokedAmount(schedule: VestingScheduleData): number {
  if (!schedule.revoked) return 0;
  return Math.min(
    Math.max(schedule.revokedAmount ?? 0, 0),
    Math.max(schedule.totalAmount - claimedAmount(schedule), 0),
  );
}
