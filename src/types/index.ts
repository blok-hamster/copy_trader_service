import { PredictionResult } from "@inscribable/xg_boost_decision_tree_model";

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
  name?: string;
  symbol?: string;
  image?: string;
  metadataUri?: string;
  dexProgram?: string;
  slotNumber?: number;
  blockTime?: number;
  fee?: number;
  prediction?: PredictionResult;
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
  tokenBuyCount?: number; // Number of times to buy a token
  privateKey: string; // Encrypted
  walletAddress: string;
  createdAt: Date;
  updatedAt: Date;
  settings?: SubscriptionSettings;
  type: "trade" | "watch",
  watchConfig?: {
    takeProfitPercentage?: number;
    stopLossPercentage?: number;
    enableTrailingStop?: boolean;
    trailingPercentage?: number;
    maxHoldTimeMinutes?: number;
  }
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
    tokenPurchases: string;
  };
  ttl: {
    subscriptions: number;
    kolWallets: number;
    tradeHistory: number;
    serviceMetrics: number;
    tokenPurchases: number;
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

export interface KOLAddress {
  address: string;
  name: string;
  category: string;
  verified: boolean;
  followers: number;
  description: string;
}

export interface TokenInfo {
  mintAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  firstTradeTime: string;
  totalTrades: number;
}

export interface Currency {
  mintAddress: string;
  symbol: string;
  name: string;
  decimals: number;
}

export interface TradeAccount {
  account: string;
  amount: string;
  price: string;
  priceInUSD?: string;
  currency: Currency;
}

export interface Market {
  marketAddress: string;
  baseCurrency: {
    mintAddress: string;
    symbol: string;
  };
  quoteCurrency: {
    mintAddress: string;
    symbol: string;
  };
}

export interface DEXInfo {
  protocolName: string;
  protocolFamily: string;
  smartContract: string;
}

export interface DEXTrade {
  block: {
    time: string;
    height: number;
    hash: string;
  };
  transaction: {
    signature: string;
    fee: string;
    feePayer: string;
  };
  trade: {
    buy: TradeAccount;
    sell: TradeAccount;
    market: Market;
    dex: DEXInfo;
  };
}

// New types for Solana Tracker API

export interface SolanaTrackerToken {
  name: string;
  symbol: string;
  image: string;
  decimals: number;
}

export interface SolanaTrackerTradeToken {
  address: string;
  amount: number;
  token: SolanaTrackerToken;
}

export interface SolanaTrackerTrade {
  tx: string;
  from: SolanaTrackerTradeToken;
  to: SolanaTrackerTradeToken;
  price: {
    usd: number;
    sol: string;
  };
  volume: {
    usd: number;
    sol: number;
  };
  wallet: string;
  program: string;
  time: number;
}

export interface SolanaTrackerTradesResponse {
  trades: SolanaTrackerTrade[];
  nextCursor?: number;
  hasNextPage?: boolean;
}

// Updated DEXTrade interface to accommodate both old and new API formats
export interface UnifiedDEXTrade {
  transactionSignature: string;
  blockTime: number;
  wallet: string;
  tokenFrom: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    amount: number;
  };
  tokenTo: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    amount: number;
  };
  priceUsd: number;
  volumeUsd: number;
  program: string;
}

export interface PriceMomentumData {
  current: {
    price: string;
    priceInUSD: string;
    time: string;
  };
  price1h: {
    price: string;
    priceInUSD: string;
    time: string;
  };
  price4h: {
    price: string;
    priceInUSD: string;
    time: string;
  };
  price24h: {
    price: string;
    priceInUSD: string;
    time: string;
  };
  momentum: {
    change1h: number;
    change4h: number;
    change24h: number;
    changePercent1h: number;
    changePercent4h: number;
    changePercent24h: number;
  };
}

export interface VolumeData {
  volume1h: {
    totalVolumeUSD: string;
    tradeCount: number;
    avgTradeSize: string;
  };
  volume24h: {
    totalVolumeUSD: string;
    tradeCount: number;
    avgTradeSize: string;
  };
  buyVolume: {
    totalVolumeUSD: string;
    tradeCount: number;
  };
  sellVolume: {
    totalVolumeUSD: string;
    tradeCount: number;
  };
  volumeRatio: {
    buyToSellRatio: number;
    volume1hTo24hRatio: number;
  };
}

export interface LiquidityData {
  pools: Array<{
    marketAddress: string;
    baseAmount: string;
    quoteAmount: string;
    baseAmountUSD: string;
    quoteAmountUSD: string;
    totalLiquidityUSD: string;
    dexProtocol: string;
  }>;
  summary: {
    totalLiquidityUSD: string;
    poolCount: number;
    averagePoolSize: string;
    largestPoolSize: string;
  };
}

