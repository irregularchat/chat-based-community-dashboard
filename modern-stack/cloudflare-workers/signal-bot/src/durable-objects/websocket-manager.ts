/**
 * WebSocket Manager Durable Object
 *
 * Manages WebSocket connections for real-time updates.
 * Allows clients to receive real-time notifications about:
 * - New messages
 * - Bot status changes
 * - Command results
 * - System events
 *
 * Features:
 * - Connection management
 * - Room-based broadcasting (per group)
 * - Message filtering and routing
 * - Connection health monitoring
 * - Automatic reconnection support
 */

export interface WebSocketConnection {
  socket: WebSocket;
  id: string;
  userId?: string;
  rooms: Set<string>; // Group IDs or 'global'
  connectedAt: number;
  lastActivity: number;
  metadata?: Record<string, any>;
}

export interface BroadcastMessage {
  type: 'message' | 'status' | 'command' | 'event';
  room?: string;
  data: any;
  timestamp: number;
}

export class WebSocketManager {
  private state: DurableObjectState;
  private connections: Map<string, WebSocketConnection>;
  private rooms: Map<string, Set<string>>; // roomId -> Set<connectionId>

  constructor(state: DurableObjectState) {
    this.state = state;
    this.connections = new Map();
    this.rooms = new Map();

    // Start connection health checker (every 30 seconds)
    (this.state as any).setAlarm(Date.now() + 30000);
  }

