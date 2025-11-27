-- Debug Logs Table for Troubleshooting
-- Stores connection events, message processing errors, and diagnostic data

CREATE TABLE IF NOT EXISTS debug_logs (
  id SERIAL PRIMARY KEY,
  timestamp BIGINT NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'info',
  component VARCHAR(50) NOT NULL,
  message TEXT,
  data JSONB,
  stack_trace TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for efficient querying
CREATE INDEX idx_debug_logs_timestamp ON debug_logs(timestamp DESC);
CREATE INDEX idx_debug_logs_event_type ON debug_logs(event_type);
CREATE INDEX idx_debug_logs_severity ON debug_logs(severity);
CREATE INDEX idx_debug_logs_component ON debug_logs(component);

-- Add a comment
COMMENT ON TABLE debug_logs IS 'Stores debugging and diagnostic information for Signal bot';
COMMENT ON COLUMN debug_logs.event_type IS 'Type of event: connection_open, connection_close, message_decrypt_failed, rpc_error, etc.';
COMMENT ON COLUMN debug_logs.severity IS 'Severity: debug, info, warn, error, critical';
COMMENT ON COLUMN debug_logs.component IS 'Component: signal-cli, rpc-client, bot-handler, message-processor, etc.';
COMMENT ON COLUMN debug_logs.data IS 'JSON data with context-specific debugging information';
