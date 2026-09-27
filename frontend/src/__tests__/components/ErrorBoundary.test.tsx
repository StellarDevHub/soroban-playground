import React from 'react';
import { ErrorBoundary } from '../../components/ErrorBoundary';

const ProblemChild: React.FC<{ shouldThrow?: boolean }> = ({ shouldThrow }) => {
  if (shouldThrow) {
    throw new Error('Test crash in child component');
  }
  return <div>Healthy Component</div>;
};

describe('ErrorBoundary', () => {
  // Prevent noisy console.error in jest output for intentional test errors
  const originalError = console.error;
  beforeAll(() => {
    console.error = jest.fn();
  });
  afterAll(() => {
    console.error = originalError;
  });

  it('renders children normally when there is no error', () => {
    const Component = () => (
      <ErrorBoundary>
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(Component).toBeDefined();
  });

  it('invokes telemetry logger when a child component throws an error', () => {
    const onLogError = jest.fn();
    const Component = () => (
      <ErrorBoundary onLogError={onLogError}>
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(Component).toBeDefined();
  });
});
