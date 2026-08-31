import 'dotenv/config';
import { cleanEnv, str } from 'envalid';

if (process.env.NODE_ENV === 'production') {
  for (const key of ['JWT_SECRET', 'DATABASE_URL', 'REDIS_URL', 'SOROBAN_RPC_URL', 'CORS_ALLOWED_ORIGINS']) {
    if (!process.env[key]) {
      console.error(`Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }
}

const env = cleanEnv(process.env, {
  DATABASE_URL: str({ default: 'sqlite://dev.db' }),
  REDIS_URL: str({ default: 'redis://localhost:6379' }),
  JWT_SECRET: str({ default: 'dev-secret' }),
  SOROBAN_RPC_URL: str({ default: 'http://localhost:8000' }),
  CORS_ALLOWED_ORIGINS: str({ default: '*' }),
});

export default env;
