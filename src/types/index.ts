// Core trading types
export interface KOLTrade {
  id: string;
  kolWallet: string;
  signature: string;
  timestamp: Date;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  tradeType: 'buy' | 'sell';
  mint?: string;
  dexProgram: string;
  slotNumber?: number;
  blockTime?: number;
  fee?: number;
}

// User subscription management
export interface UserSubscription {
  id: string;
  userId: string;
  kolWallet: string;
  isActive: boolean;
  copyPercentage: number; // 0-100%
  maxAmount?: number;
  minAmount?: number;
  privateKey: string; // Encrypted
  walletAddress: string;
  createdAt: Date;
  updatedAt: Date;
  settings?: SubscriptionSettings;
  type: "trade" | "watch",
}

export interface SubscriptionSettings {
  enableSlippageProtection?: boolean;
  maxSlippagePercent?: number;
  enableDexWhitelist?: boolean;
  allowedDexes?: string[];
  enableTokenBlacklist?: boolean;
  blacklistedTokens?: string[];
  enableTimeRestrictions?: boolean;
  tradingHours?: {
    start: string;
    end: string;
    timezone: string;
  };
}

// Copy trade processing
export interface CopyTradeRequest {
  id: string;
  originalTrade: KOLTrade;
  userId: string;
  subscription: UserSubscription;
  calculatedAmount: number;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  processingStartedAt?: Date;
  completedAt?: Date;
  failureReason?: string;
  retryCount?: number;
}

export interface CopyTradeResult {
  requestId: string;
  success: boolean;
  signature?: string;
  error?: string;
  executionTime: number;
  amountExecuted?: number;
  actualSlippage?: number;
  gasFees?: number;
}

// RabbitMQ Message Types
export interface RabbitMQMessage {
  id: string;
  type: string;
  payload: any;
  timestamp: Date;
  retryCount: number;
  priority: 'high' | 'medium' | 'low';
  correlationId?: string;
  replyTo?: string;
}

// Inbound messages (commands to copy trader service)
export interface SubscriptionCommand extends RabbitMQMessage {
  type: 'subscription_create' | 'subscription_update' | 'subscription_delete' | 'subscription_toggle';
  payload: {
    subscription: UserSubscription;
    action?: string;
  };
}

export interface KOLManagementCommand extends RabbitMQMessage {
  type: 'kol_add' | 'kol_remove' | 'kol_list';
  payload: {
    kolWallet?: string;
    userId?: string;
  };
}

export interface ServiceCommand extends RabbitMQMessage {
  type: 'health_check' | 'get_metrics' | 'shutdown' | 'restart_monitoring';
  payload: {
    requestId: string;
  };
}

// Outbound messages (events from copy trader service)
export interface KOLTradeDetectedEvent extends RabbitMQMessage {
  type: 'kol_trade_detected';
  payload: {
    trade: KOLTrade;
    affectedSubscriptions: UserSubscription[];
    estimatedCopyTrades: number;
  };
}

export interface CopyTradeRequestEvent extends RabbitMQMessage {
  type: 'copy_trade_requested';
  payload: {
    request: CopyTradeRequest;
    swapServiceJobId?: string;
  };
}

export interface CopyTradeCompletedEvent extends RabbitMQMessage {
  type: 'copy_trade_completed';
  payload: {
    request: CopyTradeRequest;
    result: CopyTradeResult;
  };
}

export interface NotificationEvent extends RabbitMQMessage {
  type: 'client_notification';
  payload: {
    userId: string;
    notificationType: 'trade_detected' | 'trade_executed' | 'trade_failed' | 'subscription_updated';
    data: any;
    priority?: 'high' | 'medium' | 'low';
  };
}

export interface ServiceStatusEvent extends RabbitMQMessage {
  type: 'service_status';
  payload: {
    service: string;
    status: 'online' | 'offline' | 'degraded';
    metrics: ServiceMetrics;
    healthCheck: HealthCheckResult[];
  };
}

