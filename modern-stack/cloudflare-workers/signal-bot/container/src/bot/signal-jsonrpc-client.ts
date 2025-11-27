/**
 * Signal CLI JSON-RPC Client
 *
 * Provides a TypeScript client for interacting with signal-cli's JSON-RPC interface
 * over TCP sockets.
 */

import net from 'net';
import { EventEmitter } from 'events';
import { DebugLogger } from '../utils/debug-logger.js';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, any>;
  id: string | number;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: string | number | null;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

export interface SendMessageParams {
  message: string;
  recipient?: string[];
  groupId?: string;
  attachment?: string[];
  mention?: string[];
  quoteTimestamp?: number;
  quoteAuthor?: string;
  quoteMessage?: string;
  sticker?: string;
  previewUrl?: string;
  previewTitle?: string;
  previewDescription?: string;
}

export interface ListGroupsResult {
  id: string;
  name: string;
  description?: string;
  isMember: boolean;
  isBlocked: boolean;
  messageExpirationTime: number;
  members: string[];
  pendingMembers: string[];
  requestingMembers: string[];
  admins: string[];
  banned: string[];
  permissionAddMember: string;
  permissionEditDetails: string;
  permissionSendMessage: string;
  groupInviteLink?: string;
}

/**
 * Signal CLI JSON-RPC Client
 *
 * Connects to signal-cli daemon running in TCP mode and provides
 * methods for sending messages, listing groups, and receiving notifications.
 */
