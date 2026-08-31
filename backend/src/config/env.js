import 'dotenv/config';
import { cleanEnv, str } from 'envalid';

const isProduction = process.env.NODE_ENV === 'production';

let env;
try {
  env = cleanEnv(
    process.env,
    {
      DATABASE_URL: isProduction ? str() : str({ default: 'sqlite://dev.db' }),
      REDIS_URL: isProduction ? str() : str({ default: 'redis://localhost:6379' }),
      JWT_SECRET: isProduction ? str() : str({ default: 'dev-secret' }),
      SOROBAN_RPC_URL: isProduction ? str() : str({ default: 'http://localhost:8000' }),
      CORS_ALLOWED_ORIGINS: isProduction ? str() : str({ default: '*' }),
    },
    {
      reporter: ({ errors }) => {
        const lines = Object.keys(errors).map(
          (name) => `  ${name}: ${errors[name].message}`
        );
        return `Invalid environment variables:\n${lines.join('\n')}`;
      },
    }
  );
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

export default env;