  /**
   * Handle HTTP requests (including WebSocket upgrades)
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      // WebSocket upgrade
      if (pathname === '/ws' && request.headers.get('Upgrade') === 'websocket') {
        return this.handleWebSocketUpgrade(request);
      }

      // Broadcast message to room
      if (pathname === '/broadcast' && request.method === 'POST') {
        const message: BroadcastMessage = await request.json();
        return this.broadcast(message);
      }

      // Get manager status
      if (pathname === '/status' && request.method === 'GET') {
        return this.getStatus();
      }

      // Get connections
      if (pathname === '/connections' && request.method === 'GET') {
        return this.getConnections();
      }

      // Disconnect a client
      if (pathname === '/disconnect' && request.method === 'POST') {
        const { connectionId } = await request.json() as { connectionId: string };
        return this.disconnect(connectionId);
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('WebSocketManager error:', error);
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error'
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  /**
   * Handle WebSocket upgrade
   */
  private handleWebSocketUpgrade(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket connection
    this.state.acceptWebSocket(server);

    const connectionId = this.generateId();
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId') || undefined;
    const room = url.searchParams.get('room') || 'global';

    const connection: WebSocketConnection = {
      socket: server,
      id: connectionId,
      userId,
      rooms: new Set([room]),
      connectedAt: Date.now(),
      lastActivity: Date.now(),
    };

    this.connections.set(connectionId, connection);
    this.addToRoom(room, connectionId);

    // Send welcome message
    server.send(JSON.stringify({
      type: 'connected',
      connectionId,
      timestamp: Date.now()
    }));

    console.log(`WebSocket connected: ${connectionId} (room: ${room})`);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * Handle WebSocket messages
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Find connection
    const connection = Array.from(this.connections.values()).find(
      c => c.socket === ws
    );

    if (!connection) {
      console.error('WebSocket message from unknown connection');
      return;
    }

    connection.lastActivity = Date.now();

    // Parse message
    try {
      const data = typeof message === 'string' ? JSON.parse(message) : null;

      if (!data) return;

      // Handle different message types
      switch (data.type) {
        case 'join':
          // Join a room
          if (data.room) {
            this.addToRoom(data.room, connection.id);
            connection.rooms.add(data.room);
            ws.send(JSON.stringify({
              type: 'joined',
              room: data.room,
              timestamp: Date.now()
            }));
          }
          break;

        case 'leave':
          // Leave a room
          if (data.room) {
            this.removeFromRoom(data.room, connection.id);
            connection.rooms.delete(data.room);
            ws.send(JSON.stringify({
              type: 'left',
              room: data.room,
              timestamp: Date.now()
            }));
          }
          break;

        case 'ping':
          // Heartbeat
          ws.send(JSON.stringify({
            type: 'pong',
            timestamp: Date.now()
          }));
          break;

        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
    }
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // Find and remove connection
    const connection = Array.from(this.connections.values()).find(
      c => c.socket === ws
    );

    if (connection) {
      console.log(`WebSocket closed: ${connection.id} (code: ${code}, reason: ${reason})`);

      // Remove from all rooms
      for (const room of connection.rooms) {
        this.removeFromRoom(room, connection.id);
      }

      this.connections.delete(connection.id);
    }
  }

  /**
   * Handle WebSocket error
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('WebSocket error:', error);

    // Find and close connection
    const connection = Array.from(this.connections.values()).find(
      c => c.socket === ws
    );

    if (connection) {
      ws.close(1011, 'Internal error');
      this.connections.delete(connection.id);
    }
  }

  /**
   * Broadcast message to room
   */
  private broadcast(message: BroadcastMessage): Response {
    const room = message.room || 'global';
    const connectionIds = this.rooms.get(room);

    if (!connectionIds) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No connections in room',
          room,
          sent: 0
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let sent = 0;
    const payload = JSON.stringify(message);

    for (const connectionId of connectionIds) {
      const connection = this.connections.get(connectionId);
      if (connection) {
        try {
          connection.socket.send(payload);
          sent++;
        } catch (error) {
          console.error(`Failed to send to ${connectionId}:`, error);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        room,
        sent,
        total: connectionIds.size
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  /**
   * Get manager status
   */
  private getStatus(): Response {
    return new Response(
      JSON.stringify({
        totalConnections: this.connections.size,
        totalRooms: this.rooms.size,
        rooms: Array.from(this.rooms.entries()).map(([room, connections]) => ({
          room,
          connections: connections.size
        }))
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  /**
   * Get all connections
   */
  private getConnections(): Response {
    const connections = Array.from(this.connections.values()).map(c => ({
      id: c.id,
      userId: c.userId,
      rooms: Array.from(c.rooms),
      connectedAt: c.connectedAt,
      lastActivity: c.lastActivity,
      metadata: c.metadata
    }));

    return new Response(
      JSON.stringify({
        connections,
        total: connections.length
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  /**
   * Disconnect a client
   */
  private disconnect(connectionId: string): Response {
    const connection = this.connections.get(connectionId);

    if (!connection) {
      return new Response(
        JSON.stringify({ error: 'Connection not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    connection.socket.close(1000, 'Disconnected by server');
    this.connections.delete(connectionId);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  /**
   * Alarm handler - check connection health
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    const stale: string[] = [];

    // Find stale connections (no activity in 5 minutes)
    for (const [id, connection] of this.connections.entries()) {
      if (now - connection.lastActivity > 300000) {
        stale.push(id);
      }
    }

    // Close stale connections
    for (const id of stale) {
      const connection = this.connections.get(id);
      if (connection) {
        console.log(`Closing stale connection: ${id}`);
        connection.socket.close(1000, 'Connection timeout');
        this.connections.delete(id);
      }
    }

    // Schedule next check
    (this.state as any).setAlarm(Date.now() + 30000);
  }

  /**
   * Add connection to room
   */
  private addToRoom(room: string, connectionId: string): void {
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }
    this.rooms.get(room)!.add(connectionId);
  }

  /**
   * Remove connection from room
   */
  private removeFromRoom(room: string, connectionId: string): void {
    const connections = this.rooms.get(room);
    if (connections) {
      connections.delete(connectionId);
      if (connections.size === 0) {
        this.rooms.delete(room);
      }
    }
  }

  /**
   * Generate unique connection ID
   */
  private generateId(): string {
    return `ws-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }
}
