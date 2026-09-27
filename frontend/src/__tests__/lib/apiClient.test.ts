import { ApiClient, ApiError, CircuitBreakerOpenError } from '../../lib/apiClient';

describe('ApiClient', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('makes a successful GET request', async () => {
    const mockData = { id: '123', name: 'Soroban' };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockData,
    } as Response);

    const client = new ApiClient({ baseUrl: 'https://api.example.com' });
    const result = await client.get('/test');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/test',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toEqual(mockData);
  });

  it('injects authorization bearer token when provider is supplied', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response);

    const client = new ApiClient({
      getAuthToken: () => 'test-jwt-token',
    });

    await client.get('https://api.example.com/secure');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/secure',
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    );

    const callArgs = (global.fetch as jest.Mock).mock.calls[0];
    const headers: Headers = callArgs[1].headers;
    expect(headers.get('Authorization')).toBe('Bearer test-jwt-token');
  });

  it('trips circuit breaker after consecutive failures', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network failure'));

    const client = new ApiClient({
      maxRetries: 0,
      circuitBreakerThreshold: 2,
    });

    await expect(client.get('https://api.example.com/fail')).rejects.toThrow();
    await expect(client.get('https://api.example.com/fail')).rejects.toThrow();

    expect(client.getCircuitBreakerState()).toBe('OPEN');

    // Next request should immediately throw CircuitBreakerOpenError without invoking fetch
    await expect(client.get('https://api.example.com/fail')).rejects.toThrow(CircuitBreakerOpenError);
  });
});
