import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = null;

function stripSeedData(schema) {
  return schema.replace(
    /-- Sample data for testing[\s\S]*?;\n\n-- DAO Treasury Tables/,
    '-- Sample data for testing skipped\n\n-- DAO Treasury Tables'
  );
}

function enhanceDatabaseError(error, context) {
  const detail = context ? ` (${context})` : '';
  const enhanced = new Error(
    `Database initialization error${detail}: ${error.message}`
  );
  enhanced.cause = error;
  enhanced.code = error.code;
  return enhanced;
}

export async function initializeDatabase(options = {}) {
  if (db) return db;

  const {
    filename = path.join(__dirname, 'database.sqlite'),
    schemaPath = path.join(__dirname, 'schema.sql'),
    seedSampleData = process.env.SEED_SAMPLE_DATA !== 'false',
  } = options;

  try {
    db = await open({
      filename,
      driver: sqlite3.Database,
    });

    // Read and execute schema
    const fs = await import('fs/promises');
    const rawSchema = await fs.readFile(schemaPath, 'utf-8').catch((error) => {
      throw enhanceDatabaseError(
        error,
        `failed to read schema at ${schemaPath}`
      );
    });

    const schema = seedSampleData ? rawSchema : stripSeedData(rawSchema);

    await db.exec(schema).catch((error) => {
      throw enhanceDatabaseError(
        error,
        `failed to apply schema at ${schemaPath}`
      );
    });
    console.log('Database initialized successfully');

    return db;
  } catch (error) {
    if (db) {
      await db.close().catch(() => {});
      db = null;
    }
    console.error(error.message);
    throw error;
  }
}

export function getDatabase() {
  if (!db) {
    throw new Error(
      'Database not initialized. Call initializeDatabase() first.'
    );
  }
  return db;
}

export async function closeDatabase() {
  if (db) {
    await db.close();
    db = null;
  }
}
