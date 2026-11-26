import { readFile } from 'fs/promises';
import initSqlJs from 'sql.js';

const databasePath = process.argv[2];
if (!databasePath) {
  throw new Error('Usage: node verifySqliteIntegrity.js <database-path>');
}

const SQL = await initSqlJs();
const database = new SQL.Database(await readFile(databasePath));

try {
  const [result] = database.exec('PRAGMA integrity_check');
  if (result?.values?.length !== 1 || result.values[0][0] !== 'ok') {
    throw new Error(
      `Restored SQLite integrity check failed: ${JSON.stringify(result?.values)}`
    );
  }
  console.log(`Restore verification passed: ${databasePath}`);
} finally {
  database.close();
}
