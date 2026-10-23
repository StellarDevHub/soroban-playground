import { create } from "zustand";
import {
  classifyError,
  truncateMessage,
  type CompileError,
  type CompileErrorType,
} from "@/utils/compileErrors";

export type { CompileErrorType, CompileError };

export interface CompileProgressState {
  isCompiling: boolean;
  status: "idle" | "queued" | "compiling" | "success" | "failed";
  message: string;
  progress: number;
  activeWorkers: number;
  maxWorkers: number;
  queueLength: number;
  estimatedWaitTimeMs: number;
  error: CompileError | null;
  startCompile: () => void;
  updateProgress: (payload: {
    status?: string;
    message?: string;
    progress?: number;
    activeWorkers?: number;
    maxWorkers?: number;
    queueLength?: number;
    estimatedWaitTimeMs?: number;
  }) => void;
  successCompile: (msg?: string) => void;
  failCompile: (errorMsg: string, errorType?: CompileErrorType) => void;
  reset: () => void;
  retryCompile: () => void;
}

export const selectIsCompiling = (state: CompileProgressState) =>
  state.isCompiling;
export const selectStatus = (state: CompileProgressState) => state.status;
export const selectProgress = (state: CompileProgressState) => state.progress;
export const selectError = (state: CompileProgressState) => state.error;

/**
 * Cross-component "please compile" signal (issue #1725).
 *
 * Compilation is owned by `PlaygroundClient` because it drives the Monaco
 * buffer, the deployment pre-flight state and the websocket log. The spotlight
 * palette lives in the root layout and therefore cannot call `handleCompile`
 * directly — it dispatches this DOM event instead and the playground listens.
 * Components that do not care about compiling never touch it.
 */
export const SPOTLIGHT_COMPILE_REQUEST_EVENT = "sp:spotlight-compile-request";

export function requestPlaygroundCompile(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SPOTLIGHT_COMPILE_REQUEST_EVENT));
}

/**
 * Same bridge for "deploy the last artifact" (issue #1725). Deployment needs
 * the playground's pre-flight plan, so the signal is honoured only when a
 * fresh plan exists — otherwise the playground logs the miss and does nothing.
 */
export const SPOTLIGHT_DEPLOY_REQUEST_EVENT = "sp:spotlight-deploy-request";

export function requestPlaygroundDeploy(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SPOTLIGHT_DEPLOY_REQUEST_EVENT));
}

export const useCompileStore = create<CompileProgressState>((set) => ({
  isCompiling: false,
  status: "idle",
  message: "",
  progress: 0,
  activeWorkers: 0,
  maxWorkers: 4,
  queueLength: 0,
  estimatedWaitTimeMs: 0,
  error: null,

  startCompile: () =>
    set({
      isCompiling: true,
      status: "queued",
      message: "Queuing compilation...",
      progress: 0,
      error: null,
    }),

  updateProgress: (payload) =>
    set((state) => {
      let mappedStatus = state.status;
      if (payload.status) {
        if (payload.status === "building" || payload.status === "compiling") {
          mappedStatus = "compiling";
        } else if (payload.status === "queued") {
          mappedStatus = "queued";
        }
      }

      return {
        status: mappedStatus,
        message: payload.message ?? state.message,
        progress: payload.progress ?? state.progress,
        activeWorkers: payload.activeWorkers ?? state.activeWorkers,
        maxWorkers: payload.maxWorkers ?? state.maxWorkers,
        queueLength: payload.queueLength ?? state.queueLength,
        estimatedWaitTimeMs:
          payload.estimatedWaitTimeMs ?? state.estimatedWaitTimeMs,
      };
    }),

  successCompile: (msg) =>
    set({
      isCompiling: false,
      status: "success",
      message: msg ?? "Compiled successfully.",
      progress: 100,
      error: null,
    }),

  failCompile: (errorMsg, errorType) =>
    set((state) => {
      const safeMsg = truncateMessage(
        errorMsg || "An unknown compilation error occurred.",
      );
      const classified = errorType
        ? { type: errorType, retryable: errorType !== "compilation" }
        : classifyError(safeMsg);
      return {
        isCompiling: false,
        status: "failed",
        message: safeMsg,
        progress: state.progress > 0 ? state.progress : 0,
        error: { message: safeMsg, ...classified },
      };
    }),

  reset: () =>
    set({
      isCompiling: false,
      status: "idle",
      message: "",
      progress: 0,
      activeWorkers: 0,
      maxWorkers: 4,
      queueLength: 0,
      estimatedWaitTimeMs: 0,
      error: null,
    }),

  retryCompile: () =>
    set((state) => ({
      isCompiling: true,
      status: "queued",
      message: "Retrying compilation...",
      progress: state.progress > 0 ? state.progress : 0,
      error: null,
    })),
}));
