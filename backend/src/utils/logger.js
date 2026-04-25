import { createLogger, format, transports } from 'winston';

const { combine, timestamp, errors, splat, printf } = format;

const serializeMeta = (meta) => {
  if (!meta || Object.keys(meta).length === 0) {
    return '';
  }

  return ` ${JSON.stringify(meta)}`;
};

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp(),
    errors({ stack: true }),
    splat(),
    printf(({ timestamp, level, message, stack, ...meta }) => {
      const metadata = serializeMeta(meta);
      const errorStack = stack ? ` ${stack}` : '';
      return `${timestamp} [${level}] ${message}${metadata}${errorStack}`;
    })
  ),
  transports: [new transports.Console()],
});

export default logger;
