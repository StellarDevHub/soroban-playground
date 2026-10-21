DROP TABLE IF EXISTS audit_log, api_keys, projects CASCADE;

CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'public',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','active','funded','completed','cancelled')),
  creator_id INTEGER NOT NULL,
  creator_name TEXT NOT NULL,
  funding_goal REAL NOT NULL,
  current_funding REAL DEFAULT 0,
  completion_rate REAL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  tags TEXT,
  metadata TEXT
);
CREATE INDEX idx_projects_tenant ON projects(tenant_id);

CREATE TABLE api_keys (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'public',
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  tier TEXT NOT NULL CHECK (tier IN ('free','standard','premium','admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  user_id INTEGER,
  organization_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  usage_count INTEGER DEFAULT 0
);
CREATE INDEX idx_api_keys_tenant_id ON api_keys(tenant_id);

CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'public',
  api_key_id INTEGER,
  user_id INTEGER,
  action TEXT NOT NULL,
  endpoint TEXT,
  ip_address TEXT,
  user_agent TEXT,
  status_code INTEGER,
  response_time_ms INTEGER,
  timestamp TIMESTAMPTZ DEFAULT now(),
  metadata TEXT
);
CREATE INDEX idx_audit_log_tenant_ts ON audit_log(tenant_id, timestamp);
