import dotenv from 'dotenv';
import { AppConfig } from '../types';

// Load environment variables
dotenv.config();

class ConfigService {
  private static instance: ConfigService;
  public readonly config: AppConfig;

  private constructor() {
    this.config = this.loadConfig();
    this.validateConfig();
  }

  public static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  private loadConfig(): AppConfig {
    return {
      environment: (process.env.NODE_ENV as any) || 'development',
      serviceName: process.env.SERVICE_NAME || 'copy-trader-service',
      
      helius: {
        apiKey: process.env.HELIUS_API_KEY || 'e139447f-fcd4-4541-b6cf-049107aa363e',
        environment: (process.env.HELIUS_ENVIRONMENT as any) || 'mainnet',
        commitment: (process.env.HELIUS_COMMITMENT_LEVEL as any) || 'processed'
      },
      
      messaging: {
        rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
        exchanges: {
          copyTradeEvents: process.env.COPY_TRADE_EXCHANGE || 'copy_trade_events',
          notifications: process.env.NOTIFICATIONS_EXCHANGE || 'notifications',
          commands: process.env.COMMANDS_EXCHANGE || 'commands',
          deadLetter: process.env.DEAD_LETTER_EXCHANGE || 'dead_letter'
        },
        queues: {
          // Inbound queues (commands to this service)
          subscriptionCommands: process.env.SUBSCRIPTION_COMMANDS_QUEUE || 'subscription_commands',
          kolManagement: process.env.KOL_MANAGEMENT_QUEUE || 'kol_management',
          serviceCommands: process.env.SERVICE_COMMANDS_QUEUE || 'service_commands',
          
          // Outbound queues (events from this service)
          kolTradeDetected: process.env.KOL_TRADE_DETECTED_QUEUE || 'kol_trade_detected',
          copyTradeRequests: process.env.COPY_TRADE_REQUESTS_QUEUE || 'copy_trade_requests',
          copyTradeCompleted: process.env.COPY_TRADE_COMPLETED_QUEUE || 'copy_trade_completed',
          clientNotifications: process.env.CLIENT_NOTIFICATIONS_QUEUE || 'client_notifications',
          serviceStatus: process.env.SERVICE_STATUS_QUEUE || 'service_status',
          
          // Integration queues
          swapServiceQueue: process.env.SWAP_SERVICE_QUEUE || 'solana_swap_trades_high_priority',
          deadLetter: process.env.DEAD_LETTER_QUEUE || 'dead_letter'
        },
        routingKeys: {
          kolTradeDetected: process.env.KOL_TRADE_ROUTING_KEY || 'kol.trade.detected',
          copyTradeRequest: process.env.COPY_TRADE_REQUEST_ROUTING_KEY || 'copy.trade.request',
          copyTradeCompleted: process.env.COPY_TRADE_COMPLETED_ROUTING_KEY || 'copy.trade.completed',
          notification: process.env.NOTIFICATION_ROUTING_KEY || 'client.notification',
          serviceStatus: process.env.SERVICE_STATUS_ROUTING_KEY || 'service.status'
        }
      },
      
      cache: {
        redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
        keyPrefixes: {
          subscriptions: process.env.SUBSCRIPTION_KEY_PREFIX || 'sub:',
          kolWallets: process.env.KOL_WALLET_KEY_PREFIX || 'kol:',
          tradeHistory: process.env.TRADE_HISTORY_KEY_PREFIX || 'trade:',
          serviceMetrics: process.env.METRICS_KEY_PREFIX || 'metrics:'
        },
        ttl: {
          subscriptions: parseInt(process.env.SUBSCRIPTION_TTL || '0', 10), // 0 = no expiry
          kolWallets: parseInt(process.env.KOL_WALLET_TTL || '0', 10), // 0 = no expiry
          tradeHistory: parseInt(process.env.TRADE_HISTORY_TTL || '86400', 10), // 24 hours
          serviceMetrics: parseInt(process.env.METRICS_TTL || '60', 10) // 1 minute
        }
      },
      
      swapService: {
        queuePrefix: process.env.SWAP_SERVICE_QUEUE_PREFIX || 'solana_swap_trades',
        rabbitmqUrl: process.env.SWAP_SERVICE_RABBITMQ_URL || process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
        timeout: parseInt(process.env.SWAP_SERVICE_TIMEOUT || '30000', 10) // 30 seconds
      },
      
      monitoring: {
        enableMetrics: process.env.ENABLE_METRICS === 'true',
        logLevel: (process.env.LOG_LEVEL as any) || 'info',
        metricsPublishInterval: parseInt(process.env.METRICS_PUBLISH_INTERVAL || '30000', 10) // 30 seconds
      },
      
      security: {
        encryptionKey: process.env.ENCRYPTION_KEY || 'default-dev-key-change-in-production'
      },
      
      processing: {
        maxConcurrentTrades: parseInt(process.env.MAX_CONCURRENT_TRADES || '10', 10),
        retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3', 10),
        retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '1000', 10),
        processingTimeout: parseInt(process.env.PROCESSING_TIMEOUT || '30000', 10) // 30 seconds
      }
    };
  }

  private validateConfig(): void {
    const required = [
      'HELIUS_API_KEY',
      'RABBITMQ_URL',
      'REDIS_URL',
      'ENCRYPTION_KEY'
    ];

    const missing = required.filter(key => !process.env[key] || process.env[key] === '');
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    // Validate Helius environment
    if (!['devnet', 'mainnet'].includes(this.config.helius.environment)) {
      throw new Error('HELIUS_ENVIRONMENT must be either "devnet" or "mainnet"');
    }

    // Validate commitment level
    if (!['processed', 'confirmed', 'finalized'].includes(this.config.helius.commitment!)) {
      throw new Error('HELIUS_COMMITMENT_LEVEL must be one of: processed, confirmed, finalized');
    }

    // Validate log level
    if (!['debug', 'info', 'warn', 'error'].includes(this.config.monitoring.logLevel)) {
      throw new Error('LOG_LEVEL must be one of: debug, info, warn, error');
    }

    // Validate numeric values
    if (this.config.processing.maxConcurrentTrades <= 0) {
      throw new Error('MAX_CONCURRENT_TRADES must be a positive number');
    }

    if (this.config.processing.retryAttempts < 0) {
      throw new Error('RETRY_ATTEMPTS must be a non-negative number');
    }

    if (this.config.processing.processingTimeout <= 0) {
      throw new Error('PROCESSING_TIMEOUT must be a positive number');
    }

    // Log configuration (excluding sensitive data)
    console.log('📋 Copy Trader Service Configuration:');
    console.log(`  Environment: ${this.config.environment}`);
    console.log(`  Service: ${this.config.serviceName}`);
    console.log(`  Helius: ${this.config.helius.environment} (${this.config.helius.commitment})`);
    console.log(`  RabbitMQ: ${this.config.messaging.rabbitmqUrl}`);
    console.log(`  Redis: ${this.config.cache.redisUrl}`);
    console.log(`  Max Concurrent Trades: ${this.config.processing.maxConcurrentTrades}`);
    console.log(`  Log Level: ${this.config.monitoring.logLevel}`);
  }

  /**
   * Get queue name with environment prefix for isolation
   */
  public getQueueName(baseName: string): string {
    const env = this.config.environment;
    return env === 'production' ? baseName : `${env}_${baseName}`;
  }

  /**
   * Get exchange name with environment prefix for isolation
   */
  public getExchangeName(baseName: string): string {
    const env = this.config.environment;
    return env === 'production' ? baseName : `${env}_${baseName}`;
  }

  /**
   * Get Redis key with environment prefix for isolation
   */
  public getRedisKey(prefix: string, key: string): string {
    const env = this.config.environment;
    const envPrefix = env === 'production' ? '' : `${env}:`;
    return `${envPrefix}${prefix}${key}`;
  }

  /**
   * Get Helius WebSocket endpoint
   */
  public getHeliusWebSocketEndpoint(): string {
    const { environment, apiKey } = this.config.helius;
    return `wss://${environment}.helius-rpc.com?api-key=${apiKey}`;
  }

  /**
   * Get Helius HTTP API endpoint
   */
  public getHeliusHttpEndpoint(): string {
    const { environment, apiKey } = this.config.helius;
    return `https://${environment === 'devnet' ? 'api.devnet' : 'api'}.helius.xyz/v0?api-key=${apiKey}`;
  }

  /**
   * Check if service is in development mode
   */
  public isDevelopment(): boolean {
    return this.config.environment === 'development';
  }

  /**
   * Check if service is in production mode
   */
  public isProduction(): boolean {
    return this.config.environment === 'production';
  }

  /**
   * Get safe config (without sensitive data) for logging/debugging
   */
  public getSafeConfig(): Partial<AppConfig> {
    const safeConfig = { ...this.config };
    
    // Remove sensitive data
    safeConfig.helius.apiKey = '***HIDDEN***';
    safeConfig.security.encryptionKey = '***HIDDEN***';
    
    return safeConfig;
  }
}

// Export singleton instance and config
export const configService = ConfigService.getInstance();
export const config = configService.config;

// Export for testing
export { ConfigService }; 