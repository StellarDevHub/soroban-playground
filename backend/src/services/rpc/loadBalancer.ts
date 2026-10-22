// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Dynamic RPC load balancer with EWMA latency tracking and adaptive
 * latency-based circuit breakers (#1773).
 *
 * Responsibilities:
 *  - Track per-provider EWMA latency and EWMA error rates.
 *  - Trip a per-provider circuit breaker (CLOSED -> OPEN -> HALF_OPEN) when
 *    the provider exceeds the configured error-rate threshold.
 *  - Route requests to the lowest-latency healthy provider.
 *  - Retry transient 5xx/network failures on secondary providers.
 *  - Expose provider latency/state metrics through `getStatus()` and a
 *    lightweight telemetry subscription API.
 *
 * All timing is injectable (`now`) so latency and breaker transitions can be
 * tested deterministically.
 */

export const CIRCUIT_STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
} as const;

export type CircuitState = (typeof CIRCUIT_STATES)[keyof typeof CIRCUIT_STATES];

export type RpcProviderType = 'soroban' | 'horizon';

export interface RpcProviderConfig {
  url: string;
  name?: string;
  type?: RpcProviderType;
  /** Relative traffic weight. Higher values receive proportionally more traffic. */
  weight?: number;
}

export interface RpcRequestContext {
  url: string;
  provider: RpcProviderConfig;
  /** 1-based attempt number. */
  attempt: number;
  signal?: AbortSignal;
}

export type RpcRequestFn<T> = (
  url: string,
  context: RpcRequestContext
) => Promise<T>;

export interface RpcExecuteOptions {
  /** Maximum number of retries after the initial attempt. Defaults to one per provider. */
  maxRetries?: number;
  /** Provider URLs that must not be used for this request. */
  exclude?: Iterable<string>;
  /** Disable transient-error retries for this request. Defaults to true. */
  retryOnTransient?: boolean;
  signal?: AbortSignal;
}

export interface RpcExecutionResult<T> {
  result: T;
  provider: string;
  url: string;
  attempts: number;
  latencyMs: number;
  circuitState: CircuitState;
}

export interface CircuitBreakerOptions {
  /** Error-rate threshold (0..1) that trips the breaker. Defaults to 5%. */
  errorRateThreshold?: number;
  /** Minimum samples in the window before the error-rate rule can trip. */
  minimumRequests?: number;
  /** Consecutive failures that immediately open the breaker. */
  consecutiveFailureThreshold?: number;
  /** How long an OPEN breaker waits before allowing a HALF_OPEN probe. */
  openTimeoutMs?: number;
  /** Number of concurrent HALF_OPEN probes allowed. */
  halfOpenMaxRequests?: number;
  /** Successful HALF_OPEN probes required before closing. */
  halfOpenSuccessesToClose?: number;
  /** Rolling window size used for the observed error rate. */
  windowSize?: number;
  /** EWMA smoothing factor for the error rate (0..1]. */
  errorRateAlpha?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  onStateChange?: (
    from: CircuitState,
    to: CircuitState,
    reason?: string
  ) => void;
}

export interface RpcLoadBalancerOptions extends CircuitBreakerOptions {
  /** EWMA smoothing factor for request latency (0..1]. */
  latencyEwmaAlpha?: number;
  /** How much an elevated error rate penalises a provider's latency score. */
  errorRatePenalty?: number;
  /** Default retries. Defaults to one per configured provider. */
  maxRetries?: number;
  /** Retry HTTP 5xx and transient network errors. Defaults to true. */
  retryOn5xx?: boolean;
  /** Optional telemetry listener registered at construction time. */
  telemetry?: TelemetryListener;
}

export interface ProviderStatus {
  url: string;
  name: string;
  type: RpcProviderType;
  weight: number;
  state: CircuitState;
  circuitBreakerState: CircuitState;
  isHealthy: boolean;
  available: boolean;
  latencyEmaMs: number | null;
  latencySamples: number;
  lastLatencyMs: number | null;
  errorRateEwma: number;
  errorRate: number;
  requests: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  inFlight: number;
  lastSelectedAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
}

