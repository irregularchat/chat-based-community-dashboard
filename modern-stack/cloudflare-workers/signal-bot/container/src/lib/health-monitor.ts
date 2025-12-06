/**
 * Health Monitor
 *
 * Monitors container health and provides health check data
 */

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  timestamp: number;
  checks: {
    signalCli: boolean;
    workerApi: boolean;
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
  };
}

export class HealthMonitor {
  private startTime: number;
  private lastChecks: Map<string, boolean>;

  constructor() {
    this.startTime = Date.now();
    this.lastChecks = new Map();
  }

  /**
   * Get current health status
   */
  getHealth(): HealthStatus {
    const memUsage = process.memoryUsage();
    const memTotal = memUsage.heapTotal;
    const memUsed = memUsage.heapUsed;
    const memPercentage = (memUsed / memTotal) * 100;

    const signalCliHealthy = this.lastChecks.get('signalCli') ?? true;
    const workerApiHealthy = this.lastChecks.get('workerApi') ?? true;

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (!signalCliHealthy || !workerApiHealthy) {
      status = 'degraded';
    }

    if (!signalCliHealthy && !workerApiHealthy) {
      status = 'unhealthy';
    }

    // Note: heapUsed/heapTotal can normally be >90% right before GC runs
    // This is not a memory problem. Only flag if RSS exceeds a high threshold.
    // For now, disable heap percentage check as it causes false positives.
    // TODO: Consider using rss against a configured limit instead
    // if (memPercentage > 95) {
    //   status = 'degraded';
    // }

    return {
      status,
      uptime: Date.now() - this.startTime,
      timestamp: Date.now(),
      checks: {
        signalCli: signalCliHealthy,
        workerApi: workerApiHealthy,
        memory: {
          used: memUsed,
          total: memTotal,
          percentage: Math.round(memPercentage * 100) / 100,
        },
      },
    };
  }

  /**
   * Record health check result
   */
  recordCheck(name: string, healthy: boolean): void {
    this.lastChecks.set(name, healthy);
  }

  /**
   * Get uptime in seconds
   */
  getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }
}