export interface VolatilityData {
  high: string;
  low: string;
  open: string;
  close: string;
  volatility: {
    priceRange: number;
    priceRangePercent: number;
    atr: number; // Average True Range
    standardDeviation: number;
  };
}

export interface ActivityData {
  transfers: {
    count: number;
    uniqueAddresses: number;
  };
  trades: {
    count: number;
    uniqueTraders: number;
  };
  activityScore: number;
}

export interface WhaleTrades {
  trades: Array<{
    time: string;
    amount: string;
    amountUSD: string;
    buyer: string;
    txSignature: string;
  }>;
  summary: {
    totalWhaleVolume: string;
    whaleTradeCount: number;
    averageWhaleSize: string;
  };
}

export interface TokenSupplyData {
  totalSupply: string;
  circulatingSupply: string;
  maxSupply?: string;
  lastUpdated: string;
}

export interface TokenFeatures {
  token: TokenInfo;
  buyEvent: {
    kolAddress: string;
    buyTime: string;
    buyAmount: string;
    buyAmountUSD: string;
    buyPrice: string;
  };
  priceMomentum: PriceMomentumData;
  volume: VolumeData;
  liquidity: LiquidityData;
  volatility: VolatilityData;
  activity: ActivityData;
  whaleTrades: WhaleTrades;
  supply: TokenSupplyData;
  tokenAge: {
    ageInDays: number;
    creationTime: string;
    timeToKOLBuy: number; // minutes from creation to KOL buy
  };
  solPrice: {
    currentPrice: string;
    price24hAgo: string;
    change24h: number;
    changePercent24h: number;
  };
}

export interface ExtractionResult {
  metadata: {
    extractionTime: string;
    kolAddresses: string[];
    timeRange: {
      start: string;
      end: string;
    };
    totalTrades: number;
    uniqueTokens: number;
    checkpointData?: any; // NEW: Optional checkpoint data for resumable processing
  };
  trades: UnifiedDEXTrade[];
  tokens: TokenInfo[];
  features: TokenFeatures[];
  tradingPerformance?: any[]; // P&L analysis results
}

export interface CSVRow {
  kol_address: string;
  kol_name: string;
  token_mint: string;
  token_symbol: string;
  token_name: string;
  buy_time: string;
  buy_amount: string;
  buy_amount_usd: string;
  buy_price: string;
  
  // Price momentum features
  price_current: string;
  price_1h_ago: string;
  price_4h_ago: string;
  price_24h_ago: string;
  price_change_1h_percent: number;
  price_change_4h_percent: number;
  price_change_24h_percent: number;
  
  // Volume features
  volume_1h_usd: string;
  volume_24h_usd: string;
  volume_ratio_1h_to_24h: number;
  buy_volume_24h_usd: string;
  sell_volume_24h_usd: string;
  buy_sell_ratio: number;
  
  // Liquidity features
  total_liquidity_usd: string;
  pool_count: number;
  largest_pool_size_usd: string;
  
  // Volatility features
  price_volatility_24h: number;
  price_range_24h_percent: number;
  
  // Activity features
  transfers_24h: number;
  trades_24h: number;
  unique_traders_24h: number;
  
  // Whale activity
  whale_volume_24h_usd: string;
  whale_trade_count_24h: number;
  
  // Token fundamentals
  token_age_days: number;
  total_supply: string;
  
  // SOL price context
  sol_price_usd: string;
  sol_24h_change_percent: number;
  
  // Market context
  dex_protocol: string;
  market_address: string;
  
  // Timing
  time_from_creation_to_buy_minutes: number;
}

// OHLCV Chart Data Types
export interface OHLCVCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time: number; // Unix timestamp
}

export interface OHLCVResponse {
  oclhv: OHLCVCandle[];
}

export interface ChartDataOptions {
  type?: string; // Time interval (e.g., "1s", "1m", "1h", "1d")
  time_from?: number; // Start time (Unix timestamp in seconds)
  time_to?: number; // End time (Unix timestamp in seconds)
  marketCap?: boolean; // Return chart for market cap instead of pricing
  removeOutliers?: boolean; // Set to false to disable outlier removal, true by default
}

export type ChartInterval = 
  | '1s' | '5s' | '15s' 
  | '1m' | '3m' | '5m' | '15m' | '30m' 
  | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' 
  | '1d' | '3d' | '1w' | '1mn';

export interface HoldersChartData {
  holders: number;
  time: number;
}

export interface HoldersChartResponse {
  holders: HoldersChartData[];
}

export interface HoldersChartOptions {
  type?: ChartInterval;
  time_from?: number;
  time_to?: number;
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