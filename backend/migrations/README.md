# Migration System

A comprehensive database migration system with rollback support, validation, and tracking.

## Features

- ✅ **Up/Down Migrations**: Every migration has corresponding rollback
- ✅ **Checksum Verification**: Detects modified migrations
- ✅ **Dry-Run Support**: Preview changes without executing
- ✅ **Migration Validation**: Pre/post migration checks
- ✅ **Automated Rollback**: Auto-rollback on failure
- ✅ **Status Tracking**: Complete migration history
- ✅ **CLI Interface**: Command-line management
- ✅ **REST API**: HTTP endpoints for migration management

## File Convention

Migrations follow the naming convention: `{timestamp}_{description}.{direction}.sql`

- `timestamp`: Unix timestamp for ordering
- `description`: Snake_case description of the migration
- `direction`: `up` for applying, `down` for rolling back

Example:
```
1234567890_create_users_table.up.sql
1234567890_create_users_table.down.sql
```

## CLI Usage

```bash
# Initialize migration system
node src/utils/migrationCli.js init

# Create new migration
node src/utils/migrationCli.js create "add_user_profiles"

# Run pending migrations
node src/utils/migrationCli.js up

# Dry-run (preview only)
node src/utils/migrationCli.js up --dry-run

# Rollback last migration
node src/utils/migrationCli.js down

# Rollback to specific version
node src/utils/migrationCli.js down 1234567890

# Check status
node src/utils/migrationCli.js status

# Validate migration files
node src/utils/migrationCli.js validate

# View history
node src/utils/migrationCli.js history
```

## API Endpoints

- `GET /api/migrations/status` - Get migration status
- `GET /api/migrations/history` - Get migration history
- `GET /api/migrations/validate` - Validate migration files
- `POST /api/migrations/up` - Run migrations (body: `{dryRun: boolean}`)
- `POST /api/migrations/down` - Rollback migrations (body: `{targetVersion?: string, dryRun: boolean}`)

## Database Schema

The system tracks migrations in the `_schema_migrations` table:

```sql
CREATE TABLE _schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version VARCHAR(255) NOT NULL UNIQUE,
  checksum VARCHAR(64) NOT NULL,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  execution_time INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'applied'
);
```

## Testing

Run the migration tests:

```bash
npm run test:migrations
```

Tests cover:
- Migration file validation
- Migration execution and rollback
- Checksum verification
- Dry-run functionality
- Status tracking
- SQL validation

## Security Features

- **Checksum Detection**: Prevents modified migrations from being applied
- **Destructive Operation Warnings**: Alerts for potentially dangerous SQL
- **Transaction Wrapping**: Ensures atomic migration execution
- **Rollback on Failure**: Automatically attempts rollback on migration failure

## Error Handling

The system provides detailed error messages and attempts automatic recovery:
- Validation errors prevent migration execution
- Failed migrations trigger automatic rollback attempts
- Rollback failures are logged and reported
- All errors include context and suggested actions
