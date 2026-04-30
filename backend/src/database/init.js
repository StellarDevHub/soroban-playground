import { initializeDatabase } from './connection.js';

async function initDatabase() {
  try {
    console.log('Initializing database...');
    const db = await initializeDatabase();
    console.log('Database initialized successfully!');
    console.log('Sample data inserted. Ready for search operations.');
    process.exit(0);
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  }
}

initDatabase();
