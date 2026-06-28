import fs from 'fs/promises';
import { storePersistedQuery } from '../src/graphql/persistedQueries.js';

const manifestPath =
  process.argv[2] ??
  process.env.PERSISTED_QUERY_MANIFEST ??
  'persisted-queries.json';

async function main() {
  const raw = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  const entries = Array.isArray(manifest)
    ? manifest
    : Object.entries(manifest).map(([hash, query]) => ({ hash, query }));

  for (const entry of entries) {
    const query = typeof entry === 'string' ? entry : entry.query;
    const hash = typeof entry === 'object' ? entry.hash : undefined;
    const registration = await storePersistedQuery(query, hash);
    console.log(`warmed persisted query ${registration.hash}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
