import { SignalBotService, SignalMessage } from './bot-service';
import { matrixService } from '../matrix';
import { prisma } from '../prisma';

export interface SignalIntegrationConfig {
  phoneNumber: string;
  aiEnabled?: boolean;
  openAiApiKey?: string;
  matrixRoomMapping?: Map<string, string>; // Signal group ID -> Matrix room ID
}

export class SignalMatrixIntegration {
  private signalBot: SignalBotService;
  private config: SignalIntegrationConfig;
  private isRunning: boolean = false;

  constructor(config: SignalIntegrationConfig) {
    this.config = config;
    this.signalBot = new SignalBotService({
      phoneNumber: config.phoneNumber,
      aiEnabled: config.aiEnabled,
      openAiApiKey: config.openAiApiKey
    });

    this.setupIntegration();
  }

  /**
   * Setup the integration between Signal and Matrix
   */
  private setupIntegration(): void {
    // Register Matrix-specific commands
    this.signalBot.registerCommand('!rooms', async (message) => {
      const rooms = await this.getAvailableRooms();
      await this.signalBot.sendMessage(message.sourceNumber, rooms);
    });

    this.signalBot.registerCommand('!join', async (message) => {
      const roomName = message.message.replace(/^!join\s+/i, '').trim();
      if (!roomName) {
        await this.signalBot.sendMessage(message.sourceNumber, 
          "Please specify a room name. Example: !join general");
        return;
      }
      
      const result = await this.joinMatrixRoom(message.sourceNumber, roomName);
      await this.signalBot.sendMessage(message.sourceNumber, result);
    });

    this.signalBot.registerCommand('!leave', async (message) => {
      const roomName = message.message.replace(/^!leave\s+/i, '').trim();
      if (!roomName) {
        await this.signalBot.sendMessage(message.sourceNumber, 
          "Please specify a room name. Example: !leave general");
        return;
      }
      
      const result = await this.leaveMatrixRoom(message.sourceNumber, roomName);
      await this.signalBot.sendMessage(message.sourceNumber, result);
    });

    this.signalBot.registerCommand('!verify', async (message) => {
      const verificationCode = message.message.replace(/^!verify\s+/i, '').trim();
      if (!verificationCode) {
        await this.signalBot.sendMessage(message.sourceNumber, 
          "Please provide your verification code. Example: !verify 123456");
        return;
      }
      
      const result = await this.verifySignalAccount(message.sourceNumber, verificationCode);
      await this.signalBot.sendMessage(message.sourceNumber, result);
    });

    this.signalBot.registerCommand('!matrix', async (message) => {
      const matrixCommand = message.message.replace(/^!matrix\s+/i, '').trim();
      const result = await this.handleMatrixCommand(message, matrixCommand);
      await this.signalBot.sendMessage(message.sourceNumber, result);
    });

    // Listen for non-command messages to bridge to Matrix
    this.signalBot.on('message', async (message: SignalMessage) => {
      await this.bridgeToMatrix(message);
    });
  }

  /**
   * Start the integration service
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Signal-Matrix integration is already running');
      return;
    }

    try {
      console.log('Starting Signal-Matrix integration...');
      await this.signalBot.startListening();
      this.isRunning = true;
      console.log('Signal-Matrix integration started successfully');
      
      // Log initial status
      const accountInfo = await this.signalBot.getAccountInfo();
      console.log('Signal account info:', accountInfo);
    } catch (error) {
      console.error('Failed to start Signal-Matrix integration:', error);
      throw error;
    }
  }

  /**
   * Stop the integration service
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      await this.signalBot.stopListening();
      this.isRunning = false;
      console.log('Signal-Matrix integration stopped');
    } catch (error) {
      console.error('Error stopping Signal-Matrix integration:', error);
    }
  }

  /**
   * Get available Matrix rooms
   */
  private async getAvailableRooms(): Promise<string> {
    try {
      const rooms = await prisma.matrixRoom.findMany({
        where: {
          memberCount: { gte: 5 }
        },
        orderBy: {
          memberCount: 'desc'
        },
        take: 10
      });

      if (rooms.length === 0) {
        return "No rooms available at the moment. Please try again later.";
      }

      const roomList = rooms.map(room => 
        `• ${room.name || 'Unnamed'} (${room.memberCount} members)`
      ).join('\n');

      return `📋 Available Rooms:\n${roomList}\n\nUse !join <room name> to join a room.`;
    } catch (error) {
      console.error('Failed to get available rooms:', error);
      return "Failed to retrieve room list. Please try again later.";
    }
  }

