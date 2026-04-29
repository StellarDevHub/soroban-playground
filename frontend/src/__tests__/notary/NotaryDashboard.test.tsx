import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import NotaryDashboard from '../../components/notary/NotaryDashboard';

global.fetch = jest.fn();

const mockRecord = {
  fileHash: 'a'.repeat(64),
  owner: 'GABC123',
  timestamp: 1000000,
  metadata: 'Test document',
  verified: true,
  recordId: 1000000,
};

const mockResponse = {
  success: true,
  data: {
    records: [mockRecord],
    total: 1,
    page: 1,
    limit: 20,
  },
};

describe('NotaryDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
  });

  it('renders dashboard header', async () => {
    render(<NotaryDashboard />);
    expect(screen.getByText(/notary dashboard/i)).toBeInTheDocument();
  });

  it('renders list of notarizations', async () => {
    render(<NotaryDashboard />);
    await waitFor(() => {
      expect(screen.getByRole('list', { name: /notarization records/i })).toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
    });
  });

  it('shows total record count', async () => {
    render(<NotaryDashboard />);
    await waitFor(() => {
      expect(screen.getByText(/1 total records/i)).toBeInTheDocument();
    });
  });

  it('shows verified status badge', async () => {
    render(<NotaryDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Verified')).toBeInTheDocument();
    });
  });

  it('shows revoked status for unverified records', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          records: [{ ...mockRecord, verified: false }],
          total: 1,
          page: 1,
          limit: 20,
        },
      }),
    });

    render(<NotaryDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Revoked')).toBeInTheDocument();
    });
  });

  it('filters records by search input', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          records: [
            mockRecord,
            { ...mockRecord, fileHash: 'b'.repeat(64), owner: 'GXYZ' },
          ],
          total: 2,
          page: 1,
          limit: 20,
        },
      }),
    });

    render(<NotaryDashboard />);
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });

    const searchInput = screen.getByLabelText(/search by file hash or owner/i);
    fireEvent.change(searchInput, { target: { value: 'GXYZ' } });

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
    });
  });

  it('shows no records message when list is empty', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { records: [], total: 0, page: 1, limit: 20 },
      }),
    });

    render(<NotaryDashboard />);
    await waitFor(() => {
      expect(screen.getByText(/no records found/i)).toBeInTheDocument();
    });
  });
});
