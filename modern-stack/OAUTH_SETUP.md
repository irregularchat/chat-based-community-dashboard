# OAuth and Secret Management Setup

This document explains how to configure OAuth providers and Google Cloud Secret Manager for the community dashboard.

## Overview

The dashboard supports multiple authentication providers:
- **Google OAuth** - For Google account sign-ins
- **Authentik OIDC** - For enterprise SSO
- **Local Authentication** - Username/password (development/fallback)

Secrets can be managed via:
- **Environment Variables** (local development)
- **Google Cloud Secret Manager** (production)

## Google OAuth Setup

### 1. Create Google OAuth Application

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Navigate to **APIs & Services > Credentials**
4. Click **Create Credentials > OAuth 2.0 Client IDs**
5. Configure the OAuth consent screen if prompted
6. Select **Web application** as application type
7. Add authorized redirect URIs:
   - `http://localhost:3001/api/auth/callback/google` (development)
   - `https://yourdomain.com/api/auth/callback/google` (production)
8. Save and copy the **Client ID** and **Client Secret**

### 2. Configure Environment Variables

Add to your `.env.local` file:

```bash
# Google OAuth Configuration
GOOGLE_CLIENT_ID="your-google-client-id-here"
GOOGLE_CLIENT_SECRET="your-google-client-secret-here"
```

## Authentik OIDC Setup

### 1. Configure Authentik Application

1. Log into your Authentik admin panel
2. Go to **Applications > Applications**
3. Create a new application with these settings:
   - **Name**: Community Dashboard
   - **Slug**: community-dashboard
   - **Provider**: Create new OAuth2/OpenID Provider
   - **Client ID**: Generate or set custom ID
   - **Client Secret**: Generate secure secret
   - **Redirect URIs**: 
     - `http://localhost:3001/api/auth/callback/authentik` (development)
     - `https://yourdomain.com/api/auth/callback/authentik` (production)
   - **Scopes**: `openid`, `email`, `profile`

### 2. Configure Environment Variables

Add to your `.env.local` file:

```bash
# Authentik OIDC Configuration
AUTHENTIK_ISSUER="https://sso.yourdomain.com/application/o/community-dashboard/"
AUTHENTIK_CLIENT_ID="your-authentik-client-id"
AUTHENTIK_CLIENT_SECRET="your-authentik-client-secret"
```

## Google Cloud Secret Manager Setup

### 1. Enable Secret Manager API

```bash
gcloud services enable secretmanager.googleapis.com
```

### 2. Set Up Service Account (Production)

```bash
# Create service account
gcloud iam service-accounts create dashboard-secrets \
    --description="Service account for dashboard secret access" \
    --display-name="Dashboard Secrets"

# Grant Secret Manager access
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:dashboard-secrets@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

# Create and download key
gcloud iam service-accounts keys create dashboard-secrets-key.json \
    --iam-account=dashboard-secrets@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

### 3. Configure Environment Variables

Add to your `.env.local` file:

```bash
# Google Cloud Configuration

GOOGLE_APPLICATION_CREDENTIALS="/path/to/dashboard-secrets-key.json"
```

### 4. Create Secrets

Use the provided script to create secrets from your environment variables:

```bash
# Set up all secrets from .env.local
node scripts/setup-secrets.js setup

# List existing secrets
node scripts/setup-secrets.js list
```

Or manually create secrets:

```bash
# Create individual secrets
echo -n "your-google-client-id" | gcloud secrets create GOOGLE_CLIENT_ID --data-file=-
echo -n "your-google-client-secret" | gcloud secrets create GOOGLE_CLIENT_SECRET --data-file=-
echo -n "your-authentik-client-id" | gcloud secrets create AUTHENTIK_CLIENT_ID --data-file=-
echo -n "your-authentik-client-secret" | gcloud secrets create AUTHENTIK_CLIENT_SECRET --data-file=-
```

## Testing OAuth Configuration

### 1. Start the Application

```bash
npm run dev
```

### 2. Test Sign-In Flow

1. Navigate to `http://localhost:3001/auth/signin`
2. You should see options for:
   - **Sign in with Google** (if Google OAuth configured)
   - **Sign in with Authentik** (if Authentik OIDC configured)  
   - **Local Authentication** (if enabled)

### 3. Verify Secret Manager Integration

The application will automatically:
1. Try to load secrets from Google Cloud Secret Manager
2. Fall back to environment variables if Secret Manager fails
3. Log which method is being used in the console

## Troubleshooting

### Common Issues

**Error: `invalid_client`**
- Check that Client ID and Client Secret are correct
- Verify redirect URIs match exactly (including protocol and port)
- Ensure OAuth consent screen is properly configured

**Error: `ENOENT: no such file or directory, open 'dashboard-secrets-key.json'`**
- Check that `GOOGLE_APPLICATION_CREDENTIALS` points to correct file path
- Verify service account key file exists and has correct permissions

**Error: `User does not have permission to access the secret`**
- Ensure service account has `roles/secretmanager.secretAccessor` role
- Check that secrets exist in the correct GCP project

### Debug Mode

Enable debug logging by setting:

```bash
NODE_ENV=development
```

This will show detailed OAuth flow and secret loading information in the console.

## Security Best Practices

1. **Never commit secrets to git**
   - Add `.env.local` to `.gitignore`
   - Use environment variables or Secret Manager in production

2. **Rotate secrets regularly**
   - Update OAuth client secrets periodically
   - Use Secret Manager versioning for safe rotation

3. **Restrict OAuth scopes**
   - Only request necessary permissions (`openid`, `email`, `profile`)
   - Regularly audit OAuth applications

4. **Use HTTPS in production**
   - Always use HTTPS for OAuth redirect URIs
   - Configure secure session cookies

5. **Monitor access logs**
   - Enable Cloud Audit Logs for Secret Manager
   - Monitor OAuth sign-in attempts in application logs

## Production Deployment

For production deployment:

1. **Use Secret Manager for all secrets**
2. **Set up proper IAM roles**
3. **Configure HTTPS redirect URIs**
4. **Enable audit logging**
5. **Set up monitoring and alerting**

Example production environment variables:

```bash
# Production configuration
NODE_ENV=production
NEXTAUTH_URL=https://dashboard.yourdomain.com

GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/service-account-key.json
```

The application will automatically use Secret Manager in production and fall back to environment variables for any missing secrets.