-- Copyright (c) 2026 StellarDevTools
-- SPDX-License-Identifier: MIT

-- Migration: Drop job marketplace tables
-- Description: Reverts the job marketplace schema

-- Drop view first
DROP VIEW IF EXISTS job_statistics;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS disputes CASCADE;
DROP TABLE IF EXISTS user_certifications CASCADE;
DROP TABLE IF EXISTS user_skills CASCADE;
DROP TABLE IF EXISTS job_milestones CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;

-- Drop indexes (automatically dropped with tables, but explicit for clarity)
DROP INDEX IF EXISTS idx_jobs_client;
DROP INDEX IF EXISTS idx_jobs_freelancer;
DROP INDEX IF EXISTS idx_jobs_status;
DROP INDEX IF EXISTS idx_jobs_created_at;
DROP INDEX IF EXISTS idx_job_milestones_job_id;
DROP INDEX IF EXISTS idx_user_skills_user_address;
DROP INDEX IF EXISTS idx_user_skills_skill;
DROP INDEX IF EXISTS idx_user_certifications_user_address;
DROP INDEX IF EXISTS idx_disputes_job_id;
DROP INDEX IF EXISTS idx_disputes_raised_by;
