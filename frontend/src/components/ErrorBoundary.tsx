import React, { Component, ErrorInfo, ReactNode } from 'react';

export interface TelemetryLog {
  error: string;
  stack?: string;
  componentStack?: string;
  timestamp: string;
  level: 'page' | 'widget' | 'global';
}

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  level?: 'page' | 'widget' | 'global';
  onReset?: () => void;
  onLogError?: (log: TelemetryLog) => void;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    const log: TelemetryLog = {
      error: error.message || String(error),
      stack: error.stack,
      componentStack: errorInfo.componentStack || undefined,
      timestamp: new Date().toISOString(),
      level: this.props.level || 'global',
    };

    if (this.props.onLogError) {
      this.props.onLogError(log);
    } else {
      console.error('[ErrorBoundary Telemetry]', log);
    }
  }

  public handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public handleReloadSession = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  public handleExportDiagnostics = (): void => {
    if (typeof window === 'undefined') return;
    const diagnostics = {
      error: this.state.error?.message,
      stack: this.state.error?.stack,
      componentStack: this.state.errorInfo?.componentStack,
      userAgent: navigator.userAgent,
      url: window.location.href,
      timestamp: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(diagnostics, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crash-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isWidget = this.props.level === 'widget';

      return (
        <div
          role="alert"
          className={`p-6 rounded-xl border border-red-500/30 bg-red-950/20 backdrop-blur-md shadow-2xl ${
            isWidget ? 'max-w-md my-2' : 'max-w-3xl mx-auto my-8'
          }`}
        >
          <div className="flex items-center gap-3 text-red-400 mb-3">
            <svg
              className="w-6 h-6 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <h3 className="text-xl font-semibold tracking-wide">
              {isWidget ? 'Widget Component Crashed' : 'An Unexpected Error Occurred'}
            </h3>
          </div>

          <p className="text-sm text-gray-300 mb-4 font-mono bg-black/40 p-3 rounded border border-gray-800 break-words">
            {this.state.error?.message || 'Unknown runtime exception'}
          </p>

          <div className="flex flex-wrap gap-3 mt-4">
            <button
              onClick={this.handleReset}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors shadow-lg"
            >
              Try Again
            </button>

            <button
              onClick={this.handleReloadSession}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition-colors"
            >
              Reload Session
            </button>

            <button
              onClick={this.handleExportDiagnostics}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 hover:bg-gray-800 text-gray-400 border border-gray-800 transition-colors"
            >
              Export Crash Diagnostics
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
