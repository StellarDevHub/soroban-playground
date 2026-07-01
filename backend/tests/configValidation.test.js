import { createConfig } from '../src/config/index.js';

const createLogger = () => ({
  warn: jest.fn(),
});

describe('environment config validation', () => {
  it('limits compile requests to 10 per minute per IP by default', () => {
    const config = createConfig({}, { reportWarnings: false });

    expect(config.rateLimit.compile.max).toBe(10);
    expect(config.rateLimit.compile.windowMs).toBe(60000);
  });

  it('uses defaults without warnings when optional env values are missing', () => {
    const logger = createLogger();
    const config = createConfig({}, { logger });

    expect(config.app.port).toBe(5000);
    expect(config.app.env).toBe('development');
    expect(config.rateLimit.global.max).toBe(1000);
    expect(config.validation.valid).toBe(true);
    expect(config.validation.warnings).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back and reports malformed integer values', () => {
    const logger = createLogger();
    const config = createConfig(
      {
        PORT: 'not-a-port',
        GLOBAL_RATE_LIMIT_MAX: '0',
        COMPILE_TIMEOUT_MS: '30s',
      },
      { logger }
    );

    expect(config.app.port).toBe(5000);
    expect(config.rateLimit.global.max).toBe(1000);
    expect(config.compile.timeoutMs).toBe(120000);
    expect(config.validation.valid).toBe(false);
    expect(config.validation.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('PORT='),
        expect.stringContaining('GLOBAL_RATE_LIMIT_MAX='),
        expect.stringContaining('COMPILE_TIMEOUT_MS='),
      ])
    );
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });

  it('guards numeric ranges for ports and tracing sample rates', () => {
    const logger = createLogger();
    const config = createConfig(
      {
        APP_PORT: '70000',
        TRACING_SAMPLE_RATE_SUCCESS: '2',
        TRACING_SAMPLE_RATE_ERRORS: '-0.1',
      },
      { logger }
    );

    expect(config.app.port).toBe(5000);
    expect(config.tracing.sampleRateSuccess).toBe(0.1);
    expect(config.tracing.sampleRateErrors).toBe(1.0);
    expect(config.validation.warnings).toHaveLength(3);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('must be <= 65535')
    );
  });

  it('accepts common boolean forms for tracing enabled', () => {
    expect(
      createConfig({ TRACING_ENABLED: 'off' }, { reportWarnings: false })
        .tracing.enabled
    ).toBe(false);
    expect(
      createConfig({ TRACING_ENABLED: 'YES' }, { reportWarnings: false })
        .tracing.enabled
    ).toBe(true);
  });

  it('falls back with feedback for invalid booleans', () => {
    const logger = createLogger();
    const config = createConfig(
      {
        TRACING_ENABLED: 'sometimes',
      },
      { logger }
    );

    expect(config.tracing.enabled).toBe(true);
    expect(config.validation.warnings).toEqual([
      expect.stringContaining('TRACING_ENABLED='),
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('expected a boolean')
    );
  });

  it('trims string values and falls back for blank strings', () => {
    const config = createConfig(
      {
        APP_ENV: '   ',
        NODE_ENV: ' test ',
        DEFAULT_NETWORK: ' futurenet ',
        COMPILE_COMMAND: '',
      },
      { reportWarnings: false }
    );

    expect(config.app.env).toBe('test');
    expect(config.network.default).toBe('futurenet');
    expect(config.compile.command).toBe(
      'cargo build --target wasm32-unknown-unknown --release'
    );
  });
});
