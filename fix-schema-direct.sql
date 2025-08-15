-- Direct SQL commands to fix dashboard_settings schema
DROP TABLE IF EXISTS dashboard_settings CASCADE;

CREATE TABLE dashboard_settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) UNIQUE NOT NULL,
  value JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Insert environment variables
INSERT INTO dashboard_settings (key, value) VALUES 
  ('nextauth_url', '"https://community-dashboard-496146455129.us-central1.run.app"'),
  ('authentik_client_id', '"u72PgNvfaNrj9l6yNy8p4muI5wZA23miWEXVb95D"'),
  ('authentik_issuer', '"https://sso.irregularchat.com/application/o/dashboard/"'),
  ('authentik_base_url', '"https://sso.irregularchat.com/api/v3"'),
  ('oidc_authorization_endpoint', '"https://sso.irregularchat.com/application/o/dashboard/authorize/"'),
  ('oidc_token_endpoint', '"https://sso.irregularchat.com/application/o/dashboard/token/"'),
  ('oidc_userinfo_endpoint', '"https://sso.irregularchat.com/application/o/dashboard/userinfo/"'),
  ('oidc_end_session_endpoint', '"https://sso.irregularchat.com/application/o/dashboard/end-session/"'),
  ('oidc_redirect_uri', '"https://community-dashboard-496146455129.us-central1.run.app/api/auth/callback/authentik"')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;