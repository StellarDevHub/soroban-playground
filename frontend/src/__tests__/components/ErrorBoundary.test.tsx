import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary, createDiagnosticLog, describeUnknownError } from '../../components/ErrorBoundary';
import { toastManager } from '../../lib/toastManager';

jest.mock('../../lib/toastManager', () => ({
  toastManager: { show: jest.fn(), dismiss: jest.fn() },
}));

const ProblemChild = ({ shouldThrow = false }: { shouldThrow?: boolean }) => {
  if (shouldThrow) throw new Error('Test crash in child component');
  return <div>Healthy Component</div>;
};

describe('ErrorBoundary', () => {
  const originalError = console.error;
  beforeEach(() => {
    console.error = jest.fn();
    jest.clearAllMocks();
  });
  afterAll(() => {
    console.error = originalError;
  });

  it('renders children normally without logging or notifying', () => {
    render(<ErrorBoundary><ProblemChild /></ErrorBoundary>);
    expect(screen.getByText('Healthy Component')).toBeInTheDocument();
    expect(toastManager.show).not.toHaveBeenCalled();
  });

  it('isolates a child render failure and records structured diagnostics', () => {
    const onLogError = jest.fn();
    render(<ErrorBoundary onLogError={onLogError}><ProblemChild shouldThrow /></ErrorBoundary>);

    expect(screen.getByRole('alert')).toHaveTextContent('Test crash in child component');
    expect(onLogError).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Test crash in child component',
      name: 'Error',
      level: 'global',
      timestamp: expect.any(String),
    }));
    expect(toastManager.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', priority: 'high' }));
  });

  it('recovers after the child stops throwing', () => {
    function Harness() {
      const [throwing, setThrowing] = useState(true);
      return <>
        <button onClick={() => setThrowing(false)}>Stop throwing</button>
        <ErrorBoundary><ProblemChild shouldThrow={throwing} /></ErrorBoundary>
      </>;
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop throwing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(screen.getByText('Healthy Component')).toBeInTheDocument();
  });

  it('provides a one-click Recover Workspace button that invokes onRecoverWorkspace', () => {
    const onRecoverWorkspace = jest.fn();
    render(
      <ErrorBoundary onRecoverWorkspace={onRecoverWorkspace} componentName="Monaco Editor">
        <ProblemChild shouldThrow />
      </ErrorBoundary>,
    );

    const recoverBtn = screen.getByTestId('recover-workspace-btn');
    expect(recoverBtn).toBeInTheDocument();
    expect(recoverBtn).toHaveTextContent('Recover Workspace');

    fireEvent.click(recoverBtn);
    expect(onRecoverWorkspace).toHaveBeenCalledTimes(1);
    expect(toastManager.show).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Workspace Recovered',
      type: 'success',
    }));
  });

  it('recovers workspace buffers from localStorage when onRecoverWorkspace is not provided', () => {
    localStorage.setItem('soroban_editor_code', 'fn test_restored() {}');
    const recoverListener = jest.fn();
    window.addEventListener('soroban:recover-workspace', recoverListener);

    render(
      <ErrorBoundary storageBackupKey="soroban_editor_code" componentName="Monaco Editor">
        <ProblemChild shouldThrow />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByTestId('recover-workspace-btn'));
    expect(recoverListener).toHaveBeenCalled();
    expect(toastManager.show).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Workspace Recovered',
      type: 'success',
    }));

    window.removeEventListener('soroban:recover-workspace', recoverListener);
    localStorage.removeItem('soroban_editor_code');
  });

  it('renders granular widget titles and component badges', () => {
    render(
      <ErrorBoundary level="widget" componentName="Interactive Visualizer">
        <ProblemChild shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Interactive Visualizer Crashed');
    expect(screen.getByText('Interactive Visualizer')).toBeInTheDocument();
  });

  it('renders a supplied fallback without exposing diagnostic controls', () => {
    render(<ErrorBoundary fallback={<div>Safe fallback</div>}><ProblemChild shouldThrow /></ErrorBoundary>);
    expect(screen.getByText('Safe fallback')).toBeInTheDocument();
    expect(screen.queryByText('Export Crash Diagnostics')).not.toBeInTheDocument();
  });

  it('exports diagnostics as a JSON download when requested', () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const createObjectURL = jest.fn(() => 'blob:test');
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<ErrorBoundary><ProblemChild shouldThrow /></ErrorBoundary>);
    fireEvent.click(screen.getByRole('button', { name: 'Export Crash Diagnostics' }));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreate });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevoke });
    click.mockRestore();
  });
});

describe('ErrorBoundary diagnostics', () => {
  it('normalizes unknown and Soroban-style thrown values without leaking secrets', () => {
    expect(describeUnknownError('rpc failed')).toMatchObject({ name: 'ThrownValue', message: 'rpc failed' });
    const described = describeUnknownError({ name: 'RpcError', message: 'simulation failed', token: 'secret-token', result: { code: -1 } });
    expect(described).toMatchObject({ name: 'RpcError', message: 'simulation failed' });
    expect(described.details).not.toHaveProperty('token');
  });

  it('sanitizes user file system paths and stellar secrets in stack traces', () => {
    const errorWithStack = new Error('Engine crash');
    errorWithStack.stack = 'Error: Engine crash\n at /home/developer_bob/projects/soroban/contract.rs:42:10\n at /Users/alice/repo/index.ts:15:4\n secret: SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const log = createDiagnosticLog(errorWithStack, null, 'global', 'ContractEngine');

    expect(log.stack).toContain('/home/[ANONYMIZED_USER]/projects/soroban/contract.rs:42:10');
    expect(log.stack).toContain('/Users/[ANONYMIZED_USER]/repo/index.ts:15:4');
    expect(log.stack).toContain('[REDACTED_STELLAR_SECRET]');
    expect(log.stack).not.toContain('developer_bob');
    expect(log.stack).not.toContain('alice');
    expect(log.anonymized).toBe(true);
  });

  it('includes component context and strips query data from exported URLs', () => {
    window.history.pushState({}, '', '/playground?access_token=secret#details');
    const log = createDiagnosticLog(new Error('boom'), { componentStack: '\n at SimulationPanel' } as React.ErrorInfo, 'widget', new Date('2026-01-02T03:04:05.000Z'));
    expect(log).toMatchObject({ error: 'boom', componentStack: '\n at SimulationPanel', level: 'widget', timestamp: '2026-01-02T03:04:05.000Z', url: expect.stringContaining('/playground') });
    expect(log.url).not.toContain('access_token');
    expect(log.url).not.toContain('details');
  });
});
