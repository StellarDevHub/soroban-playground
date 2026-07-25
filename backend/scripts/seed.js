import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import { faker } from '@faker-js/faker';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const DEFAULT_DB_PATH = path.join(dirname, '../data/soroban_playground.sqlite');

/**
 * Validate and normalise numeric seed options.
 * Returns an object with sanitised values and any validation errors found.
 *
 * @param {object} options
 * @returns {{ valid: boolean, errors: string[], users: number, projects: number, files: number, dbPath: string }}
 */
function validateOptions(options = {}) {
  const errors = [];

  const toPositiveInt = (value, name, fallback) => {
    if (value === undefined || value === null) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      errors.push(
        `Invalid value for ${name}: ${JSON.stringify(value)} — must be a positive integer; using default (${fallback})`
      );
      return fallback;
    }
    return parsed;
  };

  const users = toPositiveInt(options.users, 'users', 50);
  const projects = toPositiveInt(options.projects, 'projects', 200);
  const files = toPositiveInt(options.files, 'files', 500);

  const dbPath =
    options.dbPath &&
    typeof options.dbPath === 'string' &&
    options.dbPath.trim()
      ? options.dbPath.trim()
      : DEFAULT_DB_PATH;

  return { valid: errors.length === 0, errors, users, projects, files, dbPath };
}

async function seedDatabase(options = {}) {
  const validated = validateOptions(options);

  if (validated.errors.length > 0) {
    for (const warning of validated.errors) {
      console.warn(`[seed] WARNING: ${warning}`);
    }
  }

  const {
    dbPath,
    users: numUsers,
    projects: numProjects,
    files: numFiles,
  } = validated;

  console.log(`Starting database seed at ${dbPath}`);
  console.log(
    `Target: ${numUsers} users, ${numProjects} projects, ${numFiles} files`
  );

  let db;
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
  } catch (openErr) {
    throw new Error(
      `Failed to open database at "${dbPath}": ${openErr.message}`
    );
  }

  await db.run('PRAGMA foreign_keys = OFF;');
  const startTime = Date.now();

  try {
    await db.run('BEGIN TRANSACTION');

    // Clean existing mock data
    await db.run('DELETE FROM files');
    await db.run('DELETE FROM projects');
    await db.run('DELETE FROM users');

    // Seed Users
    console.log('Seeding users...');
    let currentUserChunk = [];
    let currentUserParams = [];

    for (let i = 0; i < numUsers; i++) {
      currentUserChunk.push('(?, ?, ?, ?)');
      currentUserParams.push(
        faker.internet.userName(),
        faker.internet.email(),
        faker.internet.password(),
        faker.helpers.arrayElement(['developer', 'admin', 'guest'])
      );

      if (currentUserChunk.length === 50 || i === numUsers - 1) {
        await db.run(
          `INSERT INTO users (username, email, password_hash, role) VALUES ${currentUserChunk.join(', ')}`,
          currentUserParams
        );
        currentUserChunk = [];
        currentUserParams = [];
      }
    }

    // Fetch user IDs for foreign keys
    const users = await db.all('SELECT id, username FROM users');
    if (users.length === 0) {
      throw new Error('No users were inserted; cannot seed projects or files.');
    }

    // Seed Projects
    console.log('Seeding projects...');
    let currentProjectChunk = [];
    let currentProjectParams = [];

    for (let i = 0; i < numProjects; i++) {
      const creator = faker.helpers.arrayElement(users);
      const goal = faker.number.int({ min: 1000, max: 1000000 });
      const current = faker.number.int({ min: 0, max: goal });

      currentProjectChunk.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      currentProjectParams.push(
        faker.commerce.productName(),
        faker.commerce.productDescription(),
        faker.helpers.arrayElement([
          'DeFi',
          'NFT',
          'Infrastructure',
          'Payments',
          'Gaming',
        ]),
        faker.helpers.arrayElement([
          'draft',
          'active',
          'funded',
          'completed',
          'cancelled',
        ]),
        creator.id,
        creator.username,
        goal,
        current,
        (current / goal) * 100,
        JSON.stringify([
          faker.word.sample(),
          faker.word.sample(),
          faker.word.sample(),
        ])
      );

      if (currentProjectChunk.length === 50 || i === numProjects - 1) {
        await db.run(
          `INSERT INTO projects (title, description, category, status, creator_id, creator_name, funding_goal, current_funding, completion_rate, tags) VALUES ${currentProjectChunk.join(', ')}`,
          currentProjectParams
        );
        currentProjectChunk = [];
        currentProjectParams = [];
      }
    }

    // Fetch project IDs
    const projects = await db.all('SELECT id FROM projects');
    if (projects.length === 0) {
      throw new Error('No projects were inserted; cannot seed files.');
    }

    // Seed Files
    console.log('Seeding files...');
    let currentFileChunk = [];
    let currentFileParams = [];

    for (let i = 0; i < numFiles; i++) {
      const project = faker.helpers.arrayElement(projects);
      const uploader = faker.helpers.arrayElement(users);

      currentFileChunk.push('(?, ?, ?, ?, ?, ?)');
      currentFileParams.push(
        project.id,
        uploader.id,
        faker.system.fileName(),
        faker.system.filePath(),
        faker.system.mimeType(),
        faker.number.int({ min: 1024, max: 10485760 })
      );

      if (currentFileChunk.length === 50 || i === numFiles - 1) {
        await db.run(
          `INSERT INTO files (project_id, uploader_id, filename, filepath, mimetype, size_bytes) VALUES ${currentFileChunk.join(', ')}`,
          currentFileParams
        );
        currentFileChunk = [];
        currentFileParams = [];
      }
    }

    await db.run('COMMIT');
    const duration = Date.now() - startTime;
    console.log(`Seeding completed successfully in ${duration}ms.`);
  } catch (err) {
    console.error('Seeding failed, rolling back transaction:', err.message);
    try {
      await db.run('ROLLBACK');
    } catch (rollbackErr) {
      console.error('ROLLBACK also failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    try {
      await db.run('PRAGMA foreign_keys = ON;');
    } catch (_) {
      // Best-effort; ignore if db is already in a bad state
    }
    try {
      await db.close();
    } catch (closeErr) {
      console.error('Failed to close database connection:', closeErr.message);
    }
  }
}

// Support direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--users') {
      options.users = parseInt(args[++i], 10);
    } else if (args[i] === '--projects') {
      options.projects = parseInt(args[++i], 10);
    } else if (args[i] === '--files') {
      options.files = parseInt(args[++i], 10);
    } else if (args[i] === '--db') {
      options.dbPath = args[++i];
    } else {
      console.warn(`[seed] Unknown argument: ${args[i]}`);
    }
  }

  seedDatabase(options).catch((err) => {
    console.error('[seed] Fatal error:', err.message);
    process.exit(1);
  });
}

export { seedDatabase, validateOptions };
