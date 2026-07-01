import { create } from 'zustand';

export interface CompileProgressState {
  isCompiling: boolean;
  status: 'idle' | 'queued' | 'compiling' | 'success' | 'failed';
  message: string;
  progress: number;
  activeWorkers: number;
  maxWorkers: number;
  queueLength: number;
  estimatedWaitTimeMs: number;
  // Setters
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
  failCompile: (errorMsg: string) => void;
  reset: () => void;
}

export const useCompileStore = create<CompileProgressState>((set) => ({
  isCompiling: false,
  status: 'idle',
  message: '',
  progress: 0,
  activeWorkers: 0,
  maxWorkers: 4,
  queueLength: 0,
  estimatedWaitTimeMs: 0,

  startCompile: () => set({
    isCompiling: true,
    status: 'queued',
    message: 'Queuing compilation...',
    progress: 0,
  }),

  updateProgress: (payload) => set((state) => {
    let mappedStatus = state.status;
    if (payload.status) {
      if (payload.status === 'building' || payload.status === 'compiling') {
        mappedStatus = 'compiling';
      } else if (payload.status === 'queued') {
        mappedStatus = 'queued';
      }
    }

    return {
      status: mappedStatus,
      message: payload.message ?? state.message,
      progress: payload.progress ?? state.progress,
      activeWorkers: payload.activeWorkers ?? state.activeWorkers,
      maxWorkers: payload.maxWorkers ?? state.maxWorkers,
      queueLength: payload.queueLength ?? state.queueLength,
      estimatedWaitTimeMs: payload.estimatedWaitTimeMs ?? state.estimatedWaitTimeMs,
    };
  }),

  successCompile: (msg) => set({
    isCompiling: false,
    status: 'success',
    message: msg ?? 'Compiled successfully.',
    progress: 100,
  }),

  failCompile: (errorMsg) => set({
    isCompiling: false,
    status: 'failed',
    message: errorMsg,
    progress: 0,
  }),

  reset: () => set({
    isCompiling: false,
    status: 'idle',
    message: '',
    progress: 0,
    activeWorkers: 0,
    maxWorkers: 4,
    queueLength: 0,
    estimatedWaitTimeMs: 0,
  }),
}));
