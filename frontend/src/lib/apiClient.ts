export interface ApiClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  getAuthToken?: () => string | null | Promise<string | null>;
  circuitBreakerThreshold?: number;
  circuitBreakerResetTimeoutMs?: number;
}

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class ApiError extends Error {
  public status: number;
  public data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(message = 'Circuit breaker is open. Request blocked to prevent cascading failure.') {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

export class ApiClient {
  private baseUrl: string;
  private timeoutMs: number;
  private maxRetries: number;
  private retryDelayMs: number;
  private getAuthToken?: () => string | null | Promise<string | null>;

  // Circuit Breaker State
  private cbState: CircuitBreakerState = 'CLOSED';
  private failureCount = 0;
  private cbThreshold: number;
  private cbResetTimeoutMs: number;
  private lastStateChangeTime: number = Date.now();

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = config.baseUrl || process.env.NEXT_PUBLIC_API_URL || '';
    this.timeoutMs = config.timeoutMs ?? 10000;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 300;
    this.getAuthToken = config.getAuthToken;
    this.cbThreshold = config.circuitBreakerThreshold ?? 5;
    this.cbResetTimeoutMs = config.circuitBreakerResetTimeoutMs ?? 30000;
  }

  public getCircuitBreakerState(): CircuitBreakerState {
    this.checkCircuitState();
    return this.cbState;
  }

  private checkCircuitState(): void {
    if (this.cbState === 'OPEN') {
      const elapsed = Date.now() - this.lastStateChangeTime;
      if (elapsed >= this.cbResetTimeoutMs) {
        this.cbState = 'HALF_OPEN';
        this.lastStateChangeTime = Date.now();
      }
    }
  }

  private recordSuccess(): void {
    if (this.cbState === 'HALF_OPEN') {
      this.cbState = 'CLOSED';
      this.failureCount = 0;
      this.lastStateChangeTime = Date.now();
    } else if (this.cbState === 'CLOSED') {
      this.failureCount = 0;
    }
  }

  private recordFailure(): void {
    this.failureCount++;
    if (this.failureCount >= this.cbThreshold || this.cbState === 'HALF_OPEN') {
      this.cbState = 'OPEN';
      this.lastStateChangeTime = Date.now();
    }
  }

  private async prepareHeaders(customHeaders?: HeadersInit): Promise<Headers> {
    const headers = new Headers(customHeaders);
    if (!headers.has('Content-Type') && !headers.has('content-type')) {
      headers.set('Content-Type', 'application/json');
    }

    if (this.getAuthToken && !headers.has('Authorization')) {
      const token = await this.getAuthToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }

    return headers;
  }

  public async request<T = any>(
    endpoint: string,
    options: RequestInit & { timeoutMs?: number; skipRetry?: boolean } = {}
  ): Promise<T> {
    this.checkCircuitState();

    if (this.cbState === 'OPEN') {
      throw new CircuitBreakerOpenError();
    }

    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
    const timeout = options.timeoutMs ?? this.timeoutMs;
    const maxRetries = options.skipRetry ? 0 : this.maxRetries;

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= maxRetries) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const headers = await this.prepareHeaders(options.headers);
        const response = await fetch(url, {
          ...options,
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          let errorData: any;
          try {
            errorData = await response.json();
          } catch {
            errorData = await response.text();
          }

          const apiError = new ApiError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            errorData
          );

          // Retry only on server errors (5xx) or 429 Too Many Requests
          if (response.status >= 500 || response.status === 429) {
            throw apiError;
          } else {
            // Client errors (4xx except 429) don't trigger retries or circuit breaker failures
            throw apiError;
          }
        }

        this.recordSuccess();

        if (response.status === 204) {
          return {} as T;
        }

        const data = await response.json();
        return data as T;
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastError = err;

        const isServerError = err instanceof ApiError && (err.status >= 500 || err.status === 429);
        const isNetworkOrTimeout = err.name === 'AbortError' || err.name === 'TypeError' || !(err instanceof ApiError);

        if (isServerError || isNetworkOrTimeout) {
          this.recordFailure();
          attempt++;

          if (attempt <= maxRetries && this.cbState !== 'OPEN') {
            const backoff = Math.pow(2, attempt - 1) * this.retryDelayMs + Math.random() * 50;
            await new Promise((res) => setTimeout(res, backoff));
            continue;
          }
        }

        throw err;
      }
    }

    throw lastError || new Error('Request failed');
  }

  public get<T = any>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  public post<T = any>(endpoint: string, body?: any, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  public put<T = any>(endpoint: string, body?: any, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  public delete<T = any>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
