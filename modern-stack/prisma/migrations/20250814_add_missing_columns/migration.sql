-- Add missing columns to existing tables

-- Add icon column to community_bookmarks if it doesn't exist
ALTER TABLE "community_bookmarks" ADD COLUMN IF NOT EXISTS "icon" TEXT;

-- Add type column to dashboard_announcements if it doesn't exist  
ALTER TABLE "dashboard_announcements" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'info';

-- Ensure dashboard_settings has correct schema (should already exist from previous fixes)
-- This is idempotent and safe to run multiple times