export interface RpcLoadBalancerStatus {
  activeProvider: string | null;
  providerCount: number;
  openCircuits: number;
  halfOpenCircuits: number;
  providers: ProviderStatus[];
  metrics: {
    totalRequests: number;
    totalSuccesses: number;
    totalFailures: number;
    totalRetries: number;
    successRate: number;
    averageLatencyMs: number;
  };
  config: {
    errorRateThreshold: number;
    openTimeoutMs: number;
    latencyEwmaAlpha: number;
    errorRateEwmaAlpha: number;
  };
}

export type TelemetryListener = (status: RpcLoadBalancerStatus) => void;

const DEFAULT_LATENCY_ALPHA = 0.2;
const DEFAULT_ERROR_RATE_ALPHA = 0.05;
const DEFAULT_ERROR_RATE_THRESHOLD = 0.05;
const DEFAULT_MINIMUM_REQUESTS = 10;
const DEFAULT_CONSECUTIVE_FAILURES = 3;
const DEFAULT_OPEN_TIMEOUT_MS = 30_000;
const DEFAULT_HALF_OPEN_MAX_REQUESTS = 1;
const DEFAULT_HALF_OPEN_SUCCESSES = 1;
const DEFAULT_WINDOW_SIZE = 20;
const DEFAULT_ERROR_RATE_PENALTY = 1;

const TRANSIENT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'ERR_NETWORK',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const TRANSIENT_MESSAGE_PATTERN =
  /timeout|timed out|socket hang up|network|fetch failed|service unavailable|bad gateway|gateway timeout|ECONN|EAI_AGAIN|\b5\d{2}\b/i;

function asRecord(value: unknown): Record<string, any> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, any>)
    : null;
}

function getErrorStatus(error: unknown): number | null {
  const record = asRecord(error);
  if (!record) return null;

  const candidates = [
    record.status,
    record.statusCode,
    record.response?.status,
    record.cause?.status,
  ];

  for (const candidate of candidates) {
    const status = Number(candidate);
    if (Number.isInteger(status)) return status;
  }

  return null;
}

/**
 * Classify an error as a transient upstream failure that is safe to retry on
 * another provider. HTTP 5xx and network/timeout errors qualify; 4xx and
 * application-level errors do not.
 */
export function isTransientRpcError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status !== null) {
    return status === 429 || (status >= 500 && status <= 599);
  }

  const record = asRecord(error);
  const code = record?.code;
  if (typeof code === 'string' && TRANSIENT_ERROR_CODES.has(code)) {
    return true;
  }

  if (record?.name === 'AbortError' || record?.name === 'TimeoutError') {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error ?? '');
  return TRANSIENT_MESSAGE_PATTERN.test(message);
}

/**
 * Exponentially weighted moving average. The first sample seeds the average;
 * subsequent samples are blended with the configured smoothing factor.
 */
export class Ewma {
  readonly alpha: number;
  private current: number | null = null;
  private sampleCount = 0;

  constructor(alpha: number = DEFAULT_LATENCY_ALPHA) {
    if (!(alpha > 0 && alpha <= 1)) {
      throw new RangeError('EWMA alpha must be greater than 0 and at most 1');
    }
    this.alpha = alpha;
  }

  update(sample: number): number {
    const safeSample = Number.isFinite(sample) ? Math.max(0, sample) : 0;
    if (this.current === null) {
      this.current = safeSample;
    } else {
      this.current = this.alpha * safeSample + (1 - this.alpha) * this.current;
    }
    this.sampleCount += 1;
    return this.current;
  }

  get value(): number | null {
    return this.current;
  }

  get samples(): number {
    return this.sampleCount;
  }

  getValue(): number | null {
    return this.current;
  }

  getSamples(): number {
    return this.sampleCount;
  }

  reset(): void {
    this.current = null;
    this.sampleCount = 0;
  }
}

/**
 * Per-provider circuit breaker.
 *
 * CLOSED  – traffic flows normally.
 * OPEN    – traffic is rejected until the cool-down expires.
 * HALF_OPEN – a bounded number of probe requests are allowed; success closes
 *             the circuit, failure re-opens it.
 */
