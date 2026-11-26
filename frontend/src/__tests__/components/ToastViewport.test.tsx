import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ToastViewport from '../../components/ToastViewport';
import { toastManager } from '../../lib/toastManager';

describe('ToastViewport', () => {
  afterEach(() => act(() => toastManager.clear()));

  it('renders and dismisses notifications from the shared toast manager', () => {
    render(<ToastViewport />);
    act(() => {
      toastManager.show({
        title: 'Simulation failed',
        message: 'RPC rejected the request',
        type: 'error',
        durationMs: 0,
      });
    });
    expect(screen.getByRole('status')).toHaveTextContent('Simulation failed');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Simulation failed' }));
    return waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('displays the counter badge when notifications are grouped', () => {
    render(<ToastViewport />);
    act(() => {
      toastManager.show({
        title: 'Network Timeout',
        message: 'Connection dropped',
        type: 'error',
      });
      toastManager.show({
        title: 'Network Timeout',
        message: 'Connection dropped',
        type: 'error',
      });
    });

    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(screen.getByLabelText('Occurred 2 times')).toBeInTheDocument();
  });

  it('provides accessible sound toggle control', () => {
    render(<ToastViewport />);
    act(() => {
      toastManager.show({ title: 'Task Running', type: 'info' });
    });

    const toggleBtn = screen.getByRole('button', { name: /sound cues/i });
    expect(toggleBtn).toBeInTheDocument();
    expect(screen.getByText('Sound on')).toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(screen.getByText('Sound off')).toBeInTheDocument();
    expect(toastManager.isSoundEnabled()).toBe(false);
  });
});
