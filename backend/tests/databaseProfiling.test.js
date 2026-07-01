import {
  initializeDatabase,
  closeDatabase,
} from '../src/database/connection.js';

describe('Database Profiling and Slow Query Logging', () => {
  let db;
  let originalWarn;
  let consoleWarnings = [];

  beforeAll(async () => {
    // Set threshold to 0 to catch all queries
    process.env.SLOW_QUERY_THRESHOLD_MS = '0';
    db = await initializeDatabase({ seedSampleData: false });

    originalWarn = console.warn;
    console.warn = jest.fn((msg) => {
      consoleWarnings.push(msg);
    });
  });

  afterAll(async () => {
    await closeDatabase();
    console.warn = originalWarn;
    delete process.env.SLOW_QUERY_THRESHOLD_MS;
  });

  beforeEach(() => {
    consoleWarnings = [];
  });

  it('should profile slow queries and output trace and plan', async () => {
    await db.run(
      'CREATE TABLE IF NOT EXISTS test_profiling (id INTEGER PRIMARY KEY, name TEXT)'
    );
    await db.run('INSERT INTO test_profiling (name) VALUES (?)', ['test']);

    await db.get('SELECT * FROM test_profiling WHERE id = ?', [1]);

    const selectWarnings = consoleWarnings.filter(
      (w) => typeof w === 'string' && w.includes('SELECT * FROM test_profiling')
    );

    expect(selectWarnings.length).toBeGreaterThan(0);

    const parsedWarnings = selectWarnings.map((w) => JSON.parse(w));

    const slowQueryLog = parsedWarnings.find(
      (w) => w.message === 'Slow query detected'
    );
    const queryPlanLog = parsedWarnings.find(
      (w) => w.message === 'Slow query plan'
    );

    expect(slowQueryLog).toBeDefined();
    expect(slowQueryLog.traceId).toBeDefined();
    expect(slowQueryLog.durationMs).toBeGreaterThanOrEqual(0);

    expect(queryPlanLog).toBeDefined();
    expect(queryPlanLog.traceId).toEqual(slowQueryLog.traceId);
    expect(queryPlanLog.plan).toBeDefined();
  });

  it('should run in WAL journal mode to prevent reader locks during index building', async () => {
    const row = await db.get('PRAGMA journal_mode');
    expect(row.journal_mode).toBe('wal');
  });
});
