# Signal CLI Bot Integration

## Overview

This Signal CLI bot provides a direct integration between Signal messenger and the community dashboard, enabling users to interact with the platform via Signal commands.

## Features

### Core Commands
- `!help` - Display all available commands
- `!phelp` - Get personalized AI-powered help
- `!info` - Get bot information and status
- `!status` - Check bot operational status
- `!ping` - Test bot responsiveness
- `!whoami` - Display your Signal account information

### AI Commands (when enabled)
- `!ai <question>` - Ask the AI assistant any question
- AI uses GPT-5-mini model for efficient responses

### Matrix Integration Commands
- `!rooms` - List available Matrix rooms
- `!join <room>` - Join a Matrix room
- `!leave <room>` - Leave a Matrix room
- `!verify <code>` - Verify your Signal account
- `!matrix status` - Check Matrix service status
- `!matrix sync` - Trigger Matrix data synchronization
- `!matrix search <term>` - Search for Matrix users

## Setup Instructions

### Prerequisites
- Java 17 or higher (required for signal-cli)
- Node.js 18+ and npm
- PostgreSQL database
- Matrix homeserver (optional, for Matrix integration)

### Installation

1. **Run the setup script:**
   ```bash
   cd modern-stack/scripts
   ./setup-signal-bot.sh
   ```
   Choose option 6 for complete setup.

2. **Configure environment variables in `.env.local`:**
   ```env
   # Required
   SIGNAL_BOT_PHONE_NUMBER=+1234567890
   
   # Optional - AI Features
   OPENAI_ACTIVE=true
   OPENAI_API_KEY=sk-...
   
   # Optional - Matrix Integration
   MATRIX_ACTIVE=true
   MATRIX_HOMESERVER=https://matrix.example.com
   MATRIX_ACCESS_TOKEN=your_token
   MATRIX_USER_ID=@bot:example.com
   ```

3. **Start the bot via API:**
   ```bash
   # Start the Next.js application
   npm run dev
   
   # In another terminal, start the bot
   curl -X POST http://localhost:3000/api/signal-bot \
     -H "Content-Type: application/json" \
     -d '{"action": "start"}'
   ```

### Manual signal-cli Installation

If the setup script doesn't work:

**macOS:**
```bash
brew install signal-cli
```

**Linux:**
```bash
# Download latest release
wget https://github.com/AsamK/signal-cli/releases/download/v0.12.2/signal-cli-0.12.2-Linux.tar.gz
tar xf signal-cli-0.12.2-Linux.tar.gz -C /opt
sudo ln -sf /opt/signal-cli-0.12.2/bin/signal-cli /usr/local/bin/
```

**Register phone number:**
```bash
# Request SMS code
signal-cli -a +1234567890 register

# Verify with code
signal-cli -a +1234567890 verify 123456
```

## API Endpoints

### GET /api/signal-bot?action=status
Check bot status

### POST /api/signal-bot
Control bot operations

**Start bot:**
```json
{"action": "start"}
```

**Stop bot:**
```json
{"action": "stop"}
```

**Restart bot:**
```json
{"action": "restart"}
```

## Architecture

### Components

1. **SignalBotService** (`bot-service.ts`)
   - Core Signal CLI wrapper
   - Command registration and handling
   - Message sending/receiving
   - AI integration

2. **SignalMatrixIntegration** (`integration.ts`)
   - Bridges Signal and Matrix
   - Room management
   - User verification
   - Cross-platform messaging

3. **API Route** (`/api/signal-bot/route.ts`)
   - HTTP interface for bot control
   - Status monitoring
   - Start/stop operations

### Message Flow

```
Signal User -> signal-cli -> SignalBotService -> Command Handler
                                |
                                v
                         SignalMatrixIntegration
                                |
                                v
                         Matrix Service / Database
```

## Troubleshooting

### Bot not responding
1. Check if signal-cli daemon is running:
   ```bash
   ps aux | grep signal-cli
   ```

2. Check bot status:
   ```bash
   curl http://localhost:3000/api/signal-bot?action=status
   ```

3. Check logs:
   ```bash
   # Application logs
   npm run dev
   
   # Signal CLI logs (if using systemd)
   sudo journalctl -u signal-bot -f
   ```

### Registration issues
- Ensure phone number has country code (+1 for US)
- Wait 3 minutes between registration attempts
- Use a real phone number that can receive SMS

### AI not working
- Verify `OPENAI_ACTIVE=true` in environment
- Check OpenAI API key is valid
- Ensure key starts with `sk-`

### Matrix commands failing
- Verify Matrix service is configured
- Check Matrix access token is valid
- Ensure bot account has necessary permissions

## Security Considerations

1. **Phone Number Privacy**: The bot phone number is visible to all users
2. **API Keys**: Store securely in environment variables, never commit
3. **Rate Limiting**: signal-cli has built-in rate limits
4. **Message Encryption**: Signal messages are end-to-end encrypted
5. **Access Control**: Implement user verification before sensitive operations

## Development

### Adding New Commands

```typescript
// In bot-service.ts or integration.ts
signalBot.registerCommand('!mycommand', async (message) => {
  // Command logic here
  await signalBot.sendMessage(message.sourceNumber, 'Response');
});
```

### Testing Commands

Send a Signal message to your bot number:
```
!help
!phelp
!ai What is the weather today?
!rooms
!matrix status
```

## Monitoring

### Health Checks
- Bot status: `/api/signal-bot?action=status`
- Matrix status: Send `!matrix status` to bot
- AI status: Send `!info` to bot

### Metrics to Track
- Message processing time
- Command success/failure rates
- Active user count
- API response times

## Future Improvements

1. **Enhanced AI Integration**
   - Context-aware responses
   - Multi-turn conversations
   - Custom AI models

2. **Advanced Commands**
   - Scheduled messages
   - Bulk operations
   - Admin commands

3. **Better Error Handling**
   - Retry logic for failed operations
   - User-friendly error messages
   - Automatic recovery

4. **Performance Optimizations**
   - Message queuing
   - Batch processing
   - Caching frequently accessed data

## Support

For issues or questions:
1. Check this README
2. Review LESSONS_LEARNED.md
3. Check Signal CLI documentation: https://github.com/AsamK/signal-cli
4. Open an issue in the repository

## License

This integration follows the same license as the main project.