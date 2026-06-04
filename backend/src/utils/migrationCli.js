#!/usr/bin/env node

import MigrationService from '../services/migrationService.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MigrationCLI {
  constructor() {
    this.migrationService = new MigrationService();
  }

  async init() {
    await this.migrationService.initialize();
    console.log('✅ Migration system initialized');
    await this.migrationService.close();
  }

  async status() {
    await this.migrationService.initialize();
    const status = await this.migrationService.getMigrationStatus();

    console.log('\n📊 Migration Status:');
    console.log(`Total migrations: ${status.totalMigrations}`);
    console.log(`Applied migrations: ${status.appliedMigrations}`);
    console.log(`Pending migrations: ${status.pendingMigrations}`);

    if (status.validationErrors.length > 0) {
      console.log('\n❌ Validation errors:');
      status.validationErrors.forEach((error) => console.log(`  - ${error}`));
    }

    if (status.lastMigration) {
      console.log(
        `\nLast migration: ${status.lastMigration.version} at ${status.lastMigration.applied_at}`
      );
    }

    await this.migrationService.close();
  }

  async create(description) {
    const timestamp = Date.now();
    const version = timestamp.toString();
    const sanitizedDescription = description
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_');

    const upFile = `${timestamp}_${sanitizedDescription}.up.sql`;
    const downFile = `${timestamp}_${sanitizedDescription}.down.sql`;

    const migrationsPath = this.migrationService.migrationsPath;

    // Create migration files
    const fs = await import('fs');
    const path = await import('path');

    fs.writeFileSync(
      path.join(migrationsPath, upFile),
      `-- Migration: ${description}\n-- Version: ${version}\n\n-- Add your SQL here\n\n`
    );

    fs.writeFileSync(
      path.join(migrationsPath, downFile),
      `-- Rollback: ${description}\n-- Version: ${version}\n\n-- Add your rollback SQL here\n\n`
    );

    console.log(`✅ Created migration files:`);
    console.log(`  - ${upFile}`);
    console.log(`  - ${downFile}`);
  }

  async up(dryRun = false) {
    await this.migrationService.initialize();

    console.log(
      dryRun
        ? '\n🔍 Dry run mode - no changes will be applied'
        : '\n⬆️  Running migrations'
    );

    const results = await this.migrationService.migrateUp(dryRun);

    results.forEach((result) => {
      if (result.dryRun) {
        console.log(
          `\n📋 Would apply migration ${result.migration.version}: ${result.migration.description}`
        );
        if (result.warnings.length > 0) {
          result.warnings.forEach((warning) => console.log(`  ⚠️  ${warning}`));
        }
      } else if (result.success) {
        console.log(
          `✅ Migration ${result.migration.version} applied successfully (${result.executionTime}ms)`
        );
        if (result.warnings.length > 0) {
          result.warnings.forEach((warning) => console.log(`  ⚠️  ${warning}`));
        }
      } else {
        console.log(
          `❌ Migration ${result.migration.version} failed: ${result.error}`
        );
        if (result.rollbackAttempted) {
          console.log(
            result.rollbackSuccess
              ? '  🔄 Rollback successful'
              : `  ❌ Rollback failed: ${result.rollbackError}`
          );
        }
      }
    });

    await this.migrationService.close();
  }

  async down(targetVersion = null, dryRun = false) {
    await this.migrationService.initialize();

    console.log(
      dryRun
        ? '\n🔍 Dry run mode - no changes will be applied'
        : '\n⬇️  Rolling back migrations'
    );

    const results = await this.migrationService.migrateDown(
      targetVersion,
      dryRun
    );

    results.forEach((result) => {
      if (result.dryRun) {
        console.log(
          `\n📋 Would rollback migration ${result.migration.version}: ${result.migration.description}`
        );
        if (result.warnings.length > 0) {
          result.warnings.forEach((warning) => console.log(`  ⚠️  ${warning}`));
        }
      } else if (result.success) {
        console.log(
          `✅ Migration ${result.migration.version} rolled back successfully (${result.executionTime}ms)`
        );
        if (result.warnings.length > 0) {
          result.warnings.forEach((warning) => console.log(`  ⚠️  ${warning}`));
        }
      } else {
        console.log(
          `❌ Rollback for migration ${result.migration.version} failed: ${result.error}`
        );
      }
    });

    await this.migrationService.close();
  }

  async validate() {
    await this.migrationService.initialize();

    const { errors, upFiles } =
      await this.migrationService.validateMigrationFiles();

    if (errors.length === 0) {
      console.log('✅ All migration files are valid');
      console.log(`Found ${upFiles.length} migration files`);
    } else {
      console.log('❌ Migration validation failed:');
      errors.forEach((error) => console.log(`  - ${error}`));
    }

    await this.migrationService.close();
  }

  async history() {
    await this.migrationService.initialize();

    const migrations = await this.migrationService.getAppliedMigrations();

    console.log('\n📜 Migration History:');
    if (migrations.length === 0) {
      console.log('No migrations applied yet');
    } else {
      migrations.forEach((migration) => {
        console.log(
          `  ${migration.version} - ${migration.applied_at} (${migration.execution_time}ms) - ${migration.status}`
        );
      });
    }

    await this.migrationService.close();
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const cli = new MigrationCLI();

  try {
    switch (command) {
      case 'init':
        await cli.init();
        break;

      case 'status':
        await cli.status();
        break;

      case 'create':
        if (!args[1]) {
          console.error('❌ Please provide a migration description');
          process.exit(1);
        }
        await cli.create(args[1]);
        break;

      case 'up':
        const dryRunUp = args.includes('--dry-run');
        await cli.up(dryRunUp);
        break;

      case 'down':
        const targetVersion = args.find((arg) => !arg.startsWith('--')) || null;
        const dryRunDown = args.includes('--dry-run');
        await cli.down(targetVersion, dryRunDown);
        break;

      case 'validate':
        await cli.validate();
        break;

      case 'history':
        await cli.history();
        break;

      default:
        console.log(`
🚀 Migration CLI

Usage: node migration-cli.js <command> [options]

Commands:
  init                    Initialize migration system
  status                  Show migration status
  create <description>    Create new migration files
  up [--dry-run]         Run pending migrations
  down [version] [--dry-run]  Rollback migrations
  validate               Validate migration files
  history                Show migration history

Examples:
  node migration-cli.js init
  node migration-cli.js create "add_users_table"
  node migration-cli.js up
  node migration-cli.js up --dry-run
  node migration-cli.js down
  node migration-cli.js down 1234567890 --dry-run
  node migration-cli.js status
  node migration-cli.js validate
        `);
        break;
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default MigrationCLI;
