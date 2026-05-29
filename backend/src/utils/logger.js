// Simple logger replacement to avoid external winston dependency
const logger = {
  info: (...args) => {
    // Optionally output to console in development
    if (process.env.NODE_ENV !== 'test') console.info(...args);
  },
  error: (...args) => {
    if (process.env.NODE_ENV !== 'test') console.error(...args);
  },
  debug: (...args) => {
    if (process.env.NODE_ENV !== 'test') console.debug(...args);
  },
};
export { logger };
export default logger;
