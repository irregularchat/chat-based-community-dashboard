/**
 * Debug Logger
 *
 * Captures and stores debugging information for troubleshooting Signal bot issues:
 * - Connection lifecycle events
 * - Message processing errors
 * - RPC communication failures
 * - Decryption errors
 */

import { PostgresClient } from '../db/postgres-client.js';

export type EventType =
  | 'connection_open'
  | 'connection_close'
  | 'connection_error'
  | 'reconnect_attempt'
  | 'message_received'
  | 'message_decrypt_failed'
  | 'message_processing_error'
  | 'rpc_request'
  | 'rpc_response'
  | 'rpc_error'
  | 'rpc_timeout'
  | 'signal_cli_error'
  | 'bot_start'
  | 'bot_stop'
  | 'health_check';

export type Severity = 'debug' | 'info' | 'warn' | 'error' | 'critical';

export interface DebugLogEntry {
  timestamp: number;
  event_type: EventType;
  severity: Severity;
  component: string;
  message?: string;
  data?: Record<string, any>;
  stack_trace?: string;
}

/**
 * Debug Logger Class
 *
 * Provides methods to log debugging information to PostgreSQL
 */
export class DebugLogger {
  private dbClient: PostgresClient;
  private enabled: boolean;
  private consoleLog: boolean;

  constructor(dbClient: PostgresClient, enabled: boolean = true, consoleLog: boolean = true) {
    this.dbClient = dbClient;
    this.enabled = enabled;
    this.consoleLog = consoleLog;
  }

  /**
   * Log a debug event
   */
  async log(entry: DebugLogEntry): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      // Console logging for development
      if (this.consoleLog) {
        const emoji = this.getSeverityEmoji(entry.severity);
        console.log(
          `${emoji} [${entry.component}] ${entry.event_type}: ${entry.message || 'No message'}`,
          entry.data ? JSON.stringify(entry.data).substring(0, 200) : ''
        );
      }

