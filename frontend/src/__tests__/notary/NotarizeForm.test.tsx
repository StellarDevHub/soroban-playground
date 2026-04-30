import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NotarizeForm from '../../components/notary/NotarizeForm';

global.fetch = jest.fn();
global.crypto = {
  subtle: {
    digest: jest.fn(),
  },
};

describe('NotarizeForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.crypto.subtle.digest.mockResolvedValue(
      new Uint8Array(32).fill(0xaa).buffer
    );
  });

  it('renders form elements', () => {
    render(<NotarizeForm />);
    expect(screen.getByLabelText(/notarize file form/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/file input/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/metadata/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /notarize file/i })).toBeInTheDocument();
  });

  it('shows error when metadata is empty', async () => {
    render(<NotarizeForm />);
    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    const input = screen.getByLabelText(/file input/i);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(global.crypto.subtle.digest).toHaveBeenCalled();
    });

    const submitBtn = screen.getByRole('button', { name: /notarize file/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/metadata is required/i)).toBeInTheDocument();
    });
  });

  it('submits correct data and shows success message', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { recordId: 123, timestamp: 1000 },
      }),
    });

    render(<NotarizeForm />);
    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    const input = screen.getByLabelText(/file input/i);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(global.crypto.subtle.digest).toHaveBeenCalled();
    });

    const metaInput = screen.getByLabelText(/metadata/i);
    fireEvent.change(metaInput, { target: { value: 'Test document' } });

    const submitBtn = screen.getByRole('button', { name: /notarize file/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/notary/notarize',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('aaaaaaaaaaaaaaaa'),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/file notarized successfully/i)).toBeInTheDocument();
    });
  });

  it('prevents submission when file is not selected', () => {
    render(<NotarizeForm />);
    const submitBtn = screen.getByRole('button', { name: /notarize file/i });
    expect(submitBtn).toBeDisabled();
  });
});
