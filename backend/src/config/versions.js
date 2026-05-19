/**
 * API Version Configuration
 */
export const versions = {
  v1: {
    id: 'v1',
    status: 'deprecated',
    releaseDate: '2025-01-01',
    deprecationDate: '2026-04-20',
    sunsetDate: '2026-12-31',
    links: [{ rel: 'migration-guide', href: '/docs/migration/v1-to-v2' }],
  },
  v2: {
    id: 'v2',
    status: 'stable',
    releaseDate: '2026-04-20',
    deprecationDate: null,
    sunsetDate: null,
    links: [],
  },
};

export const DEFAULT_VERSION = 'v1';
export const CURRENT_VERSION = 'v2';
