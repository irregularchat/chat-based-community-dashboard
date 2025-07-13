import { MatrixClient, createClient, MsgType } from 'matrix-js-sdk';

interface MatrixConfig {
  homeserver: string;
  accessToken: string;
  userId: string;
  welcomeRoomId?: string;
  defaultRoomId?: string;
}

interface WelcomeMessageData {
  username: string;
  fullName: string;
  tempPassword: string;
  discourseUrl?: string;
}

interface DirectMessageResult {
  success: boolean;
  roomId?: string;
  eventId?: string;
  error?: string;
}

class MatrixService {
  private config: MatrixConfig | null = null;
  private client: MatrixClient | null = null;
  private isActive = false;

  constructor() {
    this.initializeFromEnv();
  }

  private initializeFromEnv() {
    const homeserver = process.env.MATRIX_HOMESERVER;
    const accessToken = process.env.MATRIX_ACCESS_TOKEN;
    const userId = process.env.MATRIX_USER_ID;
    const welcomeRoomId = process.env.MATRIX_WELCOME_ROOM_ID;
    const defaultRoomId = process.env.MATRIX_DEFAULT_ROOM_ID;

    if (!homeserver || !accessToken || !userId) {
      console.warn('Matrix not configured. Required: MATRIX_HOMESERVER, MATRIX_ACCESS_TOKEN, MATRIX_USER_ID');
      return;
    }

    this.config = {
      homeserver,
      accessToken,
      userId,
      welcomeRoomId,
      defaultRoomId,
    };

    try {
      this.client = createClient({
        baseUrl: homeserver,
        accessToken: accessToken,
        userId: userId,
      });

      this.isActive = true;
      console.log('Matrix service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Matrix client:', error);
    }
  }

  private generateWelcomeMessage(data: WelcomeMessageData): string {
    const { username, fullName, tempPassword, discourseUrl } = data;

    let message = `🎉 Welcome to IrregularChat, ${fullName}!

Your account has been successfully created:
👤 **Username:** ${username}
🔑 **Temporary Password:** ${tempPassword}

📋 **Next Steps:**
1. Log in to the community dashboard
2. Change your password for security
3. Complete your profile
4. Join relevant Matrix rooms
5. Introduce yourself to the community

`;

    if (discourseUrl) {
      message += `🗣️ **Your Introduction Post:** ${discourseUrl}\n\n`;
    }

    message += `📚 **Learn More:** https://irregularpedia.org/index.php/Main_Page

Welcome aboard! 🚀`;

    return message;
  }

