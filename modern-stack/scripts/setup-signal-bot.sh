#!/bin/bash

# Signal CLI Bot Setup Script
# This script helps set up signal-cli for the bot integration

set -e

echo "========================================="
echo "Signal CLI Bot Setup"
echo "========================================="

# Check if running on macOS or Linux
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
    echo "Detected macOS"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
    echo "Detected Linux"
else
    echo "Unsupported OS: $OSTYPE"
    exit 1
fi

# Function to install signal-cli
install_signal_cli() {
    echo ""
    echo "Installing signal-cli..."
    
    if [ "$OS" == "macos" ]; then
        # Check if Homebrew is installed
        if ! command -v brew &> /dev/null; then
            echo "Homebrew is not installed. Please install it first:"
            echo "Visit: https://brew.sh"
            exit 1
        fi
        
        # Install signal-cli via Homebrew
        brew install signal-cli
        
    elif [ "$OS" == "linux" ]; then
        # Download latest signal-cli release
        SIGNAL_CLI_VERSION="0.12.2"  # Update this as needed
        wget "https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}-Linux.tar.gz"
        
        # Extract to /opt
        sudo tar xf "signal-cli-${SIGNAL_CLI_VERSION}-Linux.tar.gz" -C /opt
        sudo ln -sf "/opt/signal-cli-${SIGNAL_CLI_VERSION}/bin/signal-cli" /usr/local/bin/
        
        # Clean up
        rm "signal-cli-${SIGNAL_CLI_VERSION}-Linux.tar.gz"
    fi
    
    echo "✅ signal-cli installed successfully"
}

# Function to register phone number
register_phone() {
    echo ""
    echo "Registering phone number with Signal..."
    echo "Enter the phone number for the bot (with country code, e.g., +1234567890):"
    read -r PHONE_NUMBER
    
    # Register the number
    echo "Requesting SMS verification code..."
    signal-cli -a "$PHONE_NUMBER" register
    
    echo ""
    echo "Enter the verification code you received via SMS:"
    read -r VERIFICATION_CODE
    
    # Verify the code
    signal-cli -a "$PHONE_NUMBER" verify "$VERIFICATION_CODE"
    
    echo "✅ Phone number registered successfully"
    echo ""
    echo "Add this to your .env file:"
    echo "SIGNAL_BOT_PHONE_NUMBER=$PHONE_NUMBER"
}

# Function to test signal-cli
test_signal_cli() {
    echo ""
    echo "Testing signal-cli installation..."
    
    if command -v signal-cli &> /dev/null; then
        echo "✅ signal-cli is installed"
        signal-cli --version
    else
        echo "❌ signal-cli is not installed or not in PATH"
        return 1
    fi
    
    # Check if Java is installed (required for signal-cli)
    if command -v java &> /dev/null; then
        echo "✅ Java is installed"
        java -version 2>&1 | head -1
    else
        echo "❌ Java is not installed. signal-cli requires Java 17 or higher"
        echo "Install Java first, then run this script again"
        exit 1
    fi
}

# Function to create systemd service (Linux only)
create_systemd_service() {
    if [ "$OS" != "linux" ]; then
        return
    fi
    
    echo ""
    echo "Would you like to create a systemd service for the Signal bot? (y/n)"
    read -r CREATE_SERVICE
    
    if [ "$CREATE_SERVICE" != "y" ]; then
        return
    fi
    
    echo "Enter the phone number for the bot:"
    read -r PHONE_NUMBER
    
    # Create systemd service file
    sudo tee /etc/systemd/system/signal-bot.service > /dev/null <<EOF
[Unit]
Description=Signal CLI Bot
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=/usr/local/bin/signal-cli -a $PHONE_NUMBER daemon --json
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
    
    # Enable and start service
    sudo systemctl daemon-reload
    sudo systemctl enable signal-bot
    
    echo "✅ Systemd service created"
    echo "Start with: sudo systemctl start signal-bot"
    echo "Check status: sudo systemctl status signal-bot"
    echo "View logs: sudo journalctl -u signal-bot -f"
}

# Function to setup environment variables
setup_env() {
    echo ""
    echo "Setting up environment variables..."
    
    ENV_FILE="../.env.local"
    
    if [ ! -f "$ENV_FILE" ]; then
        echo "Creating .env.local file..."
        touch "$ENV_FILE"
    fi
    
    echo ""
    echo "Enter configuration values (press Enter to skip):"
    
    echo "Signal bot phone number (with country code):"
    read -r SIGNAL_BOT_PHONE_NUMBER
    if [ ! -z "$SIGNAL_BOT_PHONE_NUMBER" ]; then
        echo "SIGNAL_BOT_PHONE_NUMBER=$SIGNAL_BOT_PHONE_NUMBER" >> "$ENV_FILE"
    fi
    
    echo "Enable AI features? (true/false):"
    read -r OPENAI_ACTIVE
    if [ ! -z "$OPENAI_ACTIVE" ]; then
        echo "OPENAI_ACTIVE=$OPENAI_ACTIVE" >> "$ENV_FILE"
    fi
    
    echo "OpenAI API key (if AI is enabled):"
    read -r OPENAI_API_KEY
    if [ ! -z "$OPENAI_API_KEY" ]; then
        echo "OPENAI_API_KEY=$OPENAI_API_KEY" >> "$ENV_FILE"
    fi
    
    echo "✅ Environment variables configured"
}

# Main menu
echo ""
echo "What would you like to do?"
echo "1) Install signal-cli"
echo "2) Register phone number with Signal"
echo "3) Test signal-cli installation"
echo "4) Setup environment variables"
echo "5) Create systemd service (Linux only)"
echo "6) Complete setup (all of the above)"
echo "0) Exit"

read -r CHOICE

case $CHOICE in
    1)
        install_signal_cli
        ;;
    2)
        register_phone
        ;;
    3)
        test_signal_cli
        ;;
    4)
        setup_env
        ;;
    5)
        create_systemd_service
        ;;
    6)
        test_signal_cli || install_signal_cli
        test_signal_cli
        register_phone
        setup_env
        create_systemd_service
        echo ""
        echo "========================================="
        echo "✅ Signal CLI Bot setup complete!"
        echo "========================================="
        echo ""
        echo "Next steps:"
        echo "1. Start your Next.js application"
        echo "2. Visit /api/signal-bot?action=status to check bot status"
        echo "3. Send POST to /api/signal-bot with {\"action\": \"start\"} to start the bot"
        echo "4. Send a message to your bot number with !help to test"
        ;;
    0)
        echo "Exiting..."
        exit 0
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "Done!"