export class CircuitBreaker {
  readonly errorRateThreshold: number;
  readonly minimumRequests: number;
  readonly consecutiveFailureThreshold: number;
  readonly openTimeoutMs: number;
  readonly halfOpenMaxRequests: number;
  readonly halfOpenSuccessesToClose: number;
  readonly windowSize: number;

  private currentState: CircuitState = CIRCUIT_STATES.CLOSED;
  private openedAt: number | null = null;
  private halfOpenInFlight = 0;
  private halfOpenSuccesses = 0;
  private consecutiveFailures = 0;
  private readonly window: number[] = [];
  private readonly errorRateEwma: Ewma;
  private readonly nowFn: () => number;
  private readonly onStateChange?: (
    from: CircuitState,
    to: CircuitState,
    reason?: string
  ) => void;

  private requests = 0;
  private successes = 0;
  private failures = 0;
  private tripCount = 0;
  private lastSuccessAt: number | null = null;
  private lastFailureAt: number | null = null;

  constructor(options: CircuitBreakerOptions = {}) {
    this.errorRateThreshold =
      options.errorRateThreshold ?? DEFAULT_ERROR_RATE_THRESHOLD;
    this.minimumRequests = options.minimumRequests ?? DEFAULT_MINIMUM_REQUESTS;
    this.consecutiveFailureThreshold =
      options.consecutiveFailureThreshold ?? DEFAULT_CONSECUTIVE_FAILURES;
    this.openTimeoutMs = options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
    this.halfOpenMaxRequests =
      options.halfOpenMaxRequests ?? DEFAULT_HALF_OPEN_MAX_REQUESTS;
    this.halfOpenSuccessesToClose =
      options.halfOpenSuccessesToClose ?? DEFAULT_HALF_OPEN_SUCCESSES;
    this.windowSize = Math.max(
      options.windowSize ?? DEFAULT_WINDOW_SIZE,
      this.minimumRequests
    );
    this.errorRateEwma = new Ewma(
      options.errorRateAlpha ?? DEFAULT_ERROR_RATE_ALPHA
    );
    this.nowFn = options.now ?? Date.now;
    this.onStateChange = options.onStateChange;
  }

  get state(): CircuitState {
    return this.currentState;
  }

  get errorRate(): number {
    return this.window.length === 0
      ? 0
      : this.window.reduce((sum, value) => sum + value, 0) / this.window.length;
  }

  get errorRateEwmaValue(): number {
    return this.errorRateEwma.value ?? 0;
  }

  get consecutiveFailureCount(): number {
    return this.consecutiveFailures;
  }

  get openedAtTime(): number | null {
    return this.openedAt;
  }

  get totalRequests(): number {
    return this.requests;
  }

  get totalSuccesses(): number {
    return this.successes;
  }

  get totalFailures(): number {
    return this.failures;
  }

  get trips(): number {
    return this.tripCount;
  }

  get lastSuccessTime(): number | null {
    return this.lastSuccessAt;
  }

  get lastFailureTime(): number | null {
    return this.lastFailureAt;
  }

  /**
   * Whether the breaker could accept a request right now. This is a pure check;
   * call `acquire()` to actually reserve a HALF_OPEN probe slot.
   */
  isAvailable(now: number = this.nowFn()): boolean {
    if (this.currentState === CIRCUIT_STATES.CLOSED) return true;

    if (this.currentState === CIRCUIT_STATES.OPEN) {
      return (
        this.openedAt !== null && now - this.openedAt >= this.openTimeoutMs
      );
    }

    return this.halfOpenInFlight < this.halfOpenMaxRequests;
  }

  /**
   * Reserve permission to send a request. OPEN breakers transition to
   * HALF_OPEN when their cool-down has elapsed.
   */
  acquire(now: number = this.nowFn()): boolean {
    if (!this.isAvailable(now)) return false;

    if (this.currentState === CIRCUIT_STATES.OPEN) {
      this.transition(CIRCUIT_STATES.HALF_OPEN, 'cool-down elapsed');
      this.halfOpenInFlight = 0;
      this.halfOpenSuccesses = 0;
    }

    if (this.currentState === CIRCUIT_STATES.HALF_OPEN) {
      if (this.halfOpenInFlight >= this.halfOpenMaxRequests) return false;
      this.halfOpenInFlight += 1;
    }

    return true;
  }

  recordSuccess(now: number = this.nowFn()): void {
    this.requests += 1;
    this.successes += 1;
    this.lastSuccessAt = now;
    this.consecutiveFailures = 0;
    this.recordErrorSample(0);

    if (this.currentState === CIRCUIT_STATES.HALF_OPEN) {
      this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.halfOpenSuccessesToClose) {
        this.close();
      }
    }
  }

  recordFailure(now: number = this.nowFn()): void {
    this.requests += 1;
    this.failures += 1;
    this.lastFailureAt = now;
    this.consecutiveFailures += 1;
    this.recordErrorSample(1);

    if (this.currentState === CIRCUIT_STATES.HALF_OPEN) {
      this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
      this.halfOpenSuccesses = 0;
      this.open(now, 'half-open probe failed');
      return;
    }

    if (this.currentState === CIRCUIT_STATES.CLOSED) {
      this.maybeTrip(now);
    }
  }

  reset(): void {
    this.currentState = CIRCUIT_STATES.CLOSED;
    this.openedAt = null;
    this.halfOpenInFlight = 0;
    this.halfOpenSuccesses = 0;
    this.consecutiveFailures = 0;
    this.window.length = 0;
    this.errorRateEwma.reset();
    this.requests = 0;
    this.successes = 0;
    this.failures = 0;
    this.tripCount = 0;
    this.lastSuccessAt = null;
    this.lastFailureAt = null;
  }

  private recordErrorSample(error: number): void {
    this.errorRateEwma.update(error);
    this.window.push(error);
    if (this.window.length > this.windowSize) {
      this.window.shift();
    }
  }

  private maybeTrip(now: number): void {
    if (
      this.consecutiveFailures >= this.consecutiveFailureThreshold ||
      (this.window.length >= this.minimumRequests &&
        this.errorRateEwmaValue > this.errorRateThreshold)
    ) {
      this.open(now, 'error rate exceeded threshold');
    }
  }

  private open(now: number, reason: string): void {
    if (this.currentState === CIRCUIT_STATES.OPEN) return;
    this.openedAt = now;
    this.halfOpenInFlight = 0;
    this.halfOpenSuccesses = 0;
    this.tripCount += 1;
    this.transition(CIRCUIT_STATES.OPEN, reason);
  }

  private close(): void {
    this.openedAt = null;
    this.halfOpenInFlight = 0;
    this.halfOpenSuccesses = 0;
    this.consecutiveFailures = 0;
    this.window.length = 0;
    this.errorRateEwma.reset();
    this.transition(CIRCUIT_STATES.CLOSED, 'probes succeeded');
  }

  private transition(to: CircuitState, reason?: string): void {
    const from = this.currentState;
    if (from === to) return;
    this.currentState = to;
    this.onStateChange?.(from, to, reason);
  }
}

interface ProviderRuntime {
  config: Required<RpcProviderConfig>;
  index: number;
  latency: Ewma;
  breaker: CircuitBreaker;
  inFlight: number;
  requests: number;
  successes: number;
  failures: number;
  lastLatencyMs: number | null;
  lastSelectedAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
}

export class NoHealthyRpcProviderError extends Error {
  readonly code = 'NO_HEALTHY_RPC_PROVIDER';

  constructor(message = 'No healthy RPC providers are available') {
    super(message);
    this.name = 'NoHealthyRpcProviderError';
  }
}

function normalizeProvider(
  provider: RpcProviderConfig | string
): Required<RpcProviderConfig> {
  const config = typeof provider === 'string' ? { url: provider } : provider;
  if (!config.url) {
    throw new TypeError('RPC provider URL is required');
  }

  return {
    url: config.url,
    name: config.name || config.url,
    type: config.type || 'soroban',
    weight:
      config.weight !== undefined && config.weight > 0 ? config.weight : 1,
  };
}

function getProvidersFromEnv(): RpcProviderConfig[] {
  const configured =
    process.env.RPC_LOAD_BALANCER_PROVIDERS ||
    process.env.SOROBAN_RPC_FALLBACK_URLS;

  if (configured) {
    return configured
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean)
      .map((url) => ({ url }));
  }

  return [
    {
      url: process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
      name: 'soroban-primary',
      type: 'soroban',
    },
    {
      url: 'https://rpc-futurenet.stellar.org',
      name: 'soroban-futurenet',
      type: 'soroban',
    },
    {
      url: 'https://stellar-community.org/rpc',
      name: 'soroban-community',
      type: 'soroban',
    },
  ];
}

export function getDefaultProviders(): RpcProviderConfig[] {
  return getProvidersFromEnv();
}

/**
 * Dynamic RPC load balancer.
 */
export class RpcLoadBalancer {
  readonly latencyEwmaAlpha: number;
  readonly errorRateThreshold: number;
  readonly errorRateAlpha: number;
  readonly openTimeoutMs: number;

  private readonly errorRatePenalty: number;
  private readonly retryOn5xx: boolean;
  private readonly configuredMaxRetries?: number;
  private readonly nowFn: () => number;
  private readonly telemetryListeners = new Set<TelemetryListener>();
  private readonly breakerOptions: CircuitBreakerOptions;

  private providers: ProviderRuntime[] = [];
  private activeProvider: string | null = null;

  private totalAttempts = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private totalRetries = 0;
  private totalLatencyMs = 0;

  constructor(
    providers: Array<RpcProviderConfig | string> = getDefaultProviders(),
    options: RpcLoadBalancerOptions = {}
  ) {
    this.latencyEwmaAlpha = options.latencyEwmaAlpha ?? DEFAULT_LATENCY_ALPHA;
    this.errorRateThreshold =
      options.errorRateThreshold ?? DEFAULT_ERROR_RATE_THRESHOLD;
    this.errorRateAlpha = options.errorRateAlpha ?? DEFAULT_ERROR_RATE_ALPHA;
    this.openTimeoutMs = options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
    this.errorRatePenalty =
      options.errorRatePenalty ?? DEFAULT_ERROR_RATE_PENALTY;
    this.retryOn5xx = options.retryOn5xx ?? true;
    this.configuredMaxRetries = options.maxRetries;
    this.nowFn = options.now ?? Date.now;

    this.breakerOptions = {
      errorRateThreshold: this.errorRateThreshold,
      minimumRequests: options.minimumRequests ?? DEFAULT_MINIMUM_REQUESTS,
      consecutiveFailureThreshold:
        options.consecutiveFailureThreshold ?? DEFAULT_CONSECUTIVE_FAILURES,
      openTimeoutMs: this.openTimeoutMs,
      halfOpenMaxRequests:
        options.halfOpenMaxRequests ?? DEFAULT_HALF_OPEN_MAX_REQUESTS,
      halfOpenSuccessesToClose:
        options.halfOpenSuccessesToClose ?? DEFAULT_HALF_OPEN_SUCCESSES,
      windowSize: options.windowSize ?? DEFAULT_WINDOW_SIZE,
      errorRateAlpha: this.errorRateAlpha,
      now: this.nowFn,
      onStateChange: options.onStateChange,
    };

    for (const provider of providers) {
      this.addProvider(provider);
    }

    if (options.telemetry) {
      this.onTelemetry(options.telemetry);
    }
  }

  /**
   * Add a provider at runtime. Duplicate URLs are ignored.
   */
  addProvider(provider: RpcProviderConfig | string): boolean {
    const config = normalizeProvider(provider);
    if (this.providers.some((entry) => entry.config.url === config.url)) {
      return false;
    }

    const runtime: ProviderRuntime = {
      config,
      index: this.providers.length,
      latency: new Ewma(this.latencyEwmaAlpha),
      breaker: new CircuitBreaker({
        ...this.breakerOptions,
        onStateChange: (from, to, reason) => {
          this.emitTelemetry();
          this.breakerOptions.onStateChange?.(from, to, reason);
        },
      }),
      inFlight: 0,
      requests: 0,
      successes: 0,
      failures: 0,
      lastLatencyMs: null,
      lastSelectedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
    };

    this.providers.push(runtime);
    return true;
  }

