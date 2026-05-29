import { initializeDatabase } from './connection.js';

function parseArgs(argv) {
  return argv.reduce(
    (options, arg, index) => {
      if (arg === '--no-seed') {
        options.seedSampleData = false;
      } else if (arg === '--database') {
        if (!argv[index + 1]) {
          throw new Error('--database requires a file path');
        }
        options.filename = argv[index + 1];
      } else if (arg === '--schema') {
        if (!argv[index + 1]) {
          throw new Error('--schema requires a file path');
        }
        options.schemaPath = argv[index + 1];
      }
      return options;
    },
    { seedSampleData: process.env.SEED_SAMPLE_DATA !== 'false' }
  );
}

export async function initDatabase(options = {}) {
  try {
    console.log('Initializing database...');
    await initializeDatabase(options);
    console.log('Database initialized successfully!');
    console.log(
      options.seedSampleData === false
        ? 'Schema applied without sample data.'
        : 'Sample data inserted. Ready for search operations.'
    );
    return 0;
  } catch (error) {
    console.error('Database initialization failed:', error.message);
    if (error.cause?.message) {
      console.error('Cause:', error.cause.message);
    }
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const exitCode = await initDatabase(parseArgs(process.argv.slice(2)));
    process.exit(exitCode);
  } catch (error) {
    console.error('Invalid database initialization options:', error.message);
    process.exit(1);
  }
}
