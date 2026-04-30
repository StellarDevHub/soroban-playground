import express from 'express';
import MigrationService from '../services/migrationService.js';

const router = express.Router();

// Get migration status
router.get('/status', async (req, res) => {
  try {
    const migrationService = new MigrationService();
    await migrationService.initialize();
    
    const status = await migrationService.getMigrationStatus();
    
    await migrationService.close();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get migration history
router.get('/history', async (req, res) => {
  try {
    const migrationService = new MigrationService();
    await migrationService.initialize();
    
    const appliedMigrations = await migrationService.getAppliedMigrations();
    
    await migrationService.close();
    
    res.json({
      success: true,
      data: {
        migrations: appliedMigrations,
        total: appliedMigrations.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Run migrations up
router.post('/up', async (req, res) => {
  try {
    const { dryRun = false } = req.body;
    
    const migrationService = new MigrationService();
    await migrationService.initialize();
    
    const results = await migrationService.migrateUp(dryRun);
    
    await migrationService.close();
    
    res.json({
      success: true,
      data: {
        results,
        dryRun,
        executed: results.filter(r => !r.dryRun).length,
        total: results.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Rollback migrations
router.post('/down', async (req, res) => {
  try {
    const { targetVersion, dryRun = false } = req.body;
    
    const migrationService = new MigrationService();
    await migrationService.initialize();
    
    const results = await migrationService.migrateDown(targetVersion, dryRun);
    
    await migrationService.close();
    
    res.json({
      success: true,
      data: {
        results,
        dryRun,
        targetVersion,
        executed: results.filter(r => !r.dryRun).length,
        total: results.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Validate migration files
router.get('/validate', async (req, res) => {
  try {
    const migrationService = new MigrationService();
    await migrationService.initialize();
    
    const { errors, upFiles } = await migrationService.validateMigrationFiles();
    
    await migrationService.close();
    
    res.json({
      success: true,
      data: {
        valid: errors.length === 0,
        errors,
        totalMigrations: upFiles.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