  public async sendWelcomeMessage(
    matrixUserId: string,
    username: string,
    fullName: string,
    tempPassword: string,
    discourseUrl?: string
  ): Promise<DirectMessageResult> {
    if (!this.isActive || !this.client) {
      return {
        success: false,
        error: 'Matrix service not configured',
      };
    }

    try {
      const welcomeMessage = this.generateWelcomeMessage({
        username,
        fullName,
        tempPassword,
        discourseUrl,
      });

      return await this.sendDirectMessage(matrixUserId, welcomeMessage);
    } catch (error) {
      console.error('Error sending welcome message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  public async sendDirectMessage(
    matrixUserId: string,
    message: string
  ): Promise<DirectMessageResult> {
    if (!this.isActive || !this.client) {
      return {
        success: false,
        error: 'Matrix service not configured',
      };
    }

    try {
      console.log(`Sending direct message to ${matrixUserId}`);

      // Create or get existing direct message room
      const roomId = await this.getOrCreateDirectRoom(matrixUserId);
      if (!roomId) {
        return {
          success: false,
          error: 'Failed to create or find direct message room',
        };
      }

      // Send the message
      const response = await this.client.sendEvent(roomId, 'm.room.message', {
        msgtype: MsgType.Text,
        body: message,
      });

      console.log(`Message sent successfully to ${matrixUserId} in room ${roomId}`);
      return {
        success: true,
        roomId,
        eventId: response.event_id,
      };
    } catch (error) {
      console.error('Error sending direct message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async getOrCreateDirectRoom(matrixUserId: string): Promise<string | null> {
    if (!this.client) return null;

    try {
      // Try to find existing direct room
      const rooms = this.client.getRooms();
      for (const room of rooms) {
        // Check if room is a direct message room (has exactly 2 members)
        const members = room.getMembers();
        if (members.length === 2 && members.some(member => member.userId === matrixUserId)) {
          return room.roomId;
        }
      }

      // Create new direct room
      const response = await this.client.createRoom({
        is_direct: true,
        invite: [matrixUserId],
      });

      return response.room_id;
    } catch (error) {
      console.error('Error getting or creating direct room:', error);
      return null;
    }
  }

  public async sendRoomMessage(roomId: string, message: string): Promise<DirectMessageResult> {
    if (!this.isActive || !this.client) {
      return {
        success: false,
        error: 'Matrix service not configured',
      };
    }

    try {
      const response = await this.client.sendEvent(roomId, 'm.room.message', {
        msgtype: MsgType.Text,
        body: message,
      });

      return {
        success: true,
        roomId,
        eventId: response.event_id,
      };
    } catch (error) {
      console.error('Error sending room message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  public async inviteToRoom(roomId: string, matrixUserId: string): Promise<boolean> {
    if (!this.isActive || !this.client) {
      console.warn('Matrix service not configured');
      return false;
    }

    try {
      await this.client.invite(roomId, matrixUserId);
      console.log(`Successfully invited ${matrixUserId} to room ${roomId}`);
      return true;
    } catch (error) {
      console.error(`Error inviting ${matrixUserId} to room ${roomId}:`, error);
      return false;
    }
  }

  public async inviteToRecommendedRooms(
    matrixUserId: string,
    interests: string[] = []
  ): Promise<{ success: boolean; invitedRooms: string[]; errors: string[] }> {
    if (!this.isActive || !this.client) {
      return {
        success: false,
        invitedRooms: [],
        errors: ['Matrix service not configured'],
      };
    }

    const invitedRooms: string[] = [];
    const errors: string[] = [];

    // Room mapping based on interests - this should be configurable
    const roomMappings: Record<string, string[]> = {
      'security': ['!security:example.com', '!cybersecurity:example.com'],
      'ai': ['!ai:example.com', '!machinelearning:example.com'],
      'development': ['!dev:example.com', '!programming:example.com'],
      'general': ['!general:example.com'],
    };

    // Default rooms everyone should be invited to
    const defaultRooms = ['!announcements:example.com', '!welcome:example.com'];

    // Collect all relevant rooms
    const roomsToInvite = new Set(defaultRooms);
    
    interests.forEach(interest => {
      const interestRooms = roomMappings[interest.toLowerCase()];
      if (interestRooms) {
        interestRooms.forEach(room => roomsToInvite.add(room));
      }
    });

    // Send invitations
    for (const roomId of roomsToInvite) {
      try {
        const success = await this.inviteToRoom(roomId, matrixUserId);
        if (success) {
          invitedRooms.push(roomId);
        } else {
          errors.push(`Failed to invite to room ${roomId}`);
        }
      } catch (error) {
        errors.push(`Error inviting to room ${roomId}: ${error}`);
      }
    }

    return {
      success: errors.length === 0,
      invitedRooms,
      errors,
    };
  }

  public async sendINDOCGraduationMessage(
    roomId: string,
    matrixUserId: string,
    displayName: string
  ): Promise<DirectMessageResult> {
    if (!this.isActive || !this.client) {
      return {
        success: false,
        error: 'Matrix service not configured',
      };
    }

    const graduationTemplate = `@${displayName} Good to go. Thanks for verifying. This is how we keep the community safe.
1. Please leave this chat
2. You'll receive a direct message with your IrregularChat Login and a Link to all the chats.
3. Join all the Chats that interest you when you get your login
4. Until then, Learn about the community https://irregularpedia.org/index.php/Main_Page

See you out there!`;

    // Create HTML mention link
    const mentionHtml = `<a href="https://matrix.to/#/${matrixUserId}" data-mention-type="user">@${displayName}</a>`;
    const htmlMessage = graduationTemplate.replace(`@${displayName}`, mentionHtml);

    try {
      const response = await this.client.sendEvent(roomId, 'm.room.message', {
        msgtype: MsgType.Text,
        body: graduationTemplate,
        format: 'org.matrix.custom.html',
        formatted_body: htmlMessage,
      });

      return {
        success: true,
        roomId,
        eventId: response.event_id,
      };
    } catch (error) {
      console.error('Error sending INDOC graduation message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  public isConfigured(): boolean {
    return this.isActive;
  }

  public getConfig(): MatrixConfig | null {
    return this.config;
  }
}

// Export singleton instance
export const matrixService = new MatrixService();