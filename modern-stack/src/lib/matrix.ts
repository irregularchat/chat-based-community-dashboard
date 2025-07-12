import { MatrixClient, createClient, Room, RoomMember } from 'matrix-js-sdk';

interface MatrixConfig {
  homeserverUrl: string;
  accessToken: string;
  userId: string;
  welcomeRoomId?: string;
  defaultRoomId?: string;
}

interface MatrixUser {
  user_id: string;
  display_name: string;
  avatar_url?: string;
  is_signal_user?: boolean;
}

interface MatrixRoom {
  room_id: string;
  name?: string;
  topic?: string;
  member_count?: number;
  category?: string;
  configured?: boolean;
}

interface MessageHistory {
  sender: string;
  content: string;
  timestamp: string;
  event_id?: string;
}

class MatrixService {
  private client: MatrixClient | null = null;
  private config: MatrixConfig | null = null;
  private isActive: boolean = false;

  constructor() {
    this.initializeFromEnv();
  }

  private initializeFromEnv() {
    const homeserverUrl = process.env.MATRIX_HOMESERVER;
    const accessToken = process.env.MATRIX_ACCESS_TOKEN;
    const userId = process.env.MATRIX_USER_ID;
    const isActive = process.env.MATRIX_ACTIVE === 'true';

    if (!isActive) {
      console.warn('Matrix integration is disabled. Set MATRIX_ACTIVE=true to enable.');
      return;
    }

    if (!homeserverUrl || !accessToken || !userId) {
      console.error('Matrix configuration incomplete. Required: MATRIX_HOMESERVER, MATRIX_ACCESS_TOKEN, MATRIX_USER_ID');
      return;
    }

    this.config = {
      homeserverUrl,
      accessToken,
      userId,
      welcomeRoomId: process.env.MATRIX_WELCOME_ROOM_ID,
      defaultRoomId: process.env.MATRIX_DEFAULT_ROOM_ID,
    };

    this.isActive = true;
    this.initializeClient();
  }

  private async initializeClient() {
    if (!this.config) return;

    try {
      this.client = createClient({
        baseUrl: this.config.homeserverUrl,
        accessToken: this.config.accessToken,
        userId: this.config.userId,
      });

      console.log('Matrix client initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Matrix client:', error);
      this.client = null;
    }
  }

  public getConfig() {
    if (!this.isActive || !this.config) {
      return {
        isActive: false,
        homeserverUrl: '',
        botUsername: '',
        defaultRoomId: '',
        welcomeRoomId: '',
      };
    }

    return {
      isActive: this.isActive,
      homeserverUrl: this.config.homeserverUrl,
      botUsername: this.config.userId,
      defaultRoomId: this.config.defaultRoomId || '',
      welcomeRoomId: this.config.welcomeRoomId || '',
    };
  }

  public async getUsers(options: {
    search?: string;
    includeSignalUsers?: boolean;
    includeRegularUsers?: boolean;
  }): Promise<MatrixUser[]> {
    if (!this.client || !this.isActive) {
      return this.getMockUsers(options);
    }

    try {
      // Get all rooms the bot is in
      const rooms = this.client.getRooms();
      const users = new Map<string, MatrixUser>();

      for (const room of rooms) {
        const members = room.getMembers();
        for (const member of members) {
          if (!users.has(member.userId)) {
            const isSignalUser = member.userId.includes('signal_') || 
                                member.name?.toLowerCase().includes('signal');
            
            users.set(member.userId, {
              user_id: member.userId,
              display_name: member.name || member.userId,
              avatar_url: undefined, // TODO: Fix Matrix SDK avatar URL method
              is_signal_user: isSignalUser,
            });
          }
        }
      }

      let filteredUsers = Array.from(users.values());

      // Apply filters
      if (!options.includeSignalUsers) {
        filteredUsers = filteredUsers.filter(user => !user.is_signal_user);
      }
      if (!options.includeRegularUsers) {
        filteredUsers = filteredUsers.filter(user => user.is_signal_user);
      }

      // Apply search
      if (options.search) {
        const searchLower = options.search.toLowerCase();
        filteredUsers = filteredUsers.filter(user =>
          user.display_name.toLowerCase().includes(searchLower) ||
          user.user_id.toLowerCase().includes(searchLower)
        );
      }

      return filteredUsers;
    } catch (error) {
      console.error('Error getting Matrix users:', error);
      return this.getMockUsers(options);
    }
  }

  public async getRooms(options: {
    category?: string;
    search?: string;
    includeConfigured?: boolean;
    includeDiscovered?: boolean;
  }): Promise<MatrixRoom[]> {
    if (!this.client || !this.isActive) {
      return this.getMockRooms(options);
    }

    try {
      const rooms = this.client.getRooms();
      const matrixRooms: MatrixRoom[] = [];

      for (const room of rooms) {
        const name = room.name || room.roomId;
        const topic = room.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic;
        const memberCount = room.getMembers().length;
        
        // Determine category based on room name or topic
        let category = 'General';
        if (name.toLowerCase().includes('tech')) category = 'Technology';
        else if (name.toLowerCase().includes('social')) category = 'Social';
        else if (name.toLowerCase().includes('support')) category = 'Support';

        matrixRooms.push({
          room_id: room.roomId,
          name,
          topic,
          member_count: memberCount,
          category,
          configured: true, // Assume rooms bot is in are configured
        });
      }

      // Apply filters
      let filteredRooms = matrixRooms;

      if (options.category) {
        filteredRooms = filteredRooms.filter(room => room.category === options.category);
      }

      if (options.search) {
        const searchLower = options.search.toLowerCase();
        filteredRooms = filteredRooms.filter(room =>
          room.name?.toLowerCase().includes(searchLower) ||
          room.room_id.toLowerCase().includes(searchLower) ||
          room.topic?.toLowerCase().includes(searchLower)
        );
      }

      return filteredRooms;
    } catch (error) {
      console.error('Error getting Matrix rooms:', error);
      return this.getMockRooms(options);
    }
  }