export class SignalJsonRpcClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<string | number, {
    resolve: (result: any) => void;
    reject: (error: Error) => void;
  }>();
  private buffer = '';
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private debugLogger?: DebugLogger;

  constructor(
    private host: string = 'localhost',
    private port: number = 7583,
    debugLogger?: DebugLogger
  ) {
    super();
    this.debugLogger = debugLogger;
  }

  /**
   * Connect to signal-cli JSON-RPC daemon
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.connect(this.port, this.host);

      this.socket.on('connect', () => {
        console.log(`✅ Connected to signal-cli JSON-RPC at ${this.host}:${this.port}`);
        this.reconnectAttempts = 0;
        this.emit('connected');

        // Debug logging
        this.debugLogger?.logConnectionOpen('signal-jsonrpc', {
          host: this.host,
          port: this.port,
        });

        resolve();
      });

      this.socket.on('data', (data) => {
        this.handleData(data);
      });

      this.socket.on('error', (error) => {
        console.error('Signal JSON-RPC socket error:', error);
        this.emit('error', error);

        // Debug logging
        this.debugLogger?.logConnectionError('signal-jsonrpc', error, {
          host: this.host,
          port: this.port,
          reconnectAttempts: this.reconnectAttempts,
        });

        if (this.reconnectAttempts === 0) {
          reject(error);
        }
      });

      this.socket.on('close', () => {
        console.log('Signal JSON-RPC connection closed');
        this.socket = null;
        this.emit('disconnected');

        // Debug logging
        this.debugLogger?.logConnectionClose('signal-jsonrpc', {
          host: this.host,
          port: this.port,
          reconnectAttempts: this.reconnectAttempts,
          maxReconnectAttempts: this.maxReconnectAttempts,
        });

        // Auto-reconnect
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
          console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

          // Debug logging for reconnect attempt
          this.debugLogger?.logReconnectAttempt('signal-jsonrpc', this.reconnectAttempts, this.maxReconnectAttempts, delay);

          this.reconnectTimeout = setTimeout(() => {
            this.connect().catch((error) => {
              console.error('Reconnection failed:', error);
            });
          }, delay);
        }
      });
    });
  }

  /**
   * Disconnect from signal-cli daemon
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    // Reject all pending requests
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
  }

  /**
   * Handle incoming data from socket
   */
  private handleData(data: Buffer): void {
    this.buffer += data.toString();

    // Process all complete lines
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.substring(0, newlineIndex).trim();
      this.buffer = this.buffer.substring(newlineIndex + 1);

      if (line) {
        try {
          const message = JSON.parse(line);
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse JSON-RPC message:', line, error);
        }
      }
    }
  }

  /**
   * Handle parsed JSON-RPC message
   */
  private handleMessage(message: JsonRpcResponse | JsonRpcNotification): void {
    // Check if it's a response (has 'id') or notification (no 'id')
    if ('id' in message && message.id !== null) {
      // Response to a request
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);

        if (message.error) {
          // Debug logging for RPC error
          this.debugLogger?.logRpcError(
            'unknown',
            new Error(`JSON-RPC Error ${message.error.code}: ${message.error.message}`),
            message.id
          );

          pending.reject(new Error(`JSON-RPC Error ${message.error.code}: ${message.error.message}`));
        } else {
          pending.resolve(message.result);
        }
      }
    } else {
      // Notification (incoming message)
      const notification = message as JsonRpcNotification;
      console.log('🔔 Received JSON-RPC notification:', JSON.stringify(notification).substring(0, 200));

      // Debug logging for incoming message
      this.debugLogger?.logMessageReceived('signal-jsonrpc', {
        method: notification.method,
        hasParams: !!notification.params,
        paramsPreview: notification.params ? JSON.stringify(notification.params).substring(0, 100) : undefined,
      });

      this.emit('notification', notification);
    }
  }

  /**
   * Send JSON-RPC request
   */
  private async request(method: string, params?: Record<string, any>): Promise<any> {
    if (!this.socket) {
      throw new Error('Not connected to signal-cli daemon');
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    };

    // Debug logging for RPC request
    this.debugLogger?.logRpcRequest(method, params, id);

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const requestStr = JSON.stringify(request) + '\n';
      this.socket!.write(requestStr, (error) => {
        if (error) {
          this.pendingRequests.delete(id);

          // Debug logging for write error
          this.debugLogger?.logRpcError(method, error, id);

          reject(error);
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);

          // Debug logging for timeout
          this.debugLogger?.logRpcTimeout(method, 30000, id);

          reject(new Error(`Request timeout for method: ${method}`));
        }
      }, 30000);
    });
  }

  /**
   * Send a message via Signal
   */
  async sendMessage(params: SendMessageParams): Promise<void> {
    // Convert single recipient to array format
    const rpcParams: any = {
      message: params.message,
    };

    if (params.recipient) {
      rpcParams.recipient = Array.isArray(params.recipient) ? params.recipient : [params.recipient];
    }

    if (params.groupId) {
      rpcParams.groupId = params.groupId;
    }

    if (params.attachment) {
      rpcParams.attachment = params.attachment;
    }

    if (params.mention) {
      rpcParams.mention = params.mention;
    }

    if (params.quoteTimestamp !== undefined) {
      rpcParams.quoteTimestamp = params.quoteTimestamp;
    }

    if (params.quoteAuthor) {
      rpcParams.quoteAuthor = params.quoteAuthor;
    }

    if (params.quoteMessage) {
      rpcParams.quoteMessage = params.quoteMessage;
    }

    const result = await this.request('send', rpcParams);
    return result;
  }

  /**
   * List all groups
   */
  async listGroups(): Promise<ListGroupsResult[]> {
    const result = await this.request('listGroups', { detailed: true });
    return result || [];
  }

  /**
   * Get account information
   */
  async getAccountInfo(): Promise<any> {
    return await this.request('getUserStatus');
  }

  /**
   * Subscribe to receive messages
   */
  async subscribeReceive(): Promise<string> {
    return await this.request('subscribeReceive');
  }

  /**
   * Unsubscribe from receiving messages
   */
  async unsubscribeReceive(subscriptionId: string): Promise<void> {
    await this.request('unsubscribeReceive', { subscription: subscriptionId });
  }

  /**
   * Receive messages (polling approach)
   */
  async receive(timeout?: number): Promise<any[]> {
    const params = timeout !== undefined ? { timeout } : undefined;
    const result = await this.request('receive', params);
    return result || [];
  }

  /**
   * Update group - add or remove members
   *
   * Based on proven working implementation from commit 5613326b
   * Uses singular "member" parameter (not "addMembers") with array of UUIDs
   */
  async updateGroup(params: {
    groupId: string;
    member?: string[];  // Array of phone numbers or UUIDs to add
    removeMember?: string[];  // Array of phone numbers or UUIDs to remove
    name?: string;
    description?: string;
    avatar?: string;
  }): Promise<void> {
    const rpcParams: any = {
      groupId: params.groupId,
    };

    if (params.member && params.member.length > 0) {
      rpcParams.member = params.member;
    }

    if (params.removeMember && params.removeMember.length > 0) {
      rpcParams.removeMember = params.removeMember;
    }

    if (params.name) {
      rpcParams.name = params.name;
    }

    if (params.description) {
      rpcParams.description = params.description;
    }

    if (params.avatar) {
      rpcParams.avatar = params.avatar;
    }

    await this.request('updateGroup', rpcParams);
  }

  /**
   * Send a reaction to a message
   */
  async sendReaction(params: {
    recipient?: string;
    groupId?: string;
    emoji: string;
    targetAuthor: string;
    targetTimestamp: number;
    remove?: boolean;
  }): Promise<void> {
    const rpcParams: any = {
      emoji: params.emoji,
      targetAuthor: params.targetAuthor,
      targetTimestamp: params.targetTimestamp,
    };

    if (params.recipient) {
      rpcParams.recipient = params.recipient;
    }

    if (params.groupId) {
      rpcParams.groupId = params.groupId;
    }

    if (params.remove !== undefined) {
      rpcParams.remove = params.remove;
    }

    await this.request('sendReaction', rpcParams);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }
}
