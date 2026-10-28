import type {
  BridgeDirection,
  BridgeMachineState,
  BridgePhase,
  BridgeStep,
  BridgeTransaction,
  BridgeTransactionInput,
  Chain,
  FailureScenario,
} from "./types";

export type BridgeAction =
  | { type: "start"; transaction: BridgeTransactionInput }
  | { type: "advance" }
  | { type: "fail"; reason: Exclude<FailureScenario, "replay-attack"> }
  | { type: "set-scenario"; scenario: FailureScenario | null }
  | { type: "set-speed"; speed: 1 | 2 | 5 }
  | { type: "tick"; elapsedMs: number }
  | { type: "pause"; paused: boolean }
  | { type: "retry" }
  | { type: "reset" };

export interface BridgeTransitionResult {
  state: BridgeMachineState;
  error: string | null;
}

export const INITIAL_BRIDGE_STATE: BridgeMachineState = {
  phase: "idle",
  transaction: null,
  consumedNonces: [],
  clockMs: 0,
  speed: 1,
  paused: false,
  failureScenario: null,
};

const ALLOWED_TRANSITIONS: Partial<Record<BridgePhase, readonly BridgePhase[]>> = {
  idle: ["source_locked"],
  source_locked: ["relayer_proof_pending"],
  relayer_proof_pending: ["proof_generated", "failed_relayer_timeout"],
  proof_generated: [
    "destination_minted",
    "unlocked",
    "failed_signature_expired",
    "failed_replay_detected",
  ],
  destination_minted: ["completed"],
  unlocked: ["completed"],
  failed_relayer_timeout: ["relayer_proof_pending"],
};

const FAILURE_PHASES: Record<Exclude<FailureScenario, "replay-attack">, BridgePhase> = {
  "signature-expired": "failed_signature_expired",
  "relayer-timeout": "failed_relayer_timeout",
};

function chainPair(direction: BridgeDirection): { source: Chain; destination: Chain } {
  switch (direction) {
    case "stellar-to-evm":
      return { source: "Stellar Soroban", destination: "EVM" };
    case "stellar-to-cosmos":
      return { source: "Stellar Soroban", destination: "Cosmos" };
    case "evm-to-stellar":
      return { source: "EVM", destination: "Stellar Soroban" };
    case "cosmos-to-stellar":
      return { source: "Cosmos", destination: "Stellar Soroban" };
  }
}

function isFailurePhase(phase: BridgePhase): boolean {
  return phase.startsWith("failed_");
}

function invalid(state: BridgeMachineState, error: string): BridgeTransitionResult {
  return { state, error };
}

function moveToPhase(
  state: BridgeMachineState,
  phase: BridgeStep,
  message: string,
): BridgeMachineState {
  if (!state.transaction) return state;
  const timestamp = state.clockMs;
  const entry = { phase, timestamp, message };
  return {
    ...state,
    phase,
    transaction: {
      ...state.transaction,
      timestamps: { ...state.transaction.timestamps, [phase]: timestamp },
      history: [...state.transaction.history, entry],
    },
  };
}

function moveToFailure(
  state: BridgeMachineState,
  phase: BridgePhase,
  message: string,
): BridgeMachineState {
  return moveToPhase(state, phase as BridgeStep, message);
}

function canTransition(from: BridgePhase, to: BridgePhase): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

function assertTransition(
  state: BridgeMachineState,
  next: BridgePhase,
): BridgeTransitionResult | null {
  return canTransition(state.phase, next)
    ? null
    : invalid(state, `Transition ${state.phase} -> ${next} is not allowed.`);
}

