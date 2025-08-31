# /src/lib/signal-cli/signal_cli.py
"""
Signal CLI Python Implementation
This provides a Python interface to signal-cli for bot operations
"""

import subprocess
import json
import os
import time
import logging
from typing import Optional, Dict, List, Any
from dataclasses import dataclass
from enum import Enum

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SignalMessageType(Enum):
    """Types of Signal messages"""
    TEXT = "text"
    REACTION = "reaction"
    TYPING = "typing"
    READ_RECEIPT = "read_receipt"
    ATTACHMENT = "attachment"

@dataclass
class SignalMessage:
    """Signal message data structure"""
    timestamp: int
    source: str
    source_number: str
    source_uuid: str
    source_name: Optional[str]
    message: str
    group_id: Optional[str] = None
    attachments: Optional[List[str]] = None
    message_type: SignalMessageType = SignalMessageType.TEXT

class SignalCLI:
    """
    Signal CLI wrapper for Python
    Provides methods for sending and receiving Signal messages
    """
    
    def __init__(self, phone_number: str, signal_cli_path: str = "signal-cli"):
        """
        Initialize Signal CLI wrapper
        
        Args:
            phone_number: The phone number for the Signal account (with country code)
            signal_cli_path: Path to signal-cli executable
        """
        self.phone_number = phone_number
        self.signal_cli_path = signal_cli_path
        self.daemon_process = None
        
    def register(self) -> bool:
        """
        Register the phone number with Signal
        
        Returns:
            bool: True if registration initiated successfully
        """
        try:
            cmd = [self.signal_cli_path, "-a", self.phone_number, "register"]
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                logger.info(f"Registration initiated for {self.phone_number}")
                logger.info("Check SMS for verification code")
                return True
            else:
                logger.error(f"Registration failed: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"Registration error: {e}")
            return False
    
    def verify(self, verification_code: str) -> bool:
        """
        Verify the phone number with the SMS code
        
        Args:
            verification_code: The 6-digit code received via SMS
            
        Returns:
            bool: True if verification successful
        """
        try:
            cmd = [self.signal_cli_path, "-a", self.phone_number, "verify", verification_code]
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                logger.info(f"Verification successful for {self.phone_number}")
                return True
            else:
                logger.error(f"Verification failed: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"Verification error: {e}")
            return False
    
    def send_message(self, recipient: str, message: str, attachments: Optional[List[str]] = None) -> bool:
        """
        Send a message via Signal
        
        Args:
            recipient: Phone number or Signal UUID of recipient
            message: Text message to send
            attachments: Optional list of file paths to attach
            
        Returns:
            bool: True if message sent successfully
        """
        try:
            cmd = [self.signal_cli_path, "-a", self.phone_number, "send", "-m", message]
            
            if attachments:
                for attachment in attachments:
                    cmd.extend(["-a", attachment])
            
            cmd.append(recipient)
            
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                logger.info(f"Message sent to {recipient}")
                return True
            else:
                logger.error(f"Failed to send message: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"Send message error: {e}")
            return False
    
    def send_group_message(self, group_id: str, message: str, attachments: Optional[List[str]] = None) -> bool:
        """
        Send a message to a Signal group
        
        Args:
            group_id: The group ID
            message: Text message to send
            attachments: Optional list of file paths to attach
            
        Returns:
            bool: True if message sent successfully
        """
        try:
            cmd = [self.signal_cli_path, "-a", self.phone_number, "send", "-m", message]
            
            if attachments:
                for attachment in attachments:
                    cmd.extend(["-a", attachment])
            
            cmd.extend(["-g", group_id])
            
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                logger.info(f"Message sent to group {group_id}")
                return True
            else:
                logger.error(f"Failed to send group message: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"Send group message error: {e}")
            return False
    
    def receive_messages(self, timeout: int = 10) -> List[SignalMessage]:
        """
        Receive messages (one-time check)
        
        Args:
            timeout: Timeout in seconds
            
        Returns:
            List of SignalMessage objects
        """
        messages = []
        
        try:
            cmd = [self.signal_cli_path, "-a", self.phone_number, "receive", "--json", "-t", str(timeout)]
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0 and result.stdout:
                lines = result.stdout.strip().split('\n')
                
                for line in lines:
                    if line:
                        try:
                            data = json.loads(line)
                            if 'envelope' in data:
                                envelope = data['envelope']
                                if 'dataMessage' in envelope:
                                    msg = self._parse_message(envelope)
                                    if msg:
                                        messages.append(msg)
                        except json.JSONDecodeError:
                            logger.warning(f"Failed to parse JSON: {line}")
                            
        except Exception as e:
            logger.error(f"Receive messages error: {e}")
            
        return messages
    
    def start_daemon(self) -> bool:
        """
        Start signal-cli in daemon mode for continuous message receiving
        
        Returns:
            bool: True if daemon started successfully
        """
        try:
            cmd = [self.signal_cli_path, "-a", self.phone_number, "daemon", "--json"]
            self.daemon_process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            
            logger.info("Signal CLI daemon started")
            return True
            
        except Exception as e:
            logger.error(f"Failed to start daemon: {e}")
            return False
    
    def stop_daemon(self):
        """Stop the signal-cli daemon"""
        if self.daemon_process:
            self.daemon_process.terminate()
            self.daemon_process.wait()
            self.daemon_process = None
            logger.info("Signal CLI daemon stopped")
    
    def read_daemon_messages(self) -> List[SignalMessage]:
        """
        Read messages from the running daemon
        
        Returns:
            List of SignalMessage objects
        """
        messages = []
        
        if not self.daemon_process:
            logger.error("Daemon not running")
            return messages
        
        try:
            # Non-blocking read from stdout
            while True:
                line = self.daemon_process.stdout.readline()
                if not line:
                    break
                    
                try:
                    data = json.loads(line)
                    if 'envelope' in data:
                        envelope = data['envelope']
                        if 'dataMessage' in envelope:
                            msg = self._parse_message(envelope)
                            if msg:
                                messages.append(msg)
                except json.JSONDecodeError:
                    logger.warning(f"Failed to parse JSON: {line}")
                    
        except Exception as e:
            logger.error(f"Read daemon messages error: {e}")
            
        return messages
    
    def get_user_status(self, phone_number: str) -> Optional[Dict[str, Any]]:
        """
        Get Signal user status and UUID
        
        Args:
            phone_number: Phone number to check
            
        Returns:
            Dict with user status or None
        """
        try:
            cmd = [self.signal_cli_path, "-a", self.phone_number, "getUserStatus", phone_number, "--json"]
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0 and result.stdout:
                return json.loads(result.stdout)
            else:
                logger.error(f"Failed to get user status: {result.stderr}")
                return None
                
        except Exception as e:
            logger.error(f"Get user status error: {e}")
            return None
    
    def list_groups(self) -> List[Dict[str, Any]]:
        """
        List all Signal groups
        
        Returns:
            List of group information dictionaries
        """
        groups = []
        
        try:
            cmd = [self.signal_cli_path, "-a", self.phone_number, "listGroups", "--json"]
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0 and result.stdout:
                data = json.loads(result.stdout)
                if isinstance(data, list):
                    groups = data
                    
        except Exception as e:
            logger.error(f"List groups error: {e}")
            
        return groups
    
    def _parse_message(self, envelope: Dict[str, Any]) -> Optional[SignalMessage]:
        """
        Parse an envelope into a SignalMessage
        
        Args:
            envelope: The envelope data from signal-cli
            
        Returns:
            SignalMessage object or None
        """
        try:
            data_msg = envelope.get('dataMessage', {})
            
            return SignalMessage(
                timestamp=envelope.get('timestamp', 0),
                source=envelope.get('source', ''),
                source_number=envelope.get('sourceNumber', envelope.get('source', '')),
                source_uuid=envelope.get('sourceUuid', ''),
                source_name=envelope.get('sourceName', ''),
                message=data_msg.get('message', ''),
                group_id=data_msg.get('groupInfo', {}).get('groupId'),
                attachments=data_msg.get('attachments', [])
            )
            
        except Exception as e:
            logger.error(f"Parse message error: {e}")
            return None


class SignalBot:
    """
    Signal Bot implementation using SignalCLI
    """
    
    def __init__(self, phone_number: str, commands: Optional[Dict[str, callable]] = None):
        """
        Initialize Signal Bot
        
        Args:
            phone_number: Bot's phone number
            commands: Dictionary of command handlers
        """
        self.signal = SignalCLI(phone_number)
        self.commands = commands or {}
        self.running = False
        
        # Register default commands
        self.register_command('!help', self._help_command)
        self.register_command('!ping', self._ping_command)
    
    def register_command(self, command: str, handler: callable):
        """
        Register a command handler
        
        Args:
            command: Command string (e.g., '!help')
            handler: Function to call when command is received
        """
        self.commands[command.lower()] = handler
        logger.info(f"Registered command: {command}")
    
    def start(self):
        """Start the bot"""
        logger.info("Starting Signal bot...")
        
        if not self.signal.start_daemon():
            logger.error("Failed to start Signal daemon")
            return
        
        self.running = True
        logger.info("Signal bot started. Listening for messages...")
        
        try:
            while self.running:
                messages = self.signal.read_daemon_messages()
                
                for msg in messages:
                    self._handle_message(msg)
                
                time.sleep(1)  # Poll every second
                
        except KeyboardInterrupt:
            logger.info("Bot interrupted by user")
        finally:
            self.stop()
    
    def stop(self):
        """Stop the bot"""
        self.running = False
        self.signal.stop_daemon()
        logger.info("Signal bot stopped")
    
    def _handle_message(self, message: SignalMessage):
        """
        Handle incoming message
        
        Args:
            message: SignalMessage object
        """
        logger.info(f"Received message from {message.source_name or message.source_number}: {message.message}")
        
        # Check if it's a command
        if message.message.startswith('!'):
            parts = message.message.split(' ', 1)
            command = parts[0].lower()
            args = parts[1] if len(parts) > 1 else ''
            
            if command in self.commands:
                try:
                    self.commands[command](self, message, args)
                except Exception as e:
                    logger.error(f"Error handling command {command}: {e}")
                    self.signal.send_message(
                        message.source_number,
                        f"Error processing command: {e}"
                    )
            else:
                self.signal.send_message(
                    message.source_number,
                    f"Unknown command: {command}. Type !help for available commands."
                )
    
    def _help_command(self, bot, message: SignalMessage, args: str):
        """Default help command handler"""
        help_text = "📚 Available Commands:\n"
        for cmd in sorted(self.commands.keys()):
            help_text += f"{cmd}\n"
        
        bot.signal.send_message(message.source_number, help_text)
    
    def _ping_command(self, bot, message: SignalMessage, args: str):
        """Default ping command handler"""
        bot.signal.send_message(message.source_number, "🏓 Pong!")


# Example usage
if __name__ == "__main__":
    # Example bot with custom commands
    def echo_command(bot, message, args):
        """Echo back the arguments"""
        bot.signal.send_message(message.source_number, f"Echo: {args}")
    
    def info_command(bot, message, args):
        """Show user info"""
        info = f"""
👤 Your Info:
Phone: {message.source_number}
UUID: {message.source_uuid}
Name: {message.source_name or 'Not set'}
        """.strip()
        bot.signal.send_message(message.source_number, info)
    
    # Initialize bot
    bot_phone = os.environ.get("SIGNAL_BOT_PHONE_NUMBER", "+1234567890")
    bot = SignalBot(bot_phone)
    
    # Register custom commands
    bot.register_command('!echo', echo_command)
    bot.register_command('!info', info_command)
    
    # Start bot
    bot.start()