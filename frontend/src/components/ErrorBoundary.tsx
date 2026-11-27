'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { toastManager } from '../lib/toastManager';

const SENSITIVE_KEY = /(authorization|cookie|password|secret|private.?key|seed|token|mnemonic|signature|secret_key)/i;

export interface TelemetryLog {
  error: string;
  name?: string;
  stack?: string;
  componentStack?: string;
  details?: Record<string, unknown>;
  url?: string;
  timestamp: string;
  level: 'page' | 'widget' | 'global';
  componentName?: string;
  anonymized: boolean;
}

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  level?: 'page' | 'widget' | 'global';
  componentName?: string;
  storageBackupKey?: string;
  onReset?: () => void;
  onLogError?: (log: TelemetryLog) => void;
  onRecoverWorkspace?: () => void;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  recovered: boolean;
}

export function sanitizeStackTrace(stack?: string): string | undefined {
  if (!stack) return undefined;
  return stack
    .replace(/\/home\/[a-zA-Z0-9_.-]+/g, '/home/[ANONYMIZED_USER]')
    .replace(/\/Users\/[a-zA-Z0-9_.-]+/g, '/Users/[ANONYMIZED_USER]')
    .replace(/[a-zA-Z]:\\[Uu]sers\\[a-zA-Z0-9_.-]+/g, 'C:\\Users\\[ANONYMIZED_USER]')
    .replace(/([?&](?:access_token|token|key|secret|password|auth|signature)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/S[A-Z0-9]{55}/g, '[REDACTED_STELLAR_SECRET]')
    .replace(/G[A-Z0-9]{55}/g, '[ANONYMIZED_STELLAR_PUBKEY]');
}

export function sanitizeComponentStack(componentStack?: string): string | undefined {
  if (!componentStack) return undefined;
  return sanitizeStackTrace(componentStack);
}

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 3 || value === null || typeof value === 'undefined') return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'string') {
      return sanitizeStackTrace(value);
    }
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeValue(item, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (!SENSITIVE_KEY.test(key)) result[key] = safeValue(item, depth + 1);
    }
    return result;
  }
  return sanitizeStackTrace(String(value));
}

export function describeUnknownError(error: unknown): {
  name: string;
  message: string;
  stack?: string;
  details?: Record<string, unknown>;
} {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || 'Unknown runtime exception',
      stack: sanitizeStackTrace(error.stack),
      details: safeValue(error) as Record<string, unknown> | undefined,
    };
  }

  if (typeof error === 'string') {
    return { name: 'ThrownValue', message: sanitizeStackTrace(error) || 'Unknown runtime exception' };
  }
  if (error && typeof error === 'object') {
    const details = safeValue(error) as Record<string, unknown>;
    const candidate = details.message;
    return {
      name: typeof details.name === 'string' ? details.name : 'ThrownObject',
      message: typeof candidate === 'string' ? candidate : JSON.stringify(details) || 'Unknown runtime exception',
      stack: sanitizeStackTrace(typeof details.stack === 'string' ? details.stack : undefined),
      details,
    };
  }
  return { name: 'ThrownValue', message: sanitizeStackTrace(String(error)) || 'Unknown runtime exception' };
}

function safeUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

