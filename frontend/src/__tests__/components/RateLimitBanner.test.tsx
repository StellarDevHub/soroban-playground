import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import RateLimitBanner from '../../components/RateLimitBanner';
import { rateLimitTracker } from '../../lib/rateLimitTracker';

describe('RateLimitBanner', () => {
  beforeEach(() => {
    rateLimitTracker.clear();
  });

  afterEach(() => {
    rateLimitTracker.clear();
  });

  it('does not render when quota is healthy (> 15%)', () => {
    render(<RateLimitBanner />);
    act(() => {
      rateLimitTracker.setManualState(100, 80, 60);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('proactively displays warning banner when quota falls below 15%', () => {
    render(<RateLimitBanner />);
    act(() => {
      rateLimitTracker.updateFromHeaders({
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '12',
        'X-RateLimit-Reset': '45',
      });
    });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Proactive API Quota Warning')).toBeInTheDocument();
    expect(screen.getByText(/12 \/ 100 requests \(12%\)/)).toBeInTheDocument();
    expect(screen.getByText('45s')).toBeInTheDocument();
  });

  it('displays critical warning when rate limit is exceeded (0 remaining)', () => {
    render(<RateLimitBanner />);
    act(() => {
      rateLimitTracker.updateFromHeaders({
        'X-RateLimit-Limit': '50',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': '30',
      });
    });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('API Rate Limit Reached')).toBeInTheDocument();
    expect(screen.getByText(/0 \/ 50 requests \(0%\)/)).toBeInTheDocument();
  });

  it('renders the visual quota gauge with correct progress width', () => {
    const { container } = render(<RateLimitBanner />);
    act(() => {
      rateLimitTracker.setManualState(100, 10, 60);
    });

    const gaugeBar = container.querySelector('.bg-amber-500');
    expect(gaugeBar).toBeInTheDocument();
    expect(gaugeBar).toHaveStyle({ width: '10%' });
  });

  it('allows dismissing the banner', () => {
    render(<RateLimitBanner />);
    act(() => {
      rateLimitTracker.setManualState(100, 5, 60);
    });

    expect(screen.getByRole('status')).toBeInTheDocument();
    const dismissBtn = screen.getByRole('button', { name: /dismiss rate limit banner/i });
    fireEvent.click(dismissBtn);

    expect(screen.queryByRole('status')).toBeNull();
  });
});
