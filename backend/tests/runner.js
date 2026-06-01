/**
 * Robust Integration Test Runner Utility
 * Provides enhanced error handling, retries, and detailed reporting for integration tests.
 */
export class IntegrationTestRunner {
  constructor(baseUrl, options = {}) {
    this.baseUrl = baseUrl;
    this.options = {
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      timeout: options.timeout || 10000,
      verbose: options.verbose || false,
    };
    this.results = [];
  }

  async runTest(name, path, method = 'GET', body = null, headers = {}) {
    let attempt = 0;
    let lastError = null;

    while (attempt < this.options.maxRetries) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.options.timeout
        );

        if (this.options.verbose) {
          console.log(
            `[${name}] Attempt ${attempt + 1}/${this.options.maxRetries}...`
          );
        }

        const response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: body ? JSON.stringify(body) : null,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        let data;
        try {
          data = await response.json();
        } catch {
          data = { message: 'Failed to parse JSON response' };
        }

        if (response.ok) {
          this.logResult(name, true, { status: response.status, data });
          return { success: true, data };
        } else {
          throw new Error(
            `HTTP ${response.status}: ${data.message || response.statusText}`
          );
        }
      } catch (error) {
        attempt++;
        lastError = error;

        if (error.name === 'AbortError') {
          lastError = new Error(
            `Request timed out after ${this.options.timeout}ms`
          );
        }

        if (attempt < this.options.maxRetries) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.options.retryDelay * attempt)
          );
        }
      }
    }

    this.logResult(name, false, { error: lastError.message });

    return { success: false, error: lastError.message };
  }

  logResult(name, success, details) {
    const result = {
      name,
      success,
      timestamp: new Date().toISOString(),
      ...details,
    };
    this.results.push(result);

    if (success) {
      console.log(`✅ [PASS] ${name}`);
    } else {
      console.error(`❌ [FAIL] ${name}: ${details.error}`);
    }
  }

  getSummary() {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.success).length;
    const failed = total - passed;

    return {
      total,
      passed,
      failed,
      successRate: total > 0 ? (passed / total) * 100 : 0,
      results: this.results,
    };
  }
}
