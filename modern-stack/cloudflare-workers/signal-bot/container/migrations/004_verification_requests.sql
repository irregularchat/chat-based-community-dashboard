-- Migration: 004_verification_requests
-- Description: Create verification_requests table for tracking new user verification flow
-- Created: 2024-12-04

CREATE TABLE IF NOT EXISTS verification_requests (
    id SERIAL PRIMARY KEY,
    user_uuid VARCHAR(255) NOT NULL,
    user_name VARCHAR(255),
    user_phone VARCHAR(50),
    entry_group_id VARCHAR(255) NOT NULL,

    -- Status tracking
    -- pending_intro: Waiting for user to respond with intro + mention
    -- pending_vouch: Waiting for voucher to confirm
    -- approved: Voucher said yes, processing with GTG
    -- denied: Voucher said no
    -- expired: 24 hours passed without completion
    -- removed: User was removed
    status VARCHAR(50) NOT NULL DEFAULT 'pending_intro',

    -- Voucher info (set when user mentions someone)
    voucher_uuid VARCHAR(255),
    voucher_name VARCHAR(255),

    -- Admin who initiated
    requested_by_uuid VARCHAR(255),
    requested_by_name VARCHAR(255),

    -- Intro text (captured when user responds)
    intro_text TEXT,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    voucher_asked_at TIMESTAMP,
    completed_at TIMESTAMP
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_verification_pending ON verification_requests(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_verification_user ON verification_requests(user_uuid);
CREATE INDEX IF NOT EXISTS idx_verification_voucher ON verification_requests(voucher_uuid, status);
CREATE INDEX IF NOT EXISTS idx_verification_group ON verification_requests(entry_group_id, status);