export function bridgeReducer(
  state: BridgeMachineState,
  action: BridgeAction,
): BridgeTransitionResult {
  switch (action.type) {
    case "start": {
      if (
        state.phase !== "idle" &&
        state.phase !== "completed" &&
        !isFailurePhase(state.phase)
      ) {
        return invalid(state, "A bridge transaction is already in progress.");
      }
      const { source, destination } = chainPair(action.transaction.direction);
      const nextState: BridgeMachineState = {
        ...state,
        phase: "idle",
        transaction: {
          ...action.transaction,
          sourceChain: source,
          destinationChain: destination,
          createdAt: 0,
          timestamps: {},
          history: [],
        },
        clockMs: 0,
        paused: false,
      };
      const transitionError = assertTransition(nextState, "source_locked");
      if (transitionError) return transitionError;
      return {
        state: moveToPhase(nextState, "source_locked", "Source asset locked."),
        error: null,
      };
    }
    case "advance": {
      if (!state.transaction) return invalid(state, "Start a transaction first.");
      if (state.phase === "source_locked") {
        return {
          state: moveToPhase(state, "relayer_proof_pending", "Relayer is collecting confirmations."),
          error: null,
        };
      }
      if (state.phase === "relayer_proof_pending") {
        return {
          state: moveToPhase(state, "proof_generated", "Relayer proof generated."),
          error: null,
        };
      }
      if (state.phase === "proof_generated") {
        if (state.failureScenario === "signature-expired") {
          return bridgeReducer(state, { type: "fail", reason: "signature-expired" });
        }
        if (state.consumedNonces.includes(state.transaction.nonce)) {
          const next = "failed_replay_detected";
          const transitionError = assertTransition(state, next);
          if (transitionError) return transitionError;
          return {
            state: moveToFailure(
              state,
              next,
              `Nonce ${state.transaction.nonce} was already consumed by a completed bridge transfer.`,
            ),
            error: null,
          };
        }
        const destinationPhase =
          state.transaction.mode === "lock-and-mint"
            ? "destination_minted"
            : "unlocked";
        const transitionError = assertTransition(state, destinationPhase);
        if (transitionError) return transitionError;
        const moved = moveToPhase(
          state,
          destinationPhase,
          destinationPhase === "unlocked"
            ? "Destination burned; source asset unlocked."
            : "Wrapped asset minted on the destination chain.",
        );
        return {
          state: {
            ...moved,
            consumedNonces: [...moved.consumedNonces, state.transaction.nonce],
          },
          error: null,
        };
      }
      if (state.phase === "destination_minted" || state.phase === "unlocked") {
        const transitionError = assertTransition(state, "completed");
        if (transitionError) return transitionError;
        return {
          state: moveToPhase(state, "completed", "Bridge transfer completed."),
          error: null,
        };
      }
      return invalid(state, `Cannot advance a transaction in ${state.phase}.`);
    }
    case "fail": {
      const phase = FAILURE_PHASES[action.reason];
      if (action.reason === "signature-expired" && state.phase !== "proof_generated") {
        return invalid(state, "Signature expiration can only occur before destination submission.");
      }
      if (action.reason === "relayer-timeout" && state.phase !== "relayer_proof_pending") {
        return invalid(state, "Relayer timeout can only occur while waiting for a proof.");
      }
      const transitionError = assertTransition(state, phase);
      if (transitionError) return transitionError;
      const message =
        action.reason === "signature-expired"
          ? "Relayer signature TTL elapsed before destination submission."
          : "Relayer did not respond before the timeout window elapsed.";
      return { state: moveToFailure(state, phase, message), error: null };
    }
    case "set-scenario":
      return { state: { ...state, failureScenario: action.scenario }, error: null };
    case "set-speed":
      return { state: { ...state, speed: action.speed }, error: null };
    case "tick": {
      if (!Number.isFinite(action.elapsedMs) || action.elapsedMs < 0) {
        return invalid(state, "Elapsed time must be a non-negative finite number.");
      }
      if (state.paused || state.phase === "idle" || state.phase === "completed" || isFailurePhase(state.phase)) {
        return { state, error: null };
      }
      const clockMs = state.clockMs + action.elapsedMs * state.speed;
      const clockState = { ...state, clockMs };
      const stepStartedAt = state.transaction?.timestamps[state.phase as BridgeStep];
      const elapsedInStep = stepStartedAt === undefined ? 0 : clockMs - stepStartedAt;

      if (state.phase === "source_locked" && elapsedInStep >= 2_000) {
        return {
          state: moveToPhase(clockState, "relayer_proof_pending", "Relayer is collecting confirmations."),
          error: null,
        };
      }
      if (state.phase === "relayer_proof_pending" && elapsedInStep >= 3_500) {
        if (state.failureScenario === "relayer-timeout") {
          return bridgeReducer(clockState, { type: "fail", reason: "relayer-timeout" });
        }
        return {
          state: moveToPhase(clockState, "proof_generated", "Relayer proof generated."),
          error: null,
        };
      }
      if (state.phase === "proof_generated" && elapsedInStep >= 1_500) {
        if (state.failureScenario === "signature-expired") {
          return bridgeReducer(clockState, { type: "fail", reason: "signature-expired" });
        }
        if (state.transaction && state.consumedNonces.includes(state.transaction.nonce)) {
          return {
            state: moveToFailure(
              clockState,
              "failed_replay_detected",
              `Nonce ${state.transaction.nonce} was already consumed by a completed bridge transfer.`,
            ),
            error: null,
          };
        }
        if (!state.transaction) return invalid(state, "Start a transaction first.");
        const destinationPhase = state.transaction.mode === "lock-and-mint" ? "destination_minted" : "unlocked";
        const moved = moveToPhase(
          clockState,
          destinationPhase,
          destinationPhase === "unlocked"
            ? "Destination burned; source asset unlocked."
            : "Wrapped asset minted on the destination chain.",
        );
        return {
          state: { ...moved, consumedNonces: [...moved.consumedNonces, state.transaction.nonce] },
          error: null,
        };
      }
      if ((state.phase === "destination_minted" || state.phase === "unlocked") && elapsedInStep >= 1_500) {
        return {
          state: moveToPhase(clockState, "completed", "Bridge transfer completed."),
          error: null,
        };
      }
      return { state: clockState, error: null };
    }
    case "pause":
      return { state: { ...state, paused: action.paused }, error: null };
    case "retry": {
      if (state.phase !== "failed_relayer_timeout") {
        return invalid(state, "Only a relayer timeout can be retried.");
      }
      const transitionError = assertTransition(state, "relayer_proof_pending");
      if (transitionError) return transitionError;
      return {
        state: {
          ...moveToPhase(state, "relayer_proof_pending", "Relayer retry started."),
          failureScenario: null,
        },
        error: null,
      };
    }
    case "reset":
      return {
        state: {
          ...INITIAL_BRIDGE_STATE,
          consumedNonces: state.consumedNonces,
          speed: state.speed,
        },
        error: null,
      };
  }
}

export function createBridgeTransaction(
  transaction: BridgeTransactionInput,
): BridgeTransaction {
  const chains = chainPair(transaction.direction);
  return {
    ...transaction,
    ...{ sourceChain: chains.source, destinationChain: chains.destination },
    createdAt: 0,
    timestamps: {},
    history: [],
  };
}

export function allowedNextPhases(phase: BridgePhase): readonly BridgePhase[] {
  return ALLOWED_TRANSITIONS[phase] ?? [];
}