  /**
   * Remove a provider at runtime. Returns true when a provider was removed.
   */
  removeProvider(identifier: string): boolean {
    const index = this.providers.findIndex(
      (entry) =>
        entry.config.url === identifier || entry.config.name === identifier
    );
    if (index === -1) return false;

    this.providers.splice(index, 1);
    this.providers.forEach((entry, idx) => {
      entry.index = idx;
    });
    if (this.activeProvider === identifier) {
      this.activeProvider = null;
    }
    return true;
  }

  getProviderConfigs(): RpcProviderConfig[] {
    return this.providers.map((entry) => ({ ...entry.config }));
  }

  /**
   * Preview the provider that would serve the next request. Does not reserve
   * HALF_OPEN probe slots.
   */
  selectProvider(excluded?: Iterable<string>): RpcProviderConfig | null {
    const runtime = this.selectRuntime(new Set(excluded ?? []), this.nowFn());
    return runtime ? { ...runtime.config } : null;
  }

  /**
   * Execute a request through the balancer. Returns the raw provider result.
   */
  async execute<T>(
    request: RpcRequestFn<T>,
    options: RpcExecuteOptions = {}
  ): Promise<T> {
    const execution = await this.executeWithMetadata(request, options);
    return execution.result;
  }

  /**
   * Execute a request and return routing metadata (provider, attempts,
   * latency) alongside the result.
   */
  async executeWithMetadata<T>(
    request: RpcRequestFn<T>,
    options: RpcExecuteOptions = {}
  ): Promise<RpcExecutionResult<T>> {
    if (typeof request !== 'function') {
      throw new TypeError('request must be a function');
    }
    if (this.providers.length === 0) {
      throw new NoHealthyRpcProviderError('No RPC providers are configured');
    }

    const maxRetries =
      options.maxRetries ??
      this.configuredMaxRetries ??
      Math.max(0, this.providers.length - 1);
    const maxAttempts = Math.max(1, maxRetries + 1);
    const excluded = new Set(options.exclude ?? []);
    let lastError: unknown;
    let hasError = false;
    let retryPending = false;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const runtime = this.selectRuntime(excluded, this.nowFn());
      if (!runtime) break;

      if (!runtime.breaker.acquire(this.nowFn())) {
        excluded.add(runtime.config.url);
        continue;
      }

      if (retryPending) {
        this.totalRetries += 1;
        retryPending = false;
      }

      runtime.lastSelectedAt = this.nowFn();
      const startedAt = this.nowFn();
      const url = runtime.config.url;
      runtime.inFlight += 1;
      this.totalAttempts += 1;

      try {
        const result = await request(url, {
          url,
          provider: { ...runtime.config },
          attempt: attempt + 1,
          signal: options.signal,
        });

        const latencyMs = Math.max(0, this.nowFn() - startedAt);
        runtime.inFlight = Math.max(0, runtime.inFlight - 1);
        this.applySuccess(runtime, latencyMs);

        return {
          result,
          provider: runtime.config.name,
          url,
          attempts: attempt + 1,
          latencyMs,
          circuitState: runtime.breaker.state,
        };
      } catch (error) {
        runtime.inFlight = Math.max(0, runtime.inFlight - 1);
        lastError = error;
        hasError = true;
        this.applyFailure(runtime, error);

        const retryable =
          options.retryOnTransient !== false &&
          (this.retryOn5xx ? isTransientRpcError(error) : false);

        if (!retryable) break;

        excluded.add(url);
        retryPending = true;
      }
    }

    if (hasError) {
      throw lastError instanceof Error
        ? lastError
        : new Error(String(lastError ?? 'RPC request failed'));
    }

