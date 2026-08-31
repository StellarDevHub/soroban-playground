import 'dotenv/config';
import { cleanEnv, str } from 'envalid';

const isProduction = process.env.NODE_ENV === 'production';

const env = cleanEnv(process.env, {
  DATABASE_URL: isProduction ? str() : str({ default: 'sqlite://dev.db' }),
  REDIS_URL: isProduction ? str() : str({ default: 'redis://localhost:6379' }),
  JWT_SECRET: isProduction ? str() : str({ default: 'dev-secret' }),
  SOROBAN_RPC_URL: isProduction ? str() : str({ default: 'http://localhost:8000' }),
  CORS_ALLOWED_ORIGINS: isProduction ? str() : str({ default: '*' }),
});

export default env;
