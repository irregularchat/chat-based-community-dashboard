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

## SignalBot Phone Verification Setup

The modern-stack includes SignalBot integration for phone number verification. This allows users to receive verification codes via Signal when updating their phone numbers.

### Required Environment Variables

Add these to your `.env` file:

```bash
# Matrix Configuration (required for SignalBot)
MATRIX_HOMESERVER=https://matrix.irregularchat.com
MATRIX_ACCESS_TOKEN=your_matrix_bot_access_token
MATRIX_USER_ID=@bot.irregularchat:irregularchat.com
MATRIX_DOMAIN=irregularchat.com

# SignalBot Configuration
MATRIX_SIGNAL_BRIDGE_ROOM_ID=!your_signal_bridge_room_id:irregularchat.com
MATRIX_SIGNAL_BOT_USERNAME=@signalbot:irregularchat.com
SIGNAL_BRIDGE_BOT_RESPONSE_DELAY=3.0

# Optional Matrix bot username for room searching
MATRIX_BOT_USERNAME=@bot.irregularchat:irregularchat.com

# INDOC/Moderator room for notifications
MATRIX_INDOC_ROOM_ID=!your_indoc_room_id:irregularchat.com
```

### How Phone Verification Works

1. **User enters phone number** in dashboard
2. **Phone normalization** - adds country code if missing (defaults to +1 for US)
3. **SignalBot resolution** - sends `resolve-identifier +phonenumber` to SignalBot
4. **UUID extraction** - extracts Signal UUID from bot response
5. **Chat creation** - sends `start-chat UUID` to create bridge room
6. **Message delivery** - sends 6-digit verification code to Signal user
7. **Fallback** - if Signal fails, sends to Matrix direct message

### SignalBot Commands

The system uses these SignalBot commands:

- `resolve-identifier +12345678901` - Resolves phone to Signal UUID
- `start-chat uuid-here` - Creates Matrix room bridged to Signal user

### Troubleshooting

**"Phone number not found on Signal"**
- User doesn't have Signal installed
- Phone number not registered with Signal
- Phone number format invalid (must include country code)

**"Signal bridge not configured"**
- `MATRIX_SIGNAL_BRIDGE_ROOM_ID` not set
- Bot doesn't have access to Signal bridge room

**"Failed to send verification code"**
- Matrix service not configured
- SignalBot not responding
- Network connectivity issues

### Testing

To test SignalBot integration:

1. Ensure your phone number is registered with Signal
2. Go to Dashboard → Account → Update Phone Number
3. Enter your phone number (with or without country code)
4. Check Signal for verification code
5. Enter 6-digit code to complete verification

The system will automatically fall back to Matrix direct messages if SignalBot fails.
