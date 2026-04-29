-- Copyright (c) 2026 StellarDevTools
-- SPDX-License-Identifier: MIT

-- Migration: Create job marketplace tables
-- Description: Sets up the database schema for the job marketplace system

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
    id BIGINT PRIMARY KEY,
    client VARCHAR(56) NOT NULL,
    freelancer VARCHAR(56),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    payment_token VARCHAR(56) NOT NULL,
    total_escrow BIGINT NOT NULL DEFAULT 0,
    released_amount BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'Open',
    required_skills JSONB DEFAULT '[]',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMP,
    completed_at TIMESTAMP
);

-- Job milestones table
CREATE TABLE IF NOT EXISTS job_milestones (
    id BIGSERIAL PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount BIGINT NOT NULL,
    is_released BOOLEAN NOT NULL DEFAULT FALSE,
    milestone_index INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(job_id, milestone_index)
);

-- User skills table
CREATE TABLE IF NOT EXISTS user_skills (
    id BIGSERIAL PRIMARY KEY,
    user_address VARCHAR(56) NOT NULL,
    skill VARCHAR(50) NOT NULL,
    level INTEGER NOT NULL CHECK (level >= 1 AND level <= 5),
    verified_at TIMESTAMP NOT NULL DEFAULT NOW(),
    verified_by VARCHAR(56) NOT NULL,
    UNIQUE(user_address, skill)
);

-- User certifications table
CREATE TABLE IF NOT EXISTS user_certifications (
    id BIGSERIAL PRIMARY KEY,
    user_address VARCHAR(56) NOT NULL,
    name VARCHAR(255) NOT NULL,
    issuer VARCHAR(255) NOT NULL,
    issued_at TIMESTAMP NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMP NOT NULL,
    UNIQUE(user_address, name)
);

-- Disputes table
CREATE TABLE IF NOT EXISTS disputes (
    id BIGINT PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES jobs(id),
    raised_by VARCHAR(56) NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMP,
    resolution TEXT,
    resolved_by VARCHAR(56)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client);
CREATE INDEX IF NOT EXISTS idx_jobs_freelancer ON jobs(freelancer);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_milestones_job_id ON job_milestones(job_id);
CREATE INDEX IF NOT EXISTS idx_user_skills_user_address ON user_skills(user_address);
CREATE INDEX IF NOT EXISTS idx_user_skills_skill ON user_skills(skill);
CREATE INDEX IF NOT EXISTS idx_user_certifications_user_address ON user_certifications(user_address);
CREATE INDEX IF NOT EXISTS idx_disputes_job_id ON disputes(job_id);
CREATE INDEX IF NOT EXISTS idx_disputes_raised_by ON disputes(raised_by);

-- Create view for job statistics
CREATE OR REPLACE VIEW job_statistics AS
SELECT 
    j.id,
    j.client,
    j.freelancer,
    j.title,
    j.status,
    j.total_escrow,
    j.released_amount,
    j.created_at,
    j.accepted_at,
    j.completed_at,
    COUNT(m.id) as total_milestones,
    COUNT(CASE WHEN m.is_released THEN 1 END) as released_milestones,
    CASE 
        WHEN j.status = 'Open' THEN 'Available'
        WHEN j.status = 'InProgress' THEN 'Active'
        WHEN j.status = 'Completed' THEN 'Finished'
        WHEN j.status = 'Disputed' THEN 'Under Review'
        WHEN j.status = 'Cancelled' THEN 'Cancelled'
    END as status_label
FROM jobs j
LEFT JOIN job_milestones m ON j.id = m.job_id
GROUP BY j.id;

COMMENT ON TABLE jobs IS 'Stores job listings with escrow information';
COMMENT ON TABLE job_milestones IS 'Stores milestone breakdown for each job';
COMMENT ON TABLE user_skills IS 'Stores verified skills for users';
COMMENT ON TABLE user_certifications IS 'Stores certifications issued to users';
COMMENT ON TABLE disputes IS 'Stores dispute records for jobs';
