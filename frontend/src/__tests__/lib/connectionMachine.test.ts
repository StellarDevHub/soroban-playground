import {
  CONNECTION_EVENTS,
  CONNECTION_STATES,
  CONNECTION_TRANSITIONS,
  canTransition,
  connectionReducer,
  initialConnectionMachineState,
  toConnectionStatus,
  transition,
  transitionStrict,
} from "@/lib/wallets/connectionMachine";

describe("wallet connection finite state machine (FRONTEND-265)", () => {
  it("declares the canonical five states and a transition for every event", () => {
    expect(CONNECTION_STATES).toEqual([
      "disconnected",
      "connecting",
      "connected",
      "signing",
      "error",
    ]);
    expect(CONNECTION_EVENTS).toEqual([
      "CONNECT_START",
      "CONNECT_SUCCESS",
      "CONNECT_UNAVAILABLE",
      "SIGN_START",
      "SIGN_SUCCESS",
      "FAILURE",
      "DISCONNECT",
    ]);
    for (const state of CONNECTION_STATES) {
      expect(CONNECTION_TRANSITIONS[state]).toBeDefined();
    }
  });

  it("follows the deterministic happy path", () => {
    let state = initialConnectionMachineState.state;
    state = transition(state, "CONNECT_START");
    expect(state).toBe("connecting");
    state = transition(state, "CONNECT_SUCCESS");
    expect(state).toBe("connected");
    state = transition(state, "SIGN_START");
    expect(state).toBe("signing");
    state = transition(state, "SIGN_SUCCESS");
    expect(state).toBe("connected");
    state = transition(state, "DISCONNECT");
    expect(state).toBe("disconnected");
  });

  it("routes connection and signing failures to ERROR and allows a retry", () => {
    const connecting = transition("disconnected", "CONNECT_START");
    expect(transition(connecting, "FAILURE")).toBe("error");
    expect(transition("error", "CONNECT_START")).toBe("connecting");

    expect(transition("connected", "SIGN_START")).toBe("signing");
    expect(transition("signing", "FAILURE")).toBe("error");
    expect(transition("signing", "DISCONNECT")).toBe("disconnected");
  });

  it("rejects illegal transitions as no-ops", () => {
    expect(canTransition("disconnected", "SIGN_START")).toBe(false);
    expect(transition("disconnected", "SIGN_START")).toBe("disconnected");
    expect(canTransition("connected", "CONNECT_SUCCESS")).toBe(false);
    expect(() => transitionStrict("disconnected", "SIGN_SUCCESS")).toThrow(
      "Invalid wallet connection transition",
    );
  });

  it("keeps UNAVAILABLE as a UI override of ERROR and clears it on reconnect", () => {
    let machine = connectionReducer(initialConnectionMachineState, {
      type: "CONNECT_START",
    });
    expect(machine.state).toBe("connecting");

    machine = connectionReducer(machine, { type: "CONNECT_UNAVAILABLE" });
    expect(machine.state).toBe("error");
    expect(machine.statusOverride).toBe("unavailable");
    expect(toConnectionStatus(machine)).toBe("unavailable");

    machine = connectionReducer(machine, { type: "CONNECT_START" });
    expect(machine.state).toBe("connecting");
    expect(toConnectionStatus(machine)).toBe("connecting");

    machine = connectionReducer(machine, { type: "FAILURE" });
    expect(toConnectionStatus(machine)).toBe("error");
  });

  it("maps each canonical state to a stable public status", () => {
    expect(
      toConnectionStatus({ state: "disconnected", statusOverride: null }),
    ).toBe("idle");
    expect(
      toConnectionStatus({ state: "connecting", statusOverride: null }),
    ).toBe("connecting");
    expect(
      toConnectionStatus({ state: "connected", statusOverride: null }),
    ).toBe("connected");
    expect(toConnectionStatus({ state: "signing", statusOverride: null })).toBe(
      "signing",
    );
    expect(toConnectionStatus({ state: "error", statusOverride: null })).toBe(
      "error",
    );
  });
});
