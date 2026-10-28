import { describe, expect, it } from "@jest/globals";
import {
  bridgeReducer,
  INITIAL_BRIDGE_STATE,
  type BridgeAction,
} from "../bridgeMachine";
import type { BridgeMachineState } from "../types";

const transaction = {
  id: "tx-1",
  nonce: "42",
  amount: "10.00",
  asset: "USDC",
  direction: "stellar-to-evm" as const,
  mode: "lock-and-mint" as const,
};

function apply(state: BridgeMachineState, action: BridgeAction): BridgeMachineState {
  const result = bridgeReducer(state, action);
  expect(result.error).toBeNull();
  return result.state;
}

function reachProof(state = INITIAL_BRIDGE_STATE): BridgeMachineState {
  let current = apply(state, { type: "start", transaction });
  current = apply(current, { type: "advance" });
  return apply(current, { type: "advance" });
}

describe("bridgeReducer", () => {
  it("accepts every happy-path transition for lock-and-mint and burn-and-unlock", () => {
    let lockState = apply(INITIAL_BRIDGE_STATE, { type: "start", transaction });
    expect(lockState.phase).toBe("source_locked");
    lockState = apply(lockState, { type: "advance" });
    expect(lockState.phase).toBe("relayer_proof_pending");
    lockState = apply(lockState, { type: "advance" });
    expect(lockState.phase).toBe("proof_generated");
    lockState = apply(lockState, { type: "advance" });
    expect(lockState.phase).toBe("destination_minted");
    lockState = apply(lockState, { type: "advance" });
    expect(lockState.phase).toBe("completed");
    expect(lockState.consumedNonces).toEqual(["42"]);

    let unlockState = apply(INITIAL_BRIDGE_STATE, {
      type: "start",
      transaction: { ...transaction, mode: "burn-and-unlock", direction: "evm-to-stellar" },
    });
    unlockState = apply(unlockState, { type: "advance" });
    unlockState = apply(unlockState, { type: "advance" });
    unlockState = apply(unlockState, { type: "advance" });
    expect(unlockState.phase).toBe("unlocked");
    expect(unlockState.transaction?.sourceChain).toBe("EVM");
    expect(unlockState.transaction?.destinationChain).toBe("Stellar Soroban");
    expect(apply(unlockState, { type: "advance" }).phase).toBe("completed");
  });

  it("rejects invalid transitions without replacing state", () => {
    const result = bridgeReducer(INITIAL_BRIDGE_STATE, { type: "advance" });
    expect(result.state).toBe(INITIAL_BRIDGE_STATE);
    expect(result.error).toMatch(/start a transaction/i);
    const activeState = reachProof();
    const secondStart = bridgeReducer(activeState, { type: "start", transaction });
    expect(secondStart.state).toBe(activeState);
    expect(secondStart.error).toMatch(/already in progress/i);
  });

  it("handles signature expiration before destination submission", () => {
    const withScenario = apply(reachProof(), { type: "set-scenario", scenario: "signature-expired" });
    const result = bridgeReducer(withScenario, { type: "advance" });
    expect(result.error).toBeNull();
    expect(result.state.phase).toBe("failed_signature_expired");
  });

  it("handles relayer timeout and supports a retry", () => {
    let state = apply(INITIAL_BRIDGE_STATE, { type: "start", transaction });
    state = apply(state, { type: "advance" });
    state = apply(state, { type: "set-scenario", scenario: "relayer-timeout" });
    const failed = bridgeReducer(state, { type: "fail", reason: "relayer-timeout" });
    expect(failed.state.phase).toBe("failed_relayer_timeout");
    const retried = bridgeReducer(failed.state, { type: "retry" });
    expect(retried.state.phase).toBe("relayer_proof_pending");
    expect(retried.state.failureScenario).toBeNull();
  });

  it("rejects a consumed nonce on its second destination submission", () => {
    let state = reachProof();
    state = apply(state, { type: "advance" });
    state = apply(state, { type: "advance" });
    state = apply(state, { type: "start", transaction: { ...transaction, id: "tx-2" } });
    state = apply(state, { type: "advance" });
    state = apply(state, { type: "advance" });
    const replay = bridgeReducer(state, { type: "advance" });
    expect(replay.state.phase).toBe("failed_replay_detected");
    expect(replay.state.consumedNonces).toEqual(["42"]);
  });
});