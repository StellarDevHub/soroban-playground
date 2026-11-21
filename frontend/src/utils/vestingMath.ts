import {
  VestingScheduleData,
  VestingBreakdown,
  VestingTimelinePoint,
} from "../types/vesting";

/**
 * Calculates the exact number of vested tokens at any given timestamp.
 *
 * Rules:
 * 1. Before cliff (timestamp < cliffTimestamp): 0 vested tokens.
 * 2. At exact cliff timestamp (timestamp === cliffTimestamp): cliff unlock percentage/amount released.
 * 3. Midway through linear vesting: proportional linear accumulation of remaining tokens.
 * 4. At/after maturity (timestamp >= endTimestamp): 100% of granted tokens vested.
 * 5. Milestone schedules: unlocks based on approved milestones post-cliff.
 * 6. Revoked schedules: capped at the vested tokens at revocation timestamp.
 */
export function calculateVestedTokens(
  schedule: VestingScheduleData,
  currentTimestamp: number,
): number {
  const {
    totalAmount,
    cliffTimestamp,
    endTimestamp,
    vestingType,
    cliffUnlockPercentage,
    cliffAmount: explicitCliffAmount,
    revoked,
    revocationTimestamp,
    milestones,
  } = schedule;

  if (totalAmount <= 0) {
    return 0;
  }

  // 1. Before cliff -> 0 vested
  if (currentTimestamp < cliffTimestamp) {
    return 0;
  }

  // Determine cliff unlock amount
  let cliffAmount = 0;
  if (explicitCliffAmount !== undefined && explicitCliffAmount >= 0) {
    cliffAmount = Math.min(totalAmount, explicitCliffAmount);
  } else if (
    cliffUnlockPercentage !== undefined &&
    cliffUnlockPercentage >= 0
  ) {
    cliffAmount = totalAmount * (Math.min(100, cliffUnlockPercentage) / 100);
  }

  let vested = 0;

  if (vestingType === "Linear") {
    // 2. At exact cliff timestamp -> cliff percentage/amount released
    if (currentTimestamp === cliffTimestamp) {
      vested = cliffAmount;
    }
    // 4. At or after maturity -> 100% vested
    else if (currentTimestamp >= endTimestamp) {
      vested = totalAmount;
    }
    // 3. Post-cliff linear accumulation
    else {
      const linearDuration = endTimestamp - cliffTimestamp;
      if (linearDuration <= 0) {
        vested = totalAmount;
      } else {
        const elapsedSinceCliff = currentTimestamp - cliffTimestamp;
        const linearFraction = elapsedSinceCliff / linearDuration;
        const remainingToVest = totalAmount - cliffAmount;
        vested = cliffAmount + remainingToVest * linearFraction;
      }
    }
  } else if (vestingType === "Milestone") {
    // Milestone vesting post-cliff
    const approvedBps = (milestones || [])
      .filter((m) => m.approved)
      .reduce((sum, m) => sum + m.pctBps, 0);

    const milestoneRatio = Math.min(1, approvedBps / 10000);
    vested = totalAmount * milestoneRatio;
  }

  // Handle schedule revocation
  if (revoked) {
    if (revocationTimestamp !== undefined) {
      const vestedAtRevocation = calculateVestedTokens(
        { ...schedule, revoked: false },
        revocationTimestamp,
      );
      vested = Math.min(vested, vestedAtRevocation);
    }
  }

  // Bound between 0 and totalAmount, clean small float rounding
  const bounded = Math.max(0, Math.min(totalAmount, vested));
  return Math.round(bounded * 1e6) / 1e6;
}

/**
 * Computes a comprehensive financial breakdown of the vesting schedule.
 */
