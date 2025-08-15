# Local Development Setup Guide

## Quick Start (Recommended)

### 1. Setup Modern Stack (Next.js Application)

```bash
cd modern-stack
npm install
cp .env.local .env
```

### 2. Database Options

#### Option A: Use Cloud SQL Proxy (Easiest - uses existing data)
```bash
# Install Cloud SQL proxy
gcloud components install cloud-sql-proxy

# Start proxy (in a separate terminal)
cloud-sql-proxy speech-memorization:us-central1:community-dashboard-db --port=5432

# Your DATABASE_URL in .env should be:
# DATABASE_URL=postgresql://dashboard_user:newpassword123@localhost:5432/postgres
```

#### Option B: Local PostgreSQL with Docker
```bash
# From project root
docker-compose up db -d

# Your DATABASE_URL in .env should be:
# DATABASE_URL=postgresql://dashboard_user:your_password@localhost:5436/dashboard_db
```

#### Option C: Local PostgreSQL (Manual)
```bash
# Install PostgreSQL locally
brew install postgresql  # macOS
# or use your system package manager

# Create database and user
createuser -s dashboard_user
createdb dashboard_db
psql -c "ALTER USER dashboard_user PASSWORD 'your_password';"

# Your DATABASE_URL in .env should be:
# DATABASE_URL=postgresql://dashboard_user:your_password@localhost:5432/dashboard_db
```

### 3. Initialize Database

```bash
cd modern-stack
npx prisma generate
npx prisma db push  # Creates tables
npm run db:seed     # Optional: add sample data
```

### 4. Start Development Server

```bash
npm run dev
```

Visit: http://localhost:3000

## Environment Variables

Edit `modern-stack/.env` with your configuration:

### Required Variables:
- `NEXTAUTH_URL` - http://localhost:3000 (for local)
- `NEXTAUTH_SECRET` - Generate with: `openssl rand -base64 32`
- `DATABASE_URL` - Your PostgreSQL connection string
- `AUTHENTIK_*` - Your Authentik configuration (use existing values)

### Authentication Setup

For local development, you have two options:

1. **Use existing Authentik** (requires updating redirect URIs)
2. **Local authentication** (modify auth.ts to allow local users)

## Available Scripts

### Modern Stack (Next.js)
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run linting
npm run test         # Run tests
npm run db:seed      # Seed database with sample data
npm run db:reset     # Reset and reseed database
```

### Legacy Stack (Streamlit)
```bash
# From project root
docker-compose up    # Full stack with database
# or
python -m streamlit run app/streamlit_app.py  # Streamlit only
```

## Troubleshooting

### Database Connection Issues
1. Check if PostgreSQL is running
2. Verify DATABASE_URL format
3. Ensure database exists and user has permissions

### Authentication Issues
1. Check Authentik redirect URIs include `http://localhost:3000/api/auth/callback/authentik`
2. Verify AUTHENTIK_CLIENT_ID and AUTHENTIK_CLIENT_SECRET
3. Check NEXTAUTH_SECRET is set

### Port Conflicts
- Next.js: http://localhost:3000
- Streamlit: http://localhost:8503
- PostgreSQL: 5432 (local) or 5436 (docker)

## Development Workflow

1. Make changes to code
2. Test locally at http://localhost:3000
3. Run tests: `npm test`
4. Commit changes
5. Push to repository (auto-deploys to Cloud Run)

## Database Management

### View Database
```bash
npx prisma studio  # Opens database browser at http://localhost:5555
```

### Reset Database
```bash
npm run db:reset   # Careful: deletes all data!
```

### Run Migrations
```bash
npx prisma generate  # Generate Prisma client
npx prisma db push   # Push schema changes
```

## Integration with Cloud

The local environment is configured to work with the same Authentik instance as production. To test with production data, use Option A (Cloud SQL Proxy) for the database connection.