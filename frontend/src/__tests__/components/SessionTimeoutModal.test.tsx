import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SessionTimeoutModal from '../../components/SessionTimeoutModal';

describe('SessionTimeoutModal', () => {
  const defaultProps = {
    isOpen: true,
    secondsRemaining: 95,
    isRefreshing: false,
    onExtend: jest.fn(),
    onLogout: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    render(<SessionTimeoutModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders modal with dialog semantics and formatted countdown time', () => {
    render(<SessionTimeoutModal {...defaultProps} secondsRemaining={75} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Session Expiring Soon')).toBeInTheDocument();
    // 75 seconds -> 1:15
    expect(screen.getByText('1:15')).toBeInTheDocument();
  });

  it('displays the emergency backup notification message', () => {
    render(<SessionTimeoutModal {...defaultProps} />);
    expect(
      screen.getByText(/Unsaved editor buffers have been backed up to local storage/i)
    ).toBeInTheDocument();
  });

  it('calls onExtend when Extend Session button is clicked', () => {
    render(<SessionTimeoutModal {...defaultProps} />);
    const extendBtn = screen.getByRole('button', { name: /extend session/i });
    fireEvent.click(extendBtn);

    expect(defaultProps.onExtend).toHaveBeenCalledTimes(1);
  });

  it('calls onLogout when Log Out button is clicked', () => {
    render(<SessionTimeoutModal {...defaultProps} />);
    const logoutBtn = screen.getByRole('button', { name: /log out/i });
    fireEvent.click(logoutBtn);

    expect(defaultProps.onLogout).toHaveBeenCalledTimes(1);
  });

  it('triggers onExtend on Escape key press for seamless continuation', () => {
    render(<SessionTimeoutModal {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(defaultProps.onExtend).toHaveBeenCalledTimes(1);
  });
});
