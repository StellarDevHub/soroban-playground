import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VerifyForm from '../../components/notary/VerifyForm';

global.fetch = jest.fn();
global.crypto = {
  subtle: {
    digest: jest.fn(),
  },
};

const VALID_HASH = 'a'.repeat(64);

describe('VerifyForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.crypto.subtle.digest.mockResolvedValue(
      new Uint8Array(32).fill(0xaa).buffer
    );
  });

  it('renders form elements', () => {
    render(<VerifyForm />);
    expect(screen.getByLabelText(/verify file form/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/file hash/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify file/i })).toBeInTheDocument();
  });

  it('shows error for invalid hash', async () => {
    render(<VerifyForm />);
    const input = screen.getByLabelText(/file hash input/i);
    fireEvent.change(input, { target: { value: 'not-a-hash' } });

    const submitBtn = screen.getByRole('button', { name: /verify file/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('displays correct verification result', async () => {
    const record = {
      fileHash: VALID_HASH,
      owner: 'GABC123',
      timestamp: 1000000,
      metadata: 'Test doc',
      verified: true,
      recordId: 1000000,
    };
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: record }),
    });

    render(<VerifyForm />);
    const input = screen.getByLabelText(/file hash input/i);
    fireEvent.change(input, { target: { value: VALID_HASH } });

    const submitBtn = screen.getByRole('button', { name: /verify file/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/verified/i)).toBeInTheDocument();
      expect(screen.getByText('GABC123')).toBeInTheDocument();
      expect(screen.getByText('Test doc')).toBeInTheDocument();
    });
  });

  it('shows not found message when file is not notarized', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ message: 'File not found' }),
    });

    render(<VerifyForm />);
    const input = screen.getByLabelText(/file hash input/i);
    fireEvent.change(input, { target: { value: VALID_HASH } });

    fireEvent.click(screen.getByRole('button', { name: /verify file/i }));

    await waitFor(() => {
      expect(screen.getByText(/has not been notarized/i)).toBeInTheDocument();
    });
  });

  it('submit button is disabled when hash is empty', () => {
    render(<VerifyForm />);
    expect(screen.getByRole('button', { name: /verify file/i })).toBeDisabled();
  });
});
