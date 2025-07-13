# Community Dashboard - Modern Stack

## Quick Start

1. Copy `.env.example` to `.env` and configure your environment variables
2. Run `docker-compose up -d --build`
3. Access the dashboard at `http://localhost:8503`

## Troubleshooting

### Admin User Not Created

If the admin user is not created after running `docker-compose up -d --build`, follow these steps:

1. **Check the logs**:
   ```bash
   docker-compose logs app
   ```

2. **Verify environment variables**:
   Ensure your `.env` file contains:
   ```
   DEFAULT_ADMIN_USERNAME=admin
   DEFAULT_ADMIN_PASSWORD=shareme314
   SEED_DATABASE=true
   ```

3. **Manually create admin user**:
   ```bash
   # Run the admin creation script
   docker-compose exec app node create-admin.js
   
   # Or run the seeding script
   docker-compose exec app npm run db:seed
   ```

4. **Reset and rebuild**:
   ```bash
   # Stop containers
   docker-compose down -v
   
   # Remove database volume
   docker volume rm chat-based-community-dashboard_postgres_data
   
   # Rebuild and start
   docker-compose up -d --build
   ```

5. **Check database directly**:
   ```bash
   # Connect to database
   docker-compose exec db psql -U postgres -d dashboarddb
   
   # Check users table
   SELECT username, email, "isAdmin", "isActive" FROM "User";
   ```

### Default Admin Credentials

- **Username**: `admin` (or value from `DEFAULT_ADMIN_USERNAME`)
- **Password**: `shareme314` (or value from `DEFAULT_ADMIN_PASSWORD`)

**⚠️ Important**: Change the default password after first login!

## Development

### Running Tests

```bash
npm test
```

### Database Operations

```bash
# Reset database and reseed
npm run db:reset

# Seed database only
npm run db:seed
```

## Environment Variables

See `.env.example` for all available configuration options.

## Docker Commands

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop services
docker-compose down

# Rebuild and start
docker-compose up -d --build
```
