const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export default {
  memoryDegradedThresholdPercent: parsePositiveInt(
    process.env.HEALTH_MEMORY_DEGRADED_PCT,
    95
  ),
  dependencyCheckTimeoutMs: parsePositiveInt(
    process.env.HEALTH_CHECK_TIMEOUT_MS,
    3000
  ),
  sorobanCliCommand: process.env.SOROBAN_CLI || 'soroban',
};
