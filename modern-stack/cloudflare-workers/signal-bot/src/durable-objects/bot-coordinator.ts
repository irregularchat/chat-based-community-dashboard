/**
 * Bot Coordinator Durable Object
 *
 * Manages bot lifecycle and coordination across multiple container instances.
 * Ensures only one bot instance is active at a time for a given phone number.
 *
 * Features:
 * - Bot instance registration and health tracking
 * - Leader election (which container is the primary bot)
 * - Failover and restart coordination
 * - Configuration management
 * - State persistence
 */

export interface BotInstance {
  containerId: string;
  phoneNumber: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  startedAt: number;
  lastHeartbeat: number;
  metadata?: Record<string, any>;
}

export interface Env {
  DB: D1Database;
}

export class BotCoordinator {
  private state: DurableObjectState;
  private env: Env;
  private instances: Map<string, BotInstance>;
  private primaryInstanceId: string | null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.instances = new Map();
    this.primaryInstanceId = null;

    // Load state from storage
    this.state.blockConcurrencyWhile(async () => {
      const storedInstances = await this.state.storage.get<BotInstance[]>('instances');
      const storedPrimary = await this.state.storage.get<string>('primaryInstanceId');

      if (storedInstances) {
        for (const instance of storedInstances) {
          this.instances.set(instance.containerId, instance);
        }
      }

      if (storedPrimary) {
        this.primaryInstanceId = storedPrimary;
      }
    });

    // Start heartbeat checker (check every 30 seconds)
    this.state.setAlarm(Date.now() + 30000);
  }

  /**
   * Handle HTTP requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      // Register bot instance
      if (pathname === '/register' && request.method === 'POST') {
        const instance: BotInstance = await request.json();
        return this.registerInstance(instance);
      }

      // Heartbeat from bot instance
      if (pathname === '/heartbeat' && request.method === 'POST') {
        const { containerId } = await request.json();
        return this.heartbeat(containerId);
      }

      // Unregister bot instance
      if (pathname === '/unregister' && request.method === 'POST') {
        const { containerId } = await request.json();
        return this.unregisterInstance(containerId);
      }

      // Get primary instance
      if (pathname === '/primary' && request.method === 'GET') {
        return this.getPrimaryInstance();
      }

      // Get all instances
      if (pathname === '/instances' && request.method === 'GET') {
        return this.getAllInstances();
      }

      // Get coordinator status
      if (pathname === '/status' && request.method === 'GET') {
        return this.getStatus();
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('BotCoordinator error:', error);
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error'
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  /**
   * Register a bot instance
   */
  private async registerInstance(instance: BotInstance): Promise<Response> {
    instance.lastHeartbeat = Date.now();

    this.instances.set(instance.containerId, instance);

    // If no primary, make this the primary
    if (!this.primaryInstanceId) {
      this.primaryInstanceId = instance.containerId;
    }

    await this.persist();

    return new Response(
      JSON.stringify({
        success: true,
        instance,
        isPrimary: this.primaryInstanceId === instance.containerId
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  /**
   * Heartbeat from instance
   */
  private async heartbeat(containerId: string): Promise<Response> {
    const instance = this.instances.get(containerId);

    if (!instance) {
      return new Response(
        JSON.stringify({ error: 'Instance not registered' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    instance.lastHeartbeat = Date.now();
    await this.persist();

    return new Response(
      JSON.stringify({
        success: true,
        isPrimary: this.primaryInstanceId === containerId
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  /**
   * Unregister instance
   */
  private async unregisterInstance(containerId: string): Promise<Response> {
    this.instances.delete(containerId);

    // If this was the primary, elect a new one
    if (this.primaryInstanceId === containerId) {
      this.electNewPrimary();
    }

    await this.persist();

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  /**
   * Get primary instance
   */
  private getPrimaryInstance(): Response {
    const primary = this.primaryInstanceId
      ? this.instances.get(this.primaryInstanceId)
      : null;

    return new Response(
      JSON.stringify({
        primary,
        primaryId: this.primaryInstanceId
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  /**
   * Get all instances
   */
  private getAllInstances(): Response {
    const instances = Array.from(this.instances.values());

    return new Response(
      JSON.stringify({
        instances,
        total: instances.length,
        primaryId: this.primaryInstanceId
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  /**
   * Get coordinator status
   */
  private getStatus(): Response {
    const now = Date.now();
    const instances = Array.from(this.instances.values());

    return new Response(
      JSON.stringify({
        totalInstances: instances.length,
        primaryInstanceId: this.primaryInstanceId,
        healthyInstances: instances.filter(
          i => now - i.lastHeartbeat < 60000 // 1 minute
        ).length,
        unhealthyInstances: instances.filter(
          i => now - i.lastHeartbeat >= 60000
        ).length
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  /**
   * Alarm handler - check instance health
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    const unhealthy: string[] = [];

    // Check for unhealthy instances (no heartbeat in 2 minutes)
    for (const [id, instance] of this.instances.entries()) {
      if (now - instance.lastHeartbeat > 120000) {
        unhealthy.push(id);
      }
    }

    // Remove unhealthy instances
    for (const id of unhealthy) {
      console.log(`Removing unhealthy instance: ${id}`);
      this.instances.delete(id);

      // If this was the primary, elect a new one
      if (this.primaryInstanceId === id) {
        this.electNewPrimary();
      }
    }

    if (unhealthy.length > 0) {
      await this.persist();
    }

    // Schedule next check
    this.state.setAlarm(Date.now() + 30000);
  }

  /**
   * Elect new primary instance
   */
  private electNewPrimary(): void {
    // Find oldest healthy instance
    const now = Date.now();
    let oldest: BotInstance | null = null;

    for (const instance of this.instances.values()) {
      if (now - instance.lastHeartbeat < 60000) {
        if (!oldest || instance.startedAt < oldest.startedAt) {
          oldest = instance;
        }
      }
    }

    this.primaryInstanceId = oldest ? oldest.containerId : null;
    console.log(`New primary instance elected: ${this.primaryInstanceId}`);
  }

  /**
   * Persist state to storage
   */
  private async persist(): Promise<void> {
    await this.state.storage.put('instances', Array.from(this.instances.values()));
    await this.state.storage.put('primaryInstanceId', this.primaryInstanceId);
  }
}
