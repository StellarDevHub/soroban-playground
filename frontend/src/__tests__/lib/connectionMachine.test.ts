import {
  INITIAL_WALLET_MACHINE_STATE,
  canTransition,
  isUserRejection,
  nextWalletState,
  toLegacyStatus,
  walletConnectionReducer,
  type WalletConnectionEvent,
  type WalletConnectionState,
  type WalletMachineState,
} from "@/lib/wallets/connectionMachine";

function run(events: WalletConnectionEvent[]): WalletMachineState {
  return events.reduce(walletConnectionReducer, INITIAL_WALLET_MACHINE_STATE);
}

const ALL_STATES: WalletConnectionState[] = [
  "DISCONNECTED",
  "CONNECTING",
  "CONNECTED",
  "SIGNING",
  "ERROR",
];

describe("wallet connection state machine (#2035)", () => {
  it("follows DISCONNECTED -> CONNECTING -> CONNECTED -> SIGNING -> CONNECTED", () => {
    expect(INITIAL_WALLET_MACHINE_STATE.state).toBe("DISCONNECTED");
    expect(run([{ type: "CONNECT" }]).state).toBe("CONNECTING");
    expect(run([{ type: "CONNECT" }, { type: "CONNECTED" }]).state).toBe("CONNECTED");
    expect(
      run([{ type: "CONNECT" }, { type: "CONNECTED" }, { type: "SIGN_START" }]).state,
    ).toBe("SIGNING");
    expect(
      run([
        { type: "CONNECT" },
        { type: "CONNECTED" },
        { type: "SIGN_START" },
        { type: "SIGN_DONE" },
      ]).state,
    ).toBe("CONNECTED");
  });

  it("returns to CONNECTED when a signature is rejected", () => {
    const state = run([
      { type: "CONNECT" },
      { type: "CONNECTED" },
      { type: "SIGN_START" },
      { type: "SIGN_FAIL" },
    ]);
    expect(state).toEqual({ state: "CONNECTED", errorKind: null });
  });

  it("records why a connection failed", () => {
    expect(run([{ type: "CONNECT" }, { type: "FAIL", kind: "rejected" }])).toEqual({
      state: "ERROR",
      errorKind: "rejected",
    });
    expect(run([{ type: "CONNECT" }, { type: "FAIL" }])).toEqual({
      state: "ERROR",
      errorKind: "failed",
    });
  });

  it("can retry from ERROR", () => {
    const state = run([
      { type: "CONNECT" },
      { type: "FAIL", kind: "timeout" },
      { type: "CONNECT" },
      { type: "CONNECTED" },
    ]);
    expect(state).toEqual({ state: "CONNECTED", errorKind: null });
  });

  it("lets a new attempt supersede one in flight", () => {
    expect(nextWalletState("CONNECTING", "CONNECT")).toBe("CONNECTING");
    expect(nextWalletState("CONNECTED", "CONNECT")).toBe("CONNECTING");
  });

  it("blocks starting a connection while a signature is pending", () => {
    expect(canTransition("SIGNING", "CONNECT")).toBe(false);
  });

  it("ignores events that do not belong to the current state", () => {
    const disconnected = INITIAL_WALLET_MACHINE_STATE;
    // A late CONNECTED from an abandoned attempt must not connect anything.
    expect(walletConnectionReducer(disconnected, { type: "CONNECTED" })).toBe(disconnected);
    expect(walletConnectionReducer(disconnected, { type: "SIGN_START" })).toBe(disconnected);
    const connecting = run([{ type: "CONNECT" }]);
    expect(walletConnectionReducer(connecting, { type: "SIGN_START" })).toBe(connecting);
    const errored = run([{ type: "CONNECT" }, { type: "FAIL" }]);
    expect(walletConnectionReducer(errored, { type: "SIGN_DONE" })).toBe(errored);
  });

  it("disconnects from every state", () => {
    for (const state of ALL_STATES) {
      expect(nextWalletState(state, "DISCONNECT")).toBe("DISCONNECTED");
    }
    expect(
      walletConnectionReducer({ state: "ERROR", errorKind: "rejected" }, { type: "DISCONNECT" }),
    ).toEqual({ state: "DISCONNECTED", errorKind: null });
  });

  it("maps to the legacy status values", () => {
    expect(toLegacyStatus({ state: "DISCONNECTED", errorKind: null })).toBe("idle");
    expect(toLegacyStatus({ state: "CONNECTING", errorKind: null })).toBe("connecting");
    expect(toLegacyStatus({ state: "CONNECTED", errorKind: null })).toBe("connected");
    expect(toLegacyStatus({ state: "SIGNING", errorKind: null })).toBe("connected");
    expect(toLegacyStatus({ state: "ERROR", errorKind: "failed" })).toBe("error");
    expect(toLegacyStatus({ state: "ERROR", errorKind: "unavailable" })).toBe("unavailable");
  });
});

describe("isUserRejection", () => {
  it.each([
    [{ code: -4, message: "anything" }],
    [new Error("User declined access")],
    [new Error("Request rejected by user")],
    [new Error("Ledger device: Condition of use not satisfied (denied by the user?) (0x6985)")],
    ["The user cancelled the request"],
  ])("treats %p as a rejection", (error) => {
    expect(isUserRejection(error)).toBe(true);
  });

  it.each([[new Error("Network error")], [undefined], [{ code: 500 }]])(
    "does not treat %p as a rejection",
    (error) => {
      expect(isUserRejection(error)).toBe(false);
    },
  );
});
