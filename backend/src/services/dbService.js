import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DB_PATH = path.join(
  __dirname,
  '../../data/soroban_playground.sqlite'
);

let db = null;
let dbPath = null;

export async function getDatabase() {
  if (db) return db;

  const SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(__dirname, '../../node_modules/sql.js/dist', file),
  });

  dbPath = process.env.MIGRATION_DB_PATH || DEFAULT_DB_PATH;
  await fs.mkdir(path.dirname(dbPath), { recursive: true });

  let databaseBytes = null;
  try {
    databaseBytes = await fs.readFile(dbPath);
  } catch {
    databaseBytes = null;
  }

  db = databaseBytes ? new SQL.Database(databaseBytes) : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  return db;
}

export async function saveDatabase() {
  if (!db || !dbPath) return;
  const data = db.export();
  await fs.writeFile(dbPath, Buffer.from(data));
}

export async function closeDatabase() {
  if (!db) return;
  await saveDatabase();
  db.close();
  db = null;
}
