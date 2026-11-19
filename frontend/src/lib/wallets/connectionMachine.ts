/**
 * Deterministic finite state machine for the wallet connection lifecycle.
 *
 * Canonical chain (FRONTEND-265):
 *   disconnected -> connecting -> connected -> signing -> error
 *
 * `unavailable` is kept as a UI-level override of the `error` state so that a
 * wallet which is not installed/detected can still be reported separately
 * without adding a non-deterministic branch to the machine itself.
 */

export const CONNECTION_STATES = [
  "disconnected",
  "connecting",
  "connected",
  "signing",
  "error",
] as const;

export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const CONNECTION_EVENTS = [
  "CONNECT_START",
  "CONNECT_SUCCESS",
  "CONNECT_UNAVAILABLE",
  "SIGN_START",
  "SIGN_SUCCESS",
  "FAILURE",
  "DISCONNECT",
] as const;

export type ConnectionEventType = (typeof CONNECTION_EVENTS)[number];

export const CONNECTION_TRANSITIONS: Readonly<
  Record<ConnectionState, Partial<Record<ConnectionEventType, ConnectionState>>>
> = {
  disconnected: {
    CONNECT_START: "connecting",
    DISCONNECT: "disconnected",
  },
  connecting: {
    CONNECT_SUCCESS: "connected",
    CONNECT_UNAVAILABLE: "error",
    FAILURE: "error",
    DISCONNECT: "disconnected",
  },
  connected: {
    CONNECT_START: "connecting",
    SIGN_START: "signing",
    DISCONNECT: "disconnected",
    FAILURE: "error",
  },
  signing: {
    SIGN_SUCCESS: "connected",
    FAILURE: "error",
    DISCONNECT: "disconnected",
  },
  error: {
    CONNECT_START: "connecting",
    DISCONNECT: "disconnected",
  },
};

export function canTransition(
  state: ConnectionState,
  event: ConnectionEventType,
): boolean {
  return CONNECTION_TRANSITIONS[state]?.[event] !== undefined;
}

/**
 * Apply an event. Invalid events are no-ops — they must never move the
 * machine into an undefined state or crash an async callback. Use
 * `transitionStrict` in tests that need to assert illegal transitions.
 */
export function transition(
  state: ConnectionState,
  event: ConnectionEventType,
): ConnectionState {
  return CONNECTION_TRANSITIONS[state]?.[event] ?? state;
}

export function transitionStrict(
  state: ConnectionState,
  event: ConnectionEventType,
): ConnectionState {
  if (!canTransition(state, event)) {
    throw new Error(`Invalid wallet connection transition: ${state} --${event}-->`);
  }
  return CONNECTION_TRANSITIONS[state][event] ?? state;
}

export interface ConnectionMachineState {
  state: ConnectionState;
  statusOverride: "unavailable" | null;
}

export const initialConnectionMachineState: ConnectionMachineState = {
  state: "disconnected",
  statusOverride: null,
};

export type ConnectionEvent =
  | { type: "CONNECT_START" }
  | { type: "CONNECT_SUCCESS" }
  | { type: "CONNECT_UNAVAILABLE" }
  | { type: "SIGN_START" }
  | { type: "SIGN_SUCCESS" }
  | { type: "FAILURE" }
  | { type: "DISCONNECT" };

export function connectionReducer(
  current: ConnectionMachineState,
  event: ConnectionEvent,
): ConnectionMachineState {
  const nextState = transition(current.state, event.type);
  const statusOverride =
    event.type === "CONNECT_UNAVAILABLE" && nextState === "error"
      ? "unavailable"
      : event.type === "CONNECT_START" ||
          event.type === "CONNECT_SUCCESS" ||
          event.type === "SIGN_START" ||
          event.type === "SIGN_SUCCESS" ||
          event.type === "DISCONNECT"
        ? null
        : current.statusOverride;

  if (nextState === current.state && statusOverride === current.statusOverride) {
    return current;
  }
  return { state: nextState, statusOverride };
}

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "signing"
  | "error"
  | "unavailable";

const STATE_TO_STATUS: Record<ConnectionState, ConnectionStatus> = {
  disconnected: "idle",
  connecting: "connecting",
  connected: "connected",
  signing: "signing",
  error: "error",
};

export function toConnectionStatus(
  machine: ConnectionMachineState,
): ConnectionStatus {
  return machine.statusOverride ?? STATE_TO_STATUS[machine.state];
}
