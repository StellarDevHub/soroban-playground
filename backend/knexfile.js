import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  development: {
    client: 'sqlite3',
    connection: {
      filename: path.join(__dirname, 'src', 'database', 'database.sqlite'),
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, 'src', 'database', 'migrations'),
    },
  },
  test: {
    client: 'sqlite3',
    connection: {
      filename: ':memory:',
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, 'src', 'database', 'migrations'),
    },
  },
  production: {
    client: 'sqlite3',
    connection: {
      filename: path.join(__dirname, 'src', 'database', 'database.sqlite'),
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, 'src', 'database', 'migrations'),
    },
  },
};