    throw new NoHealthyRpcProviderError();
  }

  /**
   * Report an out-of-band success (e.g. from a health prober).
   */
  recordSuccess(url: string, latencyMs?: number): boolean {
    const runtime = this.findProvider(url);
    if (!runtime) return false;
    const latency = latencyMs ?? runtime.lastLatencyMs ?? 0;
    this.applySuccess(runtime, latency);
    return true;
  }

  /**
   * Report an out-of-band failure (e.g. from a health prober).
   */
  recordFailure(url: string, error?: unknown): boolean {
    const runtime = this.findProvider(url);
    if (!runtime) return false;
    this.applyFailure(runtime, error);
    return true;
  }

  /**
   * Update a provider's EWMA latency without recording a breaker outcome.
   */
  recordLatency(url: string, latencyMs: number): boolean {
    const runtime = this.findProvider(url);
    if (!runtime) return false;
    runtime.latency.update(latencyMs);
    runtime.lastLatencyMs = Math.max(0, latencyMs);
    this.emitTelemetry();
    return true;
  }

  /** Alias for `recordLatency`. */
  updateLatency(url: string, latencyMs: number): boolean {
    return this.recordLatency(url, latencyMs);
  }

  getStatus(): RpcLoadBalancerStatus {
    const now = this.nowFn();
    const providers = this.providers.map((entry) =>
      this.toProviderStatus(entry, now)
    );

    return {
      activeProvider: this.activeProvider,
      providerCount: providers.length,
      openCircuits: providers.filter(
        (entry) => entry.state === CIRCUIT_STATES.OPEN
      ).length,
      halfOpenCircuits: providers.filter(
        (entry) => entry.state === CIRCUIT_STATES.HALF_OPEN
      ).length,
      providers,
      metrics: {
        totalRequests: this.totalAttempts,
        totalSuccesses: this.totalSuccesses,
        totalFailures: this.totalFailures,
        totalRetries: this.totalRetries,
        successRate:
          this.totalAttempts > 0
            ? Number((this.totalSuccesses / this.totalAttempts).toFixed(4))
            : 1,
        averageLatencyMs:
          this.totalSuccesses > 0
            ? Math.round(this.totalLatencyMs / this.totalSuccesses)
            : 0,
      },
      config: {
        errorRateThreshold: this.errorRateThreshold,
        openTimeoutMs: this.openTimeoutMs,
        latencyEwmaAlpha: this.latencyEwmaAlpha,
        errorRateEwmaAlpha: this.errorRateAlpha,
      },
    };
  }

  /** Alias for `getStatus`, convenient for telemetry exporters. */
  getMetrics(): RpcLoadBalancerStatus {
    return this.getStatus();
  }

  getTelemetry(): RpcLoadBalancerStatus {
    return this.getStatus();
  }

  /**
   * Subscribe to live provider/status snapshots. Returns an unsubscribe
   * function.
   */
  onTelemetry(listener: TelemetryListener): () => void {
    if (typeof listener !== 'function') {
      throw new TypeError('telemetry listener must be a function');
    }
    this.telemetryListeners.add(listener);
    return () => {
      this.telemetryListeners.delete(listener);
    };
  }

  reset(): void {
    for (const provider of this.providers) {
      provider.breaker.reset();
      provider.latency.reset();
      provider.inFlight = 0;
      provider.requests = 0;
      provider.successes = 0;
      provider.failures = 0;
      provider.lastLatencyMs = null;
      provider.lastSelectedAt = null;
      provider.lastSuccessAt = null;
      provider.lastFailureAt = null;
      provider.lastError = null;
    }

    this.activeProvider = null;
    this.totalAttempts = 0;
    this.totalSuccesses = 0;
    this.totalFailures = 0;
    this.totalRetries = 0;
    this.totalLatencyMs = 0;
    this.emitTelemetry();
  }

  private findProvider(identifier: string): ProviderRuntime | undefined {
    return this.providers.find(
      (entry) =>
        entry.config.url === identifier || entry.config.name === identifier
    );
  }

  private selectRuntime(
    excluded: Set<string>,
    now: number
  ): ProviderRuntime | null {
    const candidates = this.providers.filter(
      (entry) =>
        !excluded.has(entry.config.url) && entry.breaker.isAvailable(now)
    );
    if (candidates.length === 0) return null;

    const measured = candidates
      .map((entry) => entry.latency.value)
      .filter((value): value is number => value !== null);
    const fallbackLatency = measured.length > 0 ? Math.min(...measured) : 0;

    candidates.sort((a, b) => {
      const scoreDelta =
        this.providerScore(a, fallbackLatency) -
        this.providerScore(b, fallbackLatency);
      if (scoreDelta !== 0) return scoreDelta;

      if (a.inFlight !== b.inFlight) return a.inFlight - b.inFlight;
      if (a.lastSelectedAt !== b.lastSelectedAt) {
        return (a.lastSelectedAt ?? 0) - (b.lastSelectedAt ?? 0);
      }
      return a.index - b.index;
    });

    return candidates[0];
  }

  private providerScore(
    provider: ProviderRuntime,
    fallbackLatency: number
  ): number {
    const latency = provider.latency.value ?? fallbackLatency;
    const errorRate = provider.breaker.errorRateEwmaValue;
    return (
      (latency * (1 + errorRate * this.errorRatePenalty)) /
      provider.config.weight
    );
  }

  private applySuccess(provider: ProviderRuntime, latencyMs: number): void {
    const now = this.nowFn();
    const latency = Math.max(0, latencyMs);

    provider.requests += 1;
    provider.successes += 1;
    provider.lastSuccessAt = now;
    provider.lastLatencyMs = latency;
    provider.latency.update(latency);
    provider.breaker.recordSuccess(now);

    this.totalSuccesses += 1;
    this.totalLatencyMs += latency;
    this.activeProvider = provider.config.url;
    provider.lastSelectedAt = now;
    this.emitTelemetry();
  }

  private applyFailure(provider: ProviderRuntime, error?: unknown): void {
    const now = this.nowFn();

    provider.requests += 1;
    provider.failures += 1;
    provider.lastFailureAt = now;
    provider.lastError =
      error instanceof Error ? error.message : String(error ?? 'Unknown error');
    provider.breaker.recordFailure(now);

    this.totalFailures += 1;
    this.emitTelemetry();
  }

  private toProviderStatus(
    provider: ProviderRuntime,
    now: number
  ): ProviderStatus {
    const state = provider.breaker.state;
    return {
      url: provider.config.url,
      name: provider.config.name,
      type: provider.config.type,
      weight: provider.config.weight,
      state,
      circuitBreakerState: state,
      isHealthy: state !== CIRCUIT_STATES.OPEN,
      available: provider.breaker.isAvailable(now),
      latencyEmaMs:
        provider.latency.value !== null
          ? Math.round(provider.latency.value)
          : null,
      latencySamples: provider.latency.samples,
      lastLatencyMs: provider.lastLatencyMs,
      errorRateEwma: Number(provider.breaker.errorRateEwmaValue.toFixed(4)),
      errorRate: Number(provider.breaker.errorRate.toFixed(4)),
      requests: provider.requests,
      successes: provider.successes,
      failures: provider.failures,
      consecutiveFailures: provider.breaker.consecutiveFailureCount,
      inFlight: provider.inFlight,
      lastSelectedAt: provider.lastSelectedAt,
      lastSuccessAt: provider.lastSuccessAt,
      lastFailureAt: provider.lastFailureAt,
      lastError: provider.lastError,
    };
  }

  private emitTelemetry(): void {
    if (this.telemetryListeners.size === 0) return;
    const snapshot = this.getStatus();
    for (const listener of this.telemetryListeners) {
      try {
        listener(snapshot);
      } catch {
        // Telemetry must never break request routing.
      }
    }
  }
}

export function createRpcLoadBalancer(
  providers: Array<RpcProviderConfig | string> = getDefaultProviders(),
  options: RpcLoadBalancerOptions = {}
): RpcLoadBalancer {
  return new RpcLoadBalancer(providers, options);
}

export const createLoadBalancer = createRpcLoadBalancer;

export const rpcLoadBalancer = new RpcLoadBalancer();

export default rpcLoadBalancer;