export function createDiagnosticLog(
  error: unknown,
  errorInfo: ErrorInfo | null,
  level: ErrorBoundaryProps['level'] = 'global',
  componentNameOrNow?: string | Date,
  now: Date = new Date(),
): TelemetryLog {
  const componentName = typeof componentNameOrNow === 'string' ? componentNameOrNow : undefined;
  const timestampDate = componentNameOrNow instanceof Date ? componentNameOrNow : now;
  const described = describeUnknownError(error);
  return {
    error: described.message,
    name: described.name,
    stack: sanitizeStackTrace(described.stack),
    componentStack: sanitizeComponentStack(errorInfo?.componentStack || undefined),
    details: described.details,
    url: safeUrl(),
    timestamp: timestampDate.toISOString(),
    level: level || 'global',
    componentName,
    anonymized: true,
  };
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false, error: null, errorInfo: null, recovered: false };
  private handledErrorKey: string | null = null;

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error, recovered: false };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const log = createDiagnosticLog(error, errorInfo, this.props.level, this.props.componentName);
    this.setState({ errorInfo });

    const errorKey = `${log.name}:${log.error}:${log.stack || ''}:${log.componentStack || ''}`;
    if (this.handledErrorKey === errorKey) return;
    this.handledErrorKey = errorKey;

    try {
      this.props.onLogError?.(log);
      if (!this.props.onLogError) console.error('[ErrorBoundary Telemetry]', log);
    } catch (loggingError) {
      console.error('[ErrorBoundary Telemetry Failure]', loggingError);
    }

    try {
      toastManager.show({
        title: this.props.componentName ? `${this.props.componentName} encountered an error` : 'Something went wrong',
        message: log.error,
        type: 'error',
        priority: 'high',
        groupId: `error-boundary:${errorKey}`,
      });
    } catch (toastError) {
      console.error('[ErrorBoundary Toast Failure]', toastError);
    }
  }

  public handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null, recovered: false });
    this.props.onReset?.();
  };

  public handleReloadSession = (): void => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  public handleRecoverWorkspace = (): void => {
    let recovered = false;
    try {
      if (this.props.onRecoverWorkspace) {
        this.props.onRecoverWorkspace();
        recovered = true;
      } else if (typeof window !== 'undefined' && window.localStorage) {
        const backupKeys = [
          this.props.storageBackupKey,
          'soroban_editor_code',
          'soroban_workspace_backup',
          'soroban_code_backup',
          'soroban_editor_content',
          'soroban-playground-code',
          'soroban_workspace_snapshot',
        ].filter(Boolean) as string[];

        for (const key of backupKeys) {
          const stored = localStorage.getItem(key);
          if (stored) {
            window.dispatchEvent(
              new CustomEvent('soroban:recover-workspace', {
                detail: { key, data: stored },
              }),
            );
            recovered = true;
            break;
          }
        }
      }
    } catch (err) {
      console.error('[ErrorBoundary Recovery Failure]', err);
    }

    this.setState({ hasError: false, error: null, errorInfo: null, recovered: true });
    this.props.onReset?.();

    try {
      toastManager.show({
        title: recovered ? 'Workspace Recovered' : 'Workspace Reset',
        message: recovered
          ? 'Workspace code buffers restored from local backup cache.'
          : 'Workspace state reset to last clean checkpoint.',
        type: 'success',
        priority: 'medium',
      });
    } catch {
      // Toast failure fallback
    }
  };

  public handleExportDiagnostics = (): void => {
    if (typeof window === 'undefined') return;
    const diagnostics = createDiagnosticLog(
      this.state.error,
      this.state.errorInfo,
      this.props.level,
      this.props.componentName,
    );
    const blob = new Blob([JSON.stringify(diagnostics, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `crash-report-${diagnostics.timestamp.replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  public render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const isWidget = this.props.level === 'widget';
    const componentTitle = this.props.componentName || (isWidget ? 'Widget Component' : 'Application');

    return (
      <div
        role="alert"
        aria-label={`${componentTitle} crash alert`}
        className={`p-6 rounded-xl border border-red-500/30 bg-red-950/20 backdrop-blur-md shadow-2xl ${
          isWidget ? 'max-w-md my-2' : 'max-w-3xl mx-auto my-8'
        }`}
      >
        <div className="flex items-center justify-between gap-3 text-red-400 mb-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <h3 className="text-xl font-semibold tracking-wide">
              {isWidget ? `${componentTitle} Crashed` : 'An Unexpected Error Occurred'}
            </h3>
          </div>
          {this.props.componentName && (
            <span className="text-xs px-2.5 py-1 rounded bg-red-900/40 border border-red-500/30 text-red-300 font-mono">
              {this.props.componentName}
            </span>
          )}
        </div>
        <p className="text-sm text-gray-300 mb-4 font-mono bg-black/40 p-3 rounded border border-gray-800 break-words">
          {this.state.error?.message || 'Unknown runtime exception'}
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button
            onClick={this.handleRecoverWorkspace}
            data-testid="recover-workspace-btn"
            className="px-4 py-2 text-sm font-medium rounded-lg bg-teal-600 hover:bg-teal-500 text-white transition-colors shadow-lg shadow-teal-900/30 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Recover Workspace
          </button>
          <button
            onClick={this.handleReset}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors"
          >
            Try Again
          </button>
          <button
            onClick={this.handleReloadSession}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 transition-colors"
          >
            Reload Session
          </button>
          <button
            onClick={this.handleExportDiagnostics}
            data-testid="export-diagnostics-btn"
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
          >
            Export Crash Diagnostics
          </button>
        </div>
      </div>
    );
  }
}