  /**
   * Join a Matrix room
   */
  private async joinMatrixRoom(phoneNumber: string, roomName: string): Promise<string> {
    try {
      // Find the user by phone number
      const user = await prisma.user.findFirst({
        where: {
          phoneNumber: phoneNumber.replace(/\D/g, '') // Remove non-digits
        }
      });

      if (!user) {
        return "Your account is not verified. Please complete verification first using !verify <code>";
      }

      // Find the room
      const room = await prisma.matrixRoom.findFirst({
        where: {
          name: {
            contains: roomName,
            mode: 'insensitive'
          }
        }
      });

      if (!room) {
        return `Room "${roomName}" not found. Use !rooms to see available rooms.`;
      }

      // Get Matrix user ID
      const matrixUser = await prisma.matrixUser.findFirst({
        where: {
          userId: user.id
        }
      });

      if (!matrixUser) {
        return "Your Matrix account is not set up. Please contact an administrator.";
      }

      // Join the room via Matrix service
      if (matrixService.isConfigured()) {
        await matrixService.inviteUserToRoom(room.roomId, matrixUser.matrixUserId);
        return `✅ Successfully joined room: ${room.name}`;
      } else {
        return "Matrix service is not available. Please try again later.";
      }
    } catch (error) {
      console.error('Failed to join Matrix room:', error);
      return `Failed to join room: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * Leave a Matrix room
   */
  private async leaveMatrixRoom(phoneNumber: string, roomName: string): Promise<string> {
    try {
      // Find the user by phone number
      const user = await prisma.user.findFirst({
        where: {
          phoneNumber: phoneNumber.replace(/\D/g, '')
        }
      });

      if (!user) {
        return "Your account is not verified. Please complete verification first.";
      }

      // Find the room
      const room = await prisma.matrixRoom.findFirst({
        where: {
          name: {
            contains: roomName,
            mode: 'insensitive'
          }
        }
      });

      if (!room) {
        return `Room "${roomName}" not found.`;
      }

      // Get Matrix user ID
      const matrixUser = await prisma.matrixUser.findFirst({
        where: {
          userId: user.id
        }
      });

      if (!matrixUser) {
        return "Your Matrix account is not set up.";
      }

      // Leave the room via Matrix service
      if (matrixService.isConfigured()) {
        await matrixService.removeUserFromRoom(room.roomId, matrixUser.matrixUserId);
        return `✅ Successfully left room: ${room.name}`;
      } else {
        return "Matrix service is not available. Please try again later.";
      }
    } catch (error) {
      console.error('Failed to leave Matrix room:', error);
      return `Failed to leave room: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * Verify Signal account with verification code
   */
  private async verifySignalAccount(phoneNumber: string, code: string): Promise<string> {
    try {
      // Check if verification code is valid
      const verification = await prisma.verificationCode.findFirst({
        where: {
          phoneNumber: phoneNumber.replace(/\D/g, ''),
          code: code,
          used: false,
          expiresAt: {
            gt: new Date()
          }
        }
      });

      if (!verification) {
        return "Invalid or expired verification code. Please request a new code.";
      }

      // Mark code as used
      await prisma.verificationCode.update({
        where: { id: verification.id },
        data: { used: true }
      });

      // Update or create user
      const _user = await prisma.user.upsert({
        where: {
          phoneNumber: phoneNumber.replace(/\D/g, '')
        },
        update: {
          signalVerified: true,
          signalUuid: await this.signalBot.resolvePhoneToUuid(phoneNumber)
        },
        create: {
          phoneNumber: phoneNumber.replace(/\D/g, ''),
          signalVerified: true,
          signalUuid: await this.signalBot.resolvePhoneToUuid(phoneNumber),
          username: `signal_${phoneNumber.replace(/\D/g, '')}`,
          email: `${phoneNumber.replace(/\D/g, '')}@signal.local`
        }
      });

      return `✅ Verification successful! Your account is now verified. Use !help to see available commands.`;
    } catch (_error) {
      console.error('Failed to verify Signal account:', _error);
      return `Verification failed: ${_error instanceof Error ? _error.message : 'Unknown error'}`;
    }
  }

  /**
   * Handle Matrix-specific commands
   */
  private async handleMatrixCommand(message: SignalMessage, command: string): Promise<string> {
    const parts = command.split(' ');
    const subCommand = parts[0]?.toLowerCase();

    switch (subCommand) {
      case 'status':
        return await this.getMatrixStatus();
      
      case 'sync':
        return await this.syncMatrixData();
      
      case 'search':
        const searchTerm = parts.slice(1).join(' ');
        return await this.searchMatrixUsers(searchTerm);
      
      default:
        return `Unknown Matrix command. Available: status, sync, search <term>`;
    }
  }

  /**
   * Get Matrix service status
   */
  private async getMatrixStatus(): Promise<string> {
    try {
      const isConfigured = matrixService.isConfigured();
      const roomCount = await prisma.matrixRoom.count();
      const userCount = await prisma.matrixUser.count();

      return `
📊 Matrix Status:
Service: ${isConfigured ? 'Connected' : 'Disconnected'}
Rooms: ${roomCount}
Users: ${userCount}
Last sync: ${new Date().toLocaleString()}
      `.trim();
    } catch (error) {
      return "Failed to get Matrix status.";
    }
  }

  /**
   * Sync Matrix data
   */
  private async syncMatrixData(): Promise<string> {
    try {
      if (!matrixService.isConfigured()) {
        return "Matrix service is not configured.";
      }

      // Trigger sync
      await matrixService.syncMatrixUsers();
      
      return "✅ Matrix data sync initiated. This may take a few moments.";
    } catch (error) {
      return `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * Search Matrix users
   */
  private async searchMatrixUsers(searchTerm: string): Promise<string> {
    if (!searchTerm) {
      return "Please provide a search term.";
    }

    try {
      const users = await prisma.matrixUser.findMany({
        where: {
          OR: [
            { displayName: { contains: searchTerm, mode: 'insensitive' } },
            { matrixUserId: { contains: searchTerm, mode: 'insensitive' } }
          ]
        },
        take: 5
      });

      if (users.length === 0) {
        return `No users found matching "${searchTerm}"`;
      }

      const userList = users.map(u => 
        `• ${u.displayName || 'Unknown'} (${u.matrixUserId})`
      ).join('\n');

      return `Found ${users.length} user(s):\n${userList}`;
    } catch (_error) {
      return "Search failed. Please try again.";
    }
  }

  /**
   * Bridge Signal message to Matrix
   */
  private async bridgeToMatrix(message: SignalMessage): Promise<void> {
    try {
      // Check if this is a group message that should be bridged
      if (message.groupId && this.config.matrixRoomMapping?.has(message.groupId)) {
        const matrixRoomId = this.config.matrixRoomMapping.get(message.groupId);
        
        if (matrixRoomId && matrixService.isConfigured()) {
          const bridgedMessage = `[Signal] ${message.sourceName || message.sourceNumber}: ${message.message}`;
          await matrixService.sendRoomMessage(matrixRoomId, bridgedMessage);
          console.log(`Bridged message from Signal to Matrix room ${matrixRoomId}`);
        }
      }
    } catch (error) {
      console.error('Failed to bridge message to Matrix:', error);
    }
  }

  /**
   * Send message from Matrix to Signal
   */
  public async sendFromMatrix(matrixUserId: string, signalRecipient: string, message: string): Promise<void> {
    try {
      const bridgedMessage = `[Matrix] ${matrixUserId}: ${message}`;
      await this.signalBot.sendMessage(signalRecipient, bridgedMessage);
      console.log(`Bridged message from Matrix to Signal ${signalRecipient}`);
    } catch (error) {
      console.error('Failed to bridge message to Signal:', error);
      throw error;
    }
  }
}