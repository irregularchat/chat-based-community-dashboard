# Matrix Integration Setup Guide

This guide helps you set up Matrix integration for your Chat-Based Community Dashboard.

## What is Matrix?

Matrix is an open standard for decentralized, real-time communication. It allows you to:
- Host your own chat server
- Bridge with other platforms (Signal, Discord, etc.)
- Have full control over your community's data
- Use end-to-end encryption

## Prerequisites

- A Matrix homeserver (like Element Matrix Services, or self-hosted Synapse)
- Admin access to your Matrix homeserver
- Basic understanding of Matrix concepts (rooms, users, power levels)

## Getting Your Matrix Access Token

### Option 1: Element Web Client (Easiest)
1. Log into your Matrix account at https://app.element.io (or your homeserver's Element instance)
2. Click your profile picture → Settings
3. Go to "Help & About" tab
4. Scroll down to "Advanced" section
5. Copy your "Access Token"

### Option 2: Using curl (Advanced)
```bash
curl -XPOST -d '{"type":"m.login.password", "user":"your_username", "password":"your_password"}' "https://your-homeserver.com/_matrix/client/r0/login"
```

## Configuration

Add these to your `.env` file:

```env
# Matrix Configuration
MATRIX_HOMESERVER=https://matrix.your-domain.com
MATRIX_ACCESS_TOKEN=your_access_token_here
MATRIX_USER_ID=@your_username:your-domain.com

# Optional: Default room settings
MATRIX_DEFAULT_ROOM_ALIAS=#general:your-domain.com
MATRIX_MODERATOR_ROOM=#moderators:your-domain.com
```

## Features Available

### Room Management
- **Create rooms** for new user groups
- **Invite users** to appropriate rooms
- **Manage permissions** (power levels)
- **Bridge rooms** with Signal groups

### User Management
- **Sync user accounts** between Authentik and Matrix
- **Set power levels** for moderators
- **Track room membership**

### Moderation Tools
- **Create conflict resolution rooms** quickly
- **Add moderators** to new rooms automatically
- **Send announcements** to all rooms

## Testing Your Setup

1. Start the dashboard with Matrix integration enabled
2. Go to the "Matrix Management" section
3. Try creating a test room
4. Verify you can see your existing rooms

## Troubleshooting

### Common Issues

**"Failed to connect to Matrix homeserver"**
- Check your `MATRIX_HOMESERVER` URL
- Ensure the homeserver is accessible
- Verify SSL certificates are valid

**"Invalid access token"**
- Generate a new access token
- Check that the token hasn't expired
- Ensure the user has appropriate permissions

**"Cannot create rooms"**
- Verify your user has room creation permissions
- Check homeserver room creation policies
- Ensure you're not hitting rate limits

### Getting Help

- **Matrix Community**: #matrix:matrix.org
- **Element Support**: https://element.io/help
- **Our Forum**: https://forum.irregularchat.com/

## Advanced Configuration

### Custom Room Templates
You can customize room creation by editing `app/utils/matrix_helpers.py`:

```python
# Example: Custom room settings
room_config = {
    "name": "Community Room",
    "topic": "Welcome to our community!",
    "preset": "public_chat",
    "power_level_content_override": {
        "users": {
            "@admin:your-domain.com": 100
        }
    }
}
```

### Bridging with Signal
To bridge Matrix rooms with Signal groups:

1. Set up a Signal bridge (like mautrix-signal)
2. Configure bridge settings in your homeserver
3. Use the dashboard to link rooms and groups

## Security Considerations

- **Use a dedicated bot account** for the dashboard
- **Limit permissions** to only what's needed
- **Regularly rotate access tokens**
- **Monitor room access** and permissions
- **Enable encryption** for sensitive rooms

## Next Steps

Once Matrix integration is working:
1. Set up room templates for different community types
2. Configure automatic user onboarding to Matrix
3. Set up bridging with other platforms
4. Explore advanced moderation features

---

**Need help?** Join our community forum or check the main documentation for more guidance! 