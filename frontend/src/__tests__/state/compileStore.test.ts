import { useCompileStore } from '../../state/compileStore';

describe('useCompileStore', () => {
  beforeEach(() => {
    useCompileStore.getState().reset();
  });

  it('should initialize with default values', () => {
    const state = useCompileStore.getState();
    expect(state.isCompiling).toBe(false);
    expect(state.status).toBe('idle');
    expect(state.message).toBe('');
    expect(state.progress).toBe(0);
    expect(state.activeWorkers).toBe(0);
    expect(state.queueLength).toBe(0);
  });

  it('should handle startCompile', () => {
    useCompileStore.getState().startCompile();
    const state = useCompileStore.getState();
    expect(state.isCompiling).toBe(true);
    expect(state.status).toBe('queued');
    expect(state.message).toBe('Queuing compilation...');
    expect(state.progress).toBe(0);
  });

  it('should handle updateProgress', () => {
    useCompileStore.getState().updateProgress({
      status: 'building',
      message: 'Compiling files...',
      progress: 45,
      queueLength: 2,
      activeWorkers: 3,
    });

    const state = useCompileStore.getState();
    expect(state.status).toBe('compiling');
    expect(state.message).toBe('Compiling files...');
    expect(state.progress).toBe(45);
    expect(state.queueLength).toBe(2);
    expect(state.activeWorkers).toBe(3);
  });

  it('should handle successCompile', () => {
    useCompileStore.getState().successCompile('Build complete!');
    const state = useCompileStore.getState();
    expect(state.isCompiling).toBe(false);
    expect(state.status).toBe('success');
    expect(state.message).toBe('Build complete!');
    expect(state.progress).toBe(100);
  });

  it('should handle failCompile', () => {
    useCompileStore.getState().failCompile('Syntax error');
    const state = useCompileStore.getState();
    expect(state.isCompiling).toBe(false);
    expect(state.status).toBe('failed');
    expect(state.message).toBe('Syntax error');
    expect(state.progress).toBe(0);
  });
});