export function getVestingBreakdown(
  schedule: VestingScheduleData,
  currentTimestamp: number,
): VestingBreakdown {
  const totalGranted = schedule.totalAmount;
  const vestedAmount = calculateVestedTokens(schedule, currentTimestamp);
  const vestedPercentage =
    totalGranted > 0 ? (vestedAmount / totalGranted) * 100 : 0;

  const rawClaimed = schedule.releasedAmount || 0;
  const claimedAmount = Math.min(rawClaimed, vestedAmount);
  const claimedPercentage =
    totalGranted > 0 ? (claimedAmount / totalGranted) * 100 : 0;

  const claimableAmount = Math.max(0, vestedAmount - claimedAmount);
  const claimablePercentage =
    totalGranted > 0 ? (claimableAmount / totalGranted) * 100 : 0;

  const lockedAmount = Math.max(0, totalGranted - vestedAmount);
  const lockedPercentage =
    totalGranted > 0 ? (lockedAmount / totalGranted) * 100 : 0;

  const isCliffReached = currentTimestamp >= schedule.cliffTimestamp;
  const isMatured = currentTimestamp >= schedule.endTimestamp;

  // Revocable portions: if revocable, remaining unvested tokens are revocable
  const isRevocableSchedule = schedule.revocable !== false;
  const revocableAmount =
    isRevocableSchedule && !schedule.revoked ? lockedAmount : 0;
  const nonRevocableAmount = Math.max(0, totalGranted - revocableAmount);

  let nextMilestoneDate: Date | null = null;
  let nextMilestoneLabel = "Schedule Fully Matured";
  let secondsToNextMilestone = 0;

  if (!isCliffReached) {
    nextMilestoneDate = new Date(schedule.cliffTimestamp * 1000);
    nextMilestoneLabel = "Cliff Unlock";
    secondsToNextMilestone = Math.max(
      0,
      schedule.cliffTimestamp - currentTimestamp,
    );
  } else if (!isMatured) {
    nextMilestoneDate = new Date(schedule.endTimestamp * 1000);
    nextMilestoneLabel = "Full Maturity";
    secondsToNextMilestone = Math.max(
      0,
      schedule.endTimestamp - currentTimestamp,
    );
  }

  return {
    totalGranted,
    vestedAmount,
    vestedPercentage: Math.round(vestedPercentage * 100) / 100,
    claimedAmount,
    claimedPercentage: Math.round(claimedPercentage * 100) / 100,
    claimableAmount,
    claimablePercentage: Math.round(claimablePercentage * 100) / 100,
    lockedAmount,
    lockedPercentage: Math.round(lockedPercentage * 100) / 100,
    revocableAmount,
    nonRevocableAmount,
    isCliffReached,
    isMatured,
    nextMilestoneDate,
    nextMilestoneLabel,
    secondsToNextMilestone,
  };
}

/**
 * Formats a duration in seconds into human-readable countdown string (e.g., "12d 04h 32m 15s" or "02h 15m 00s").
 */
export function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) {
    return "00h 00m 00s";
  }

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const pad = (n: number) => n.toString().padStart(2, "0");

  if (days > 0) {
    return `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
  }
  return `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
}

/**
 * Pretty-formats token amounts with thousand separators and symbol.
 */
export function formatTokenAmount(
  amount: number,
  symbol?: string,
  decimals = 2,
): string {
  const formatted = amount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
  return symbol ? `${formatted} ${symbol}` : formatted;
}

/**
 * Generates coordinate points across the timeline for stepped-area SVG chart rendering.
 */
export function generateVestingTimelinePoints(
  schedule: VestingScheduleData,
  steps = 30,
): VestingTimelinePoint[] {
  const { startTimestamp, cliffTimestamp, endTimestamp, totalAmount } =
    schedule;
  const points: VestingTimelinePoint[] = [];

  const formatDate = (ts: number) =>
    new Date(ts * 1000).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  // 1. Start point (0 vested)
  points.push({
    timestamp: startTimestamp,
    date: new Date(startTimestamp * 1000),
    dateFormatted: formatDate(startTimestamp),
    vestedAmount: 0,
    vestedPercentage: 0,
    lockedAmount: totalAmount,
    event: "start",
    label: "Grant Start",
  });

  // 2. Pre-cliff point if cliff is after start (0 vested)
  if (cliffTimestamp > startTimestamp) {
    const preCliffTs = Math.max(startTimestamp, cliffTimestamp - 1);
    points.push({
      timestamp: preCliffTs,
      date: new Date(preCliffTs * 1000),
      dateFormatted: formatDate(preCliffTs),
      vestedAmount: 0,
      vestedPercentage: 0,
      lockedAmount: totalAmount,
      label: "Pre-Cliff Lockup",
    });
  }

  // 3. Cliff unlock point (stepped jump)
  const cliffVested = calculateVestedTokens(schedule, cliffTimestamp);
  points.push({
    timestamp: cliffTimestamp,
    date: new Date(cliffTimestamp * 1000),
    dateFormatted: formatDate(cliffTimestamp),
    vestedAmount: cliffVested,
    vestedPercentage:
      totalAmount > 0 ? (cliffVested / totalAmount) * 100 : 0,
    lockedAmount: totalAmount - cliffVested,
    event: "cliff",
    label: "Cliff Unlock",
  });

  // 4. Intermediate points post-cliff to maturity
  const postCliffDuration = endTimestamp - cliffTimestamp;
  if (postCliffDuration > 0 && steps > 0) {
    const stepSize = postCliffDuration / (steps + 1);
    for (let i = 1; i <= steps; i++) {
      const ts = Math.floor(cliffTimestamp + i * stepSize);
      const vested = calculateVestedTokens(schedule, ts);
      points.push({
        timestamp: ts,
        date: new Date(ts * 1000),
        dateFormatted: formatDate(ts),
        vestedAmount: vested,
        vestedPercentage: totalAmount > 0 ? (vested / totalAmount) * 100 : 0,
        lockedAmount: totalAmount - vested,
      });
    }
  }

  // 5. Maturity point (100% vested)
  points.push({
    timestamp: endTimestamp,
    date: new Date(endTimestamp * 1000),
    dateFormatted: formatDate(endTimestamp),
    vestedAmount: totalAmount,
    vestedPercentage: 100,
    lockedAmount: 0,
    event: "maturity",
    label: "Full Maturity",
  });

  return points;
}
