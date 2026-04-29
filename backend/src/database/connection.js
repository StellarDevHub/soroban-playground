import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = null;

export async function initializeDatabase() {
  if (db) return db;

  try {
    db = await open({
      filename: path.join(__dirname, 'database.sqlite'),
      driver: sqlite3.Database,
    });

    // Read and execute schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const fs = await import('fs/promises');
    const schema = await fs.readFile(schemaPath, 'utf-8');

    await db.exec(schema);
    console.log('Database initialized successfully');

    return db;
  } catch (error) {
    console.error('Database initialization error:', error);
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