// Blockchain integration types
export interface BlockchainConnection {
  endpoint: string;
  commitment: 'processed' | 'confirmed' | 'finalized';
  isConnected: boolean;
  subscriptions: Map<string, number>;
}

export interface HeliusConfig {
  apiKey: string;
  environment: 'devnet' | 'mainnet';
  commitment?: 'processed' | 'confirmed' | 'finalized';
}

// Message queue configuration
export interface MessageQueueConfig {
  rabbitmqUrl: string;
  exchanges: {
    copyTradeEvents: string;
    notifications: string;
    commands: string;
    deadLetter: string;
  };
  queues: {
    // Inbound queues (commands to this service)
    subscriptionCommands: string;
    kolManagement: string;
    serviceCommands: string;
    
    // Outbound queues (events from this service)
    kolTradeDetected: string;
    copyTradeRequests: string;
    copyTradeCompleted: string;
    clientNotifications: string;
    serviceStatus: string;
    
    // Integration queues
    swapServiceQueue: string;
    deadLetter: string;
  };
  routingKeys: {
    kolTradeDetected: string;
    copyTradeRequest: string;
    copyTradeCompleted: string;
    notification: string;
    serviceStatus: string;
  };
}

// Cache management
export interface CacheConfig {
  redisUrl: string;
  keyPrefixes: {
    subscriptions: string;
    kolWallets: string;
    tradeHistory: string;
    serviceMetrics: string;
  };
  ttl: {
    subscriptions: number;
    kolWallets: number;
    tradeHistory: number;
    serviceMetrics: number;
  };
}

// Service health and monitoring
export interface HealthCheckResult {
  service: string;
  healthy: boolean;
  message: string;
  timestamp: Date;
  details?: any;
}

export interface ServiceMetrics {
  connectionsActive: number;
  subscriptionsActive: number;
  tradesDetected: number;
  tradesExecuted: number;
  errorCount: number;
  avgProcessingTime: number;
  uptime: number;
  lastKOLTradeDetected?: Date;
  queueDepths: {
    [queueName: string]: number;
  };
}

// Configuration types
export interface AppConfig {
  environment: 'development' | 'staging' | 'production';
  serviceName: string;
  
  helius: HeliusConfig;
  messaging: MessageQueueConfig;
  cache: CacheConfig;
  
  swapService: {
    queuePrefix: string;
    rabbitmqUrl: string;
    timeout: number;
  };
  
  monitoring: {
    enableMetrics: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    metricsPublishInterval: number; // milliseconds
  };
  
  security: {
    encryptionKey: string;
  };
  
  processing: {
    maxConcurrentTrades: number;
    retryAttempts: number;
    retryDelayMs: number;
    processingTimeout: number;
  };
}

// Error types
export interface CopyTradingError extends Error {
  code: string;
  context?: any;
  timestamp: Date;
  recoverable: boolean;
}

export interface ValidationError extends CopyTradingError {
  field: string;
  value: any;
}

// Message processing types
export interface MessageHandler<T extends RabbitMQMessage> {
  canHandle(message: RabbitMQMessage): boolean;
  handle(message: T): Promise<void>;
}

export interface MessageProcessor {
  start(): Promise<void>;
  stop(): Promise<void>;
  registerHandler<T extends RabbitMQMessage>(handler: MessageHandler<T>): void;
  publishMessage(exchange: string, routingKey: string, message: RabbitMQMessage): Promise<void>;
}

// Export utility types
export type Priority = 'high' | 'medium' | 'low';
export type TradeStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type NotificationType = 'trade_detected' | 'trade_executed' | 'trade_failed' | 'subscription_updated';
export type Environment = 'development' | 'staging' | 'production';
export type Commitment = 'processed' | 'confirmed' | 'finalized';
export type ServiceStatus = 'online' | 'offline' | 'degraded';

// Message type union for type safety
export type InboundMessage = SubscriptionCommand | KOLManagementCommand | ServiceCommand;
export type OutboundMessage = KOLTradeDetectedEvent | CopyTradeRequestEvent | CopyTradeCompletedEvent | NotificationEvent | ServiceStatusEvent; 