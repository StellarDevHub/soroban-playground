import path from 'path';
import fs from 'fs';
import { validateParameterizedQuery } from '../database/safeQuery.js';

/**
 * DatabaseService provides a lightweight wrapper around SQLite3 with async helpers.
 * Dynamic import of the sqlite3 module avoids loading native bindings during Jest tests.
 */
class DatabaseService {
  /**
   * @param {string|null} dbPath Optional custom database file path.
   */
  constructor(dbPath = null) {
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'app.db');
    this.db = null;
    this.ensureDataDirectory();
  }

  /** Ensure the directory for the SQLite file exists. */
  ensureDataDirectory() {
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  async connect() {
    const { default: sqlite3 } = await import('sqlite3');
    const { withCacheBusting } =
      await import('../database/cacheInterceptor.js');
    return new Promise((resolve, reject) => {
      const dbInstance = new sqlite3.Database(this.dbPath, (err) => {
        if (err) reject(err);
        else {
          this.db = withCacheBusting(dbInstance);
          resolve();
        }
      });
    });
  }

  /** Close the database connection if open. */
  async close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /** Run a SQL statement that does not return rows (e.g., INSERT, UPDATE). */
  async run(sql, params = []) {
    validateParameterizedQuery(sql, params);
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  }

  /** Retrieve a single row. */
  async get(sql, params = []) {
    validateParameterizedQuery(sql, params);
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  /** Retrieve all matching rows. */
  async all(sql, params = []) {
    validateParameterizedQuery(sql, params);
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /** Run a callback inside a transaction. */
  async transaction(callback) {
    await this.run('BEGIN TRANSACTION');
    try {
      const result = await callback(this);
      await this.run('COMMIT');
      return result;
    } catch (error) {
      await this.run('ROLLBACK');
      throw error;
    }
  }

  /** Helper to start a transaction without a callback. */
  async beginTransaction() {
    await this.run('BEGIN TRANSACTION');
  }

  /** Helper to commit a transaction started manually. */
  async commit() {
    await this.run('COMMIT');
  }

  /** Alias for SELECT queries – returns all rows. */
  async query(sql, params = []) {
    return this.all(sql, params);
  }
}

// Export a singleton instance for convenience throughout the codebase.
export const databaseService = new DatabaseService();
export default DatabaseService;
