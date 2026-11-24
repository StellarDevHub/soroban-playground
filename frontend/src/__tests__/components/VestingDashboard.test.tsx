import {
  claimableAmount,
  revokedAmount,
  vestedAmountAt,
} from "@/components/vestingSchedule";
import type { VestingScheduleData } from "@/components/vestingSchedule";

const linearSchedule: VestingScheduleData = {
  id: 1,
  beneficiary: "GABC",
  token: "CTOKEN",
  totalAmount: 1000,
  releasedAmount: 0,
  startTimestamp: 100,
  cliffTimestamp: 200,
  endTimestamp: 1200,
  vestingType: "Linear",
  milestones: [],
  revoked: false,
};

describe("vesting schedule calculations", () => {
  it("keeps all tokens locked at the cliff boundary", () => {
    expect(vestedAmountAt(linearSchedule, 199)).toBe(0);
    expect(vestedAmountAt(linearSchedule, 200)).toBe(0);
    expect(claimableAmount(linearSchedule, 200)).toBe(0);
  });

  it("calculates linear vesting exactly after the cliff", () => {
    expect(vestedAmountAt(linearSchedule, 450)).toBe(250);
    expect(vestedAmountAt(linearSchedule, 1200)).toBe(1000);
  });

  it("subtracts claimed tokens from the claimable balance", () => {
    expect(
      claimableAmount({ ...linearSchedule, releasedAmount: 125 }, 450),
    ).toBe(125);
  });

  it("stops vesting at the recorded revocation time", () => {
    const revokedSchedule = {
      ...linearSchedule,
      revoked: true,
      revokedTimestamp: 450,
    };

    expect(vestedAmountAt(revokedSchedule, 500)).toBe(250);
    expect(
      revokedAmount({
        ...revokedSchedule,
        releasedAmount: 250,
        revokedAmount: 750,
      }),
    ).toBe(750);
  });
});