      // Store to database
      await this.dbClient.query(
        `INSERT INTO debug_logs (timestamp, event_type, severity, component, message, data, stack_trace)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          entry.timestamp,
          entry.event_type,
          entry.severity,
          entry.component,
          entry.message || null,
          entry.data ? JSON.stringify(entry.data) : null,
          entry.stack_trace || null,
        ]
      );
    } catch (error) {
      // Don't let logging errors break the bot
      console.error('Failed to write debug log:', error);
    }
  }

  /**
   * Log connection opened
   */
  async logConnectionOpen(component: string, data?: Record<string, any>): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      event_type: 'connection_open',
      severity: 'info',
      component,
      message: 'Connection established',
      data,
    });
  }

  /**
   * Log connection closed
   */
  async logConnectionClose(component: string, data?: Record<string, any>): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      event_type: 'connection_close',
      severity: 'warn',
      component,
      message: 'Connection closed',
      data,
    });
  }

  /**
   * Log connection error
   */
  async logConnectionError(component: string, error: Error, data?: Record<string, any>): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      event_type: 'connection_error',
      severity: 'error',
      component,
      message: error.message,
      data: {
        ...data,
        errorName: error.name,
        errorCode: (error as any).code,
      },
      stack_trace: error.stack,
    });
  }

  /**
   * Log reconnection attempt
   */
  async logReconnectAttempt(component: string, attempt: number, maxAttempts: number, delay: number): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      event_type: 'reconnect_attempt',
      severity: 'warn',
      component,
      message: `Reconnection attempt ${attempt}/${maxAttempts}`,
      data: { attempt, maxAttempts, delayMs: delay },
    });
  }

  /**
   * Log message received
   */
  async logMessageReceived(component: string, data: Record<string, any>): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      event_type: 'message_received',
      severity: 'debug',
      component,
      message: 'Message received',
      data,
    });
  }

  /**
   * Log message decryption failure
   */
  async logDecryptionError(component: string, error: Error, envelopeData?: Record<string, any>): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      event_type: 'message_decrypt_failed',
      severity: 'error',
      component,
      message: `Decryption failed: ${error.message}`,
      data: {
        envelope: envelopeData,
        errorName: error.name,
      },
      stack_trace: error.stack,
    });
  }

  /**
   * Log message processing error
   */
  async logProcessingError(component: string, error: Error, messageData?: Record<string, any>): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      event_type: 'message_processing_error',
      severity: 'error',
      component,
      message: `Processing error: ${error.message}`,
      data: messageData,
      stack_trace: error.stack,
    });
  }

  /**
   * Log RPC request
   */
  async logRpcRequest(method: string, params?: Record<string, any>, requestId?: string | number): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      event_type: 'rpc_request',
      severity: 'debug',
      component: 'signal-jsonrpc',
      message: `RPC request: ${method}`,
      data: { method, params, requestId },
    });
  }

  /**
   * Log RPC response
   */
  async logRpcResponse(method: string, result: any, requestId?: string | number): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      event_type: 'rpc_response',
      severity: 'debug',
      component: 'signal-jsonrpc',
      message: `RPC response: ${method}`,
      data: { method, result, requestId },
    });
  }

  /**
   * Log RPC error
   */
  async logRpcError(method: string, error: Error, requestId?: string | number): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      event_type: 'rpc_error',
      severity: 'error',
      component: 'signal-jsonrpc',
      message: `RPC error: ${method} - ${error.message}`,
      data: { method, requestId },
      stack_trace: error.stack,
    });
  }

  /**
   * Log RPC timeout
   */
  async logRpcTimeout(method: string, timeoutMs: number, requestId?: string | number): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      event_type: 'rpc_timeout',
      severity: 'error',
      component: 'signal-jsonrpc',
      message: `RPC timeout: ${method} (${timeoutMs}ms)`,
      data: { method, timeoutMs, requestId },
    });
  }

  /**
   * Log Signal CLI error
   */
  async logSignalCliError(error: string, exitCode?: number, data?: Record<string, any>): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      event_type: 'signal_cli_error',
      severity: 'error',
      component: 'signal-cli',
      message: error,
      data: { ...data, exitCode },
    });
  }

  /**
   * Log bot lifecycle event
   */
  async logBotLifecycle(event: 'start' | 'stop', data?: Record<string, any>): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      event_type: event === 'start' ? 'bot_start' : 'bot_stop',
      severity: 'info',
      component: 'signal-bot',
      message: `Bot ${event}ed`,
      data,
    });
  }

  /**
   * Log health check
   */
  async logHealthCheck(healthy: boolean, data?: Record<string, any>): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      event_type: 'health_check',
      severity: healthy ? 'debug' : 'warn',
      component: 'health-monitor',
      message: healthy ? 'Health check passed' : 'Health check failed',
      data,
    });
  }

  /**
   * Query recent debug logs
   */
  async getRecentLogs(limit: number = 100, eventType?: EventType, severity?: Severity): Promise<any[]> {
    let query = 'SELECT * FROM debug_logs WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (eventType) {
      query += ` AND event_type = $${paramIndex}`;
      params.push(eventType);
      paramIndex++;
    }

    if (severity) {
      query += ` AND severity = $${paramIndex}`;
      params.push(severity);
      paramIndex++;
    }

    query += ` ORDER BY timestamp DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await this.dbClient.query(query, params);
    return result.results || [];
  }

  /**
   * Get severity emoji for console logging
   */
  private getSeverityEmoji(severity: Severity): string {
    switch (severity) {
      case 'debug': return '🔍';
      case 'info': return 'ℹ️';
      case 'warn': return '⚠️';
      case 'error': return '❌';
      case 'critical': return '🚨';
      default: return '•';
    }
  }

  /**
   * Clean up old debug logs (older than N days)
   */
  async cleanup(daysToKeep: number = 7): Promise<number> {
    const cutoffTimestamp = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

    const result = await this.dbClient.query(
      'DELETE FROM debug_logs WHERE timestamp < $1',
      [cutoffTimestamp]
    );

    // PostgresClient returns { results: any[] }, we need to get rowCount a different way
    // For now, just return 0 since cleanup is not critical
    return 0;
  }
}