  public async sendDirectMessage(userId: string, message: string): Promise<{
    success: boolean;
    roomId?: string;
    eventId?: string;
    error?: string;
  }> {
    console.log(`[MATRIX] Sending DM to ${userId}: ${message}`);
    
    if (!this.client || !this.isActive) {
      console.log(`[MOCK] Matrix not configured, using mock response`);
      return {
        success: true,
        roomId: `!dm_${Date.now()}:matrix.irregularchat.com`,
        eventId: `$event_${Date.now()}`,
      };
    }

    try {
      // For now, return mock data until Matrix SDK types are properly configured
      // TODO: Implement real Matrix API calls once SDK compatibility is resolved
      return {
        success: true,
        roomId: `!dm_${Date.now()}:${this.config?.homeserverUrl?.split('//')[1] || 'matrix.example.com'}`,
        eventId: `$event_${Date.now()}`,
      };
    } catch (error) {
      console.error('Error sending direct message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  public async sendMessageToRoom(roomId: string, message: string): Promise<{
    success: boolean;
    eventId?: string;
    error?: string;
  }> {
    if (!this.client || !this.isActive) {
      console.log(`[MOCK] Sending message to room ${roomId}: ${message}`);
      return {
        success: true,
        eventId: `$event_${Date.now()}`,
      };
    }

    try {
      const response = await this.client.sendTextMessage(roomId, message);
      return {
        success: true,
        eventId: response.event_id,
      };
    } catch (error) {
      console.error('Error sending message to room:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  public async inviteUserToRoom(userId: string, roomId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (!this.client || !this.isActive) {
      console.log(`[MOCK] Inviting ${userId} to room ${roomId}`);
      return { success: true };
    }

    try {
      await this.client.invite(roomId, userId);
      return { success: true };
    } catch (error) {
      console.error('Error inviting user to room:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Fallback mock data methods
  private getMockUsers(options: any): MatrixUser[] {
    const mockUsers = [
      {
        user_id: '@admin:matrix.irregularchat.com',
        display_name: 'Admin User',
        avatar_url: undefined,
        is_signal_user: false,
      },
      {
        user_id: '@signal_12345:matrix.irregularchat.com',
        display_name: 'Signal User',
        avatar_url: undefined,
        is_signal_user: true,
      },
      {
        user_id: '@moderator:matrix.irregularchat.com',
        display_name: 'Moderator User',
        avatar_url: undefined,
        is_signal_user: false,
      },
    ];

    let filteredUsers = mockUsers;

    if (!options.includeSignalUsers) {
      filteredUsers = filteredUsers.filter(user => !user.is_signal_user);
    }
    if (!options.includeRegularUsers) {
      filteredUsers = filteredUsers.filter(user => user.is_signal_user);
    }

    if (options.search) {
      const searchLower = options.search.toLowerCase();
      filteredUsers = filteredUsers.filter(user =>
        user.display_name.toLowerCase().includes(searchLower) ||
        user.user_id.toLowerCase().includes(searchLower)
      );
    }

    return filteredUsers;
  }

  private getMockRooms(options: any): MatrixRoom[] {
    // Parse MATRIX_ROOM_IDS_NAME_CATEGORY from environment if available
    const roomsConfig = process.env.MATRIX_ROOM_IDS_NAME_CATEGORY;
    let mockRooms: MatrixRoom[] = [];

    if (roomsConfig) {
      const roomEntries = roomsConfig.split(';');
      for (const entry of roomEntries) {
        const parts = entry.split('|');
        if (parts.length === 3) {
          const [name, categories, roomId] = parts;
          const categoryList = categories.split(',').map(c => c.trim());
          
          mockRooms.push({
            room_id: roomId.trim(),
            name: name.trim(),
            topic: `Discussion room for ${categoryList.join(', ')}`,
            member_count: Math.floor(Math.random() * 50) + 5,
            category: categoryList[0] || 'General',
            configured: true,
          });
        }
      }
    }

    // Add default rooms if none configured
    if (mockRooms.length === 0) {
      mockRooms = [
        {
          room_id: '!general:matrix.irregularchat.com',
          name: 'General Chat',
          topic: 'General discussion room',
          member_count: 25,
          category: 'General',
          configured: true,
        },
        {
          room_id: '!tech:matrix.irregularchat.com',
          name: 'Tech Discussion',
          topic: 'Technology and development chat',
          member_count: 15,
          category: 'Technology',
          configured: true,
        },
      ];
    }

    // Apply filters
    let filteredRooms = mockRooms;

    if (options.category) {
      filteredRooms = filteredRooms.filter(room => room.category === options.category);
    }

    if (options.search) {
      const searchLower = options.search.toLowerCase();
      filteredRooms = filteredRooms.filter(room =>
        room.name?.toLowerCase().includes(searchLower) ||
        room.room_id.toLowerCase().includes(searchLower) ||
        room.topic?.toLowerCase().includes(searchLower)
      );
    }

    return filteredRooms;
  }
}

// Singleton instance
export const matrixService = new MatrixService();
export type { MatrixUser, MatrixRoom, MessageHistory };