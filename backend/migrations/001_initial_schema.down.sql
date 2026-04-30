-- Rollback: Initial database schema
-- Version: 001

-- Remove indexes
DROP INDEX IF EXISTS idx_projects_user_id;
DROP INDEX IF EXISTS idx_users_email;
DROP INDEX IF EXISTS idx_users_username;

-- Remove tables in reverse order (due to foreign key constraints)
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS users;
