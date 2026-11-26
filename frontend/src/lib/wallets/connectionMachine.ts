/**
 * Wallet connection finite state machine (#2035).
 *
 *   DISCONNECTED ──CONNECT──▶ CONNECTING ──CONNECTED──▶ CONNECTED
 *        ▲                        │                       │  ▲
 *        │                      FAIL                SIGN_START │ SIGN_DONE / SIGN_FAIL
 *        │                        ▼                       ▼  │
 *        └──────DISCONNECT──── ERROR ◀──────FAIL────── SIGNING
 *
 * Every state accepts DISCONNECT, which always lands on DISCONNECTED, and
 * CONNECT is accepted everywhere except SIGNING (a new attempt supersedes
 * one in flight, and switching wallets starts from CONNECTED). Any other event that does not belong to the current state is
 * ignored rather than applied, so a late promise from an abandoned attempt
 * (a wallet that answers after the user switched to another one) can never
 * move the provider into a state it is not in.
 *
 * The machine is pure: no React, no timers, no storage. WalletProvider
 * drives it through useReducer, which keeps the transitions testable on
 * their own.
 */

export type WalletConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "SIGNING"
  | "ERROR";

/** Why the machine is in ERROR. `unavailable` means the wallet is not installed. */
export type WalletErrorKind = "failed" | "unavailable" | "rejected" | "timeout";

export type WalletConnectionEvent =
  | { type: "CONNECT" }
  | { type: "CONNECTED" }
  | { type: "FAIL"; kind?: WalletErrorKind }
  | { type: "SIGN_START" }
  | { type: "SIGN_DONE" }
  | { type: "SIGN_FAIL" }
  | { type: "DISCONNECT" };

export interface WalletMachineState {
  state: WalletConnectionState;
  errorKind: WalletErrorKind | null;
}

export const INITIAL_WALLET_MACHINE_STATE: WalletMachineState = {
  state: "DISCONNECTED",
  errorKind: null,
};

const TRANSITIONS: Record<
  WalletConnectionState,
  Partial<Record<WalletConnectionEvent["type"], WalletConnectionState>>
> = {
  DISCONNECTED: { CONNECT: "CONNECTING", DISCONNECT: "DISCONNECTED" },
  CONNECTING: {
    // A new attempt (the user picked another wallet) supersedes the old one.
    CONNECT: "CONNECTING",
    CONNECTED: "CONNECTED",
    FAIL: "ERROR",
    DISCONNECT: "DISCONNECTED",
  },
  CONNECTED: {
    SIGN_START: "SIGNING",
    CONNECT: "CONNECTING",
    FAIL: "ERROR",
    DISCONNECT: "DISCONNECTED",
  },
  SIGNING: {
    SIGN_DONE: "CONNECTED",
    // A rejected or failed signature leaves the session usable.
    SIGN_FAIL: "CONNECTED",
    // A failure that breaks the session (a Ledger timeout, a rotated account).
    FAIL: "ERROR",
    DISCONNECT: "DISCONNECTED",
  },
  ERROR: { CONNECT: "CONNECTING", DISCONNECT: "DISCONNECTED" },
};

/** The state `event` leads to from `current`, or `null` if it is not allowed there. */
export function nextWalletState(
  current: WalletConnectionState,
  event: WalletConnectionEvent["type"],
): WalletConnectionState | null {
  return TRANSITIONS[current][event] ?? null;
}

export function canTransition(
  current: WalletConnectionState,
  event: WalletConnectionEvent["type"],
): boolean {
  return nextWalletState(current, event) !== null;
}

/** Reducer for useReducer. Disallowed events return the same object. */
export function walletConnectionReducer(
  current: WalletMachineState,
  event: WalletConnectionEvent,
): WalletMachineState {
  const next = nextWalletState(current.state, event.type);
  if (next === null) return current;
  const errorKind =
    next === "ERROR" ? (event.type === "FAIL" ? event.kind ?? "failed" : "failed") : null;
  if (next === current.state && errorKind === current.errorKind) return current;
  return { state: next, errorKind };
}

/**
 * The status string WalletProvider exposed before the machine existed, kept
 * so existing consumers keep working. SIGNING is still a connected session.
 */
export type LegacyConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "unavailable";

export function toLegacyStatus(machine: WalletMachineState): LegacyConnectionStatus {
  switch (machine.state) {
    case "DISCONNECTED":
      return "idle";
    case "CONNECTING":
      return "connecting";
    case "CONNECTED":
    case "SIGNING":
      return "connected";
    case "ERROR":
      return machine.errorKind === "unavailable" ? "unavailable" : "error";
  }
}

/** True for the user cancelling in the wallet, across the wallets we support. */
export function isUserRejection(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? String((error as { message?: unknown }).message ?? "")
          : "";
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  // -4 is the Stellar Wallets Kit / Freighter "user declined" code and 0x6985
  // is the Ledger "conditions of use not satisfied" status for a denied prompt.
  if (code === -4 || code === 0x6985 || code === 27013) return true;
  return /reject|declin|denied|cancel/i.test(message);
}
