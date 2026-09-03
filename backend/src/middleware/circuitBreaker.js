// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

export const CIRCUIT_STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

export class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || 'default-breaker';
    this.failureThreshold = options.failureThreshold || 5;
    this.failureRateThreshold = options.failureRateThreshold || 0.5;
    this.resetTimeoutMs = options.resetTimeoutMs || 30000;
    this.halfOpenMaxRequests = options.halfOpenMaxRequests || 3;
    this.successThreshold = options.successThreshold || 2;

    this.state = CIRCUIT_STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.totalRequests = 0;
    this.halfOpenRequests = 0;
    this.nextAttempt = 0;
    this.lastStateChange = Date.now();
  }

  getState() {
    if (this.state === CIRCUIT_STATES.OPEN && Date.now() >= this.nextAttempt) {
      this.transitionTo(CIRCUIT_STATES.HALF_OPEN);
    }
    return this.state;
  }

  transitionTo(newState) {
    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === CIRCUIT_STATES.HALF_OPEN) {
      this.halfOpenRequests = 0;
      this.successCount = 0;
    } else if (newState === CIRCUIT_STATES.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
      this.totalRequests = 0;
      this.halfOpenRequests = 0;
    } else if (newState === CIRCUIT_STATES.OPEN) {
      this.nextAttempt = Date.now() + this.resetTimeoutMs;
    }
  }

  recordSuccess() {
    this.totalRequests += 1;
    if (this.state === CIRCUIT_STATES.HALF_OPEN) {
      this.successCount += 1;
      if (this.successCount >= this.successThreshold) {
        this.transitionTo(CIRCUIT_STATES.CLOSED);
      }
    } else if (this.state === CIRCUIT_STATES.CLOSED) {
      if (this.failureCount > 0) {
        this.failureCount -= 1;
      }
    }
  }

  recordFailure() {
    this.totalRequests += 1;
    this.failureCount += 1;

    if (this.state === CIRCUIT_STATES.HALF_OPEN) {
      this.transitionTo(CIRCUIT_STATES.OPEN);
    } else if (this.state === CIRCUIT_STATES.CLOSED) {
      const failureRate = this.totalRequests > 0 ? this.failureCount / this.totalRequests : 0;
      if (this.failureCount >= this.failureThreshold || (this.totalRequests >= 5 && failureRate >= this.failureRateThreshold)) {
        this.transitionTo(CIRCUIT_STATES.OPEN);
      }
    }
  }

  canExecute() {
    const currentState = this.getState();
    if (currentState === CIRCUIT_STATES.CLOSED) {
      return true;
    }
    if (currentState === CIRCUIT_STATES.HALF_OPEN) {
      if (this.halfOpenRequests < this.halfOpenMaxRequests) {
        this.halfOpenRequests += 1;
        return true;
      }
      return false;
    }
    return false;
  }

  trip() {
    this.transitionTo(CIRCUIT_STATES.OPEN);
  }

  reset() {
    this.transitionTo(CIRCUIT_STATES.CLOSED);
  }

  async execute(action) {
    if (!this.canExecute()) {
      const error = new Error(`Circuit breaker '${this.name}' is OPEN`);
      error.status = 503;
      error.circuitBreakerOpen = true;
      throw error;
    }

    try {
      const result = await action();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }
}

export function createCircuitBreakerMiddleware(options = {}) {
  const breaker = new CircuitBreaker(options);

  const middleware = (req, res, next) => {
    if (!breaker.canExecute()) {
      res.setHeader('Retry-After', Math.ceil(breaker.resetTimeoutMs / 1000));
      return res.status(503).json({
        success: false,
        error: 'Service Unavailable',
        message: `Upstream service circuit breaker '${breaker.name}' is OPEN`,
        circuitBreakerState: breaker.getState(),
      });
    }

    res.on('finish', () => {
      if (res.statusCode >= 500) {
        breaker.recordFailure();
      } else {
        breaker.recordSuccess();
      }
    });

    return next();
  };

  middleware.breaker = breaker;
  return middleware;
}

export default CircuitBreaker;
