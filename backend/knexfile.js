import path from 'path';
import { fileURLToPath } from 'url';

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

/**
 * Resolve the database client from the DATABASE_CLIENT environment variable.
 *
 * Supported values:
 *   pg             – PostgreSQL (production default)
 *   better-sqlite3 – SQLite via better-sqlite3 (fast, synchronous)
 *   sqlite3        – SQLite via sqlite3 (legacy, async; used when better-sqlite3
 *                    is not available or explicitly requested)
 *
 * Falls back to 'sqlite3' when DATABASE_CLIENT is unset so that the existing
 * local-dev and CI setup continues to work without any changes.
 */
function resolveClient(defaultClient = 'sqlite3') {
  const client = process.env.DATABASE_CLIENT || defaultClient;
  const supported = ['pg', 'better-sqlite3', 'sqlite3'];
  if (!supported.includes(client)) {
    throw new Error(
      `Unsupported DATABASE_CLIENT "${client}". Supported values: ${supported.join(', ')}`
    );
  }
  return client;
}

/**
 * Build the connection config for the resolved client.
 *
 * For SQLite:
 *   Uses DATABASE_URL as the file path when set, otherwise defaults to a
 *   per-environment filename.
 *
 * For PostgreSQL:
 *   Uses DATABASE_URL (e.g. postgres://user:pass@host:5432/dbname) when set,
 *   otherwise assembles the config from individual DATABASE_* env vars.
 */
function resolveConnection(client, sqliteFallbackFile) {
  if (client === 'pg') {
    if (process.env.DATABASE_URL) {
      return {
        connectionString: process.env.DATABASE_URL,
        ssl:
          process.env.DATABASE_SSL === 'true'
            ? { rejectUnauthorized: false }
            : undefined,
      };
    }
    return {
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT || '5432', 10),
      database: process.env.DATABASE_NAME || 'soroban_playground',
      user: process.env.DATABASE_USER || 'postgres',
      password: process.env.DATABASE_PASSWORD || '',
      ssl:
        process.env.DATABASE_SSL === 'true'
          ? { rejectUnauthorized: false }
          : undefined,
    };
  }

  // SQLite (sqlite3 or better-sqlite3)
  const filename =
    process.env.DATABASE_URL ||
    path.join(_dirname, 'src', 'database', sqliteFallbackFile);

  return { filename };
}

const migrationsDir = path.join(_dirname, 'src', 'database', 'migrations');

export default {
  development: {
    client: resolveClient('sqlite3'),
    connection: resolveConnection(
      resolveClient('sqlite3'),
      'database.sqlite'
    ),
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 10,
    },
    migrations: {
      directory: migrationsDir,
    },
  },

  test: {
    client: resolveClient('sqlite3'),
    // For SQLite in-memory testing, we skip the DATABASE_URL override so that
    // the test suite always gets a clean, isolated in-memory DB.  When
    // DATABASE_CLIENT=pg the value of DATABASE_URL is used for the PG connection.
    connection:
      resolveClient('sqlite3') === 'pg'
        ? resolveConnection('pg', ':memory:')
        : { filename: ':memory:' },
    useNullAsDefault: true,
    migrations: {
      directory: migrationsDir,
    },
  },

  production: {
    client: resolveClient('pg'),
    connection: resolveConnection(resolveClient('pg'), 'database.sqlite'),
    useNullAsDefault: true,
    pool: {
      min: 2,
      max: 20,
    },
    migrations: {
      directory: migrationsDir,
    },
    acquireConnectionTimeout: 10000,
  },
};
