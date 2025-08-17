-- This file initializes the database with required extensions
-- It will be run automatically when the PostgreSQL container starts

-- Create extensions if they don't exist
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Set default timezone
SET timezone = 'UTC';

-- Create a comment to indicate successful initialization
COMMENT ON DATABASE dashboarddb IS 'Community Dashboard Database - Initialized';