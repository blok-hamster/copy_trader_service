import { Redis } from 'ioredis';
import { config, configService } from '../../config';
import { UserSubscription, ServiceMetrics, KOLTrade } from '../../types';
//import { HeliusWebhookService } from '../blockchain/HeliusWebhookService';
import { v4 as uuidv4 } from 'uuid';

export class CacheService {
  private redis: Redis;
  private isConnected = false;
  //private webhookService: HeliusWebhookService;

  isInitialized = false;
  static instance: CacheService;

  constructor() {
    this.redis = new Redis(config.cache.redisUrl, {
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      reconnectOnError: (error) => {
        console.error('Redis connection error:', error);
        return true; // Attempt reconnection
      }
    });

    //this.webhookService = HeliusWebhookService.getInstance();

    CacheService.instance = this;
    this.setupEventHandlers();
  }

  static getInstance(): CacheService {
    if (!CacheService.instance || !CacheService.instance.isInitialized) {
      CacheService.instance = new CacheService();
      CacheService.instance.isInitialized = true;
    }
    return CacheService.instance;
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    try {
      console.log(`🔌 Connecting to Redis: ${config.cache.redisUrl}`);
      await this.redis.connect();
      console.log('✅ Connected to Redis');
    } catch (error) {
      console.error('❌ Failed to connect to Redis:', error);
      throw error;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    try {
      console.log('🛑 Disconnecting from Redis...');
      await this.redis.disconnect();
      console.log('✅ Disconnected from Redis');
    } catch (error) {
      console.error('Error disconnecting from Redis:', error);
    }
  }

  /**
   * Setup event handlers for Redis connection
   */
  private setupEventHandlers(): void {
    this.redis.on('connect', () => {
      console.log('Redis connection established');
      this.isConnected = true;
    });

    this.redis.on('ready', () => {
      console.log('Redis connection ready');
      this.isConnected = true;
    });

    this.redis.on('error', (error) => {
      console.error('Redis error:', error);
      this.isConnected = false;
    });

    this.redis.on('close', () => {
      console.log('Redis connection closed');
      this.isConnected = false;
    });

    this.redis.on('reconnecting', () => {
      console.log('Redis reconnecting...');
    });
  }

  // ===== USER SUBSCRIPTION MANAGEMENT =====

  /**
   * Get all subscriptions for a user
   */
  async getUserSubscriptions(userId: string): Promise<{message: string, success: boolean, data: {subscriptions: UserSubscription[]}}> {
    try {
      const key = configService.getRedisKey(config.cache.keyPrefixes.subscriptions, `user:${userId}`);
      const data = await this.redis.get(key);
      
      if (!data) {
        return {
          message: "No subscriptions found for user",
          success: false,
          data: {
            subscriptions: []
          }
        }
      }

      return {
        message: "Subscriptions fetched successfully",
        success: true,
        data: {
          subscriptions: JSON.parse(data)
        }
      }
    } catch (error) {
      console.error(`Failed to get subscriptions for user ${userId}:`, error);
      return {  
        message: "Failed to get subscriptions for user",
        success: false,
        data: {
          subscriptions: []
        }
      }
    }
  }

  /**
   * Add or update a user subscription
   */
  async addSubscription(subscription: Omit<UserSubscription, 'id' | 'createdAt' | 'updatedAt'>): Promise<{message: string, success: boolean, data: {subscription: UserSubscription[]}}> {
    try {
      // Get existing subscriptions
      const id = uuidv4();
      const {data: {subscriptions: existingSubscriptions}} = await this.getUserSubscriptions(subscription.userId);
      
      // Remove existing subscription for the same KOL (if any)
      const filteredSubscriptions = existingSubscriptions.filter(
        sub => sub.kolWallet !== subscription.kolWallet
      );
      
      // Add the new subscription
      filteredSubscriptions.push({...subscription, id, createdAt: new Date(), updatedAt: new Date()});
      // Save back to Redis
      const key = configService.getRedisKey(config.cache.keyPrefixes.subscriptions, `user:${subscription.userId}`);
      await this.redis.setex(
        key,
        config.cache.ttl.subscriptions || 86400, // Default 24 hours if TTL is 0
        JSON.stringify(filteredSubscriptions)
      );

      // Update KOL wallet subscribers list
      await this.addKOLWalletSubscriber(subscription.kolWallet, subscription.userId);
      return {
        message: "Subscription added successfully",
        success: true,
        data: {
          subscription: filteredSubscriptions
        }
      }
    } catch (error) {
      console.error('Failed to add subscription:', error);
      throw error;
    }
  }

  /**
   * Remove a user subscription
   */
  async removeSubscription(userId: string, kolWallet: string): Promise<{message: string, success: boolean, data: {subscription: UserSubscription[]}}> {
    try {
      // Get existing subscriptions
      const {data: {subscriptions: existingSubscriptions}} = await this.getUserSubscriptions(userId);
      
      // Filter out the subscription to remove
      const filteredSubscriptions = existingSubscriptions.filter(
        sub => sub.kolWallet !== kolWallet
      );
      
      // Save back to Redis
      const key = configService.getRedisKey(config.cache.keyPrefixes.subscriptions, `user:${userId}`);
      if (filteredSubscriptions.length > 0) {
        await this.redis.setex(
          key,
          config.cache.ttl.subscriptions || 86400,
          JSON.stringify(filteredSubscriptions)
        );
      } else {
        await this.redis.del(key);
      }

      // Remove from KOL wallet subscribers list
      await this.removeKOLWalletSubscriber(kolWallet, userId);

      return {
        message: "Subscription removed successfully",
        success: true,
        data: {
          subscription: filteredSubscriptions
        }
      }
    } catch (error) {
      console.error('Failed to remove subscription:', error);
      throw error;
    }
  }

  /**
   * Get all users subscribed to a specific KOL wallet
   */
  async getUsersForKOL(kolWallet: string): Promise<string[]> {
    try {
      const key = configService.getRedisKey(config.cache.keyPrefixes.kolWallets, `subscribers:${kolWallet}`);
      const userIds = await this.redis.smembers(key);
      return userIds;
    } catch (error) {
      console.error(`Failed to get users for KOL ${kolWallet}:`, error);
      return [];
    }
  }

  /**
   * Get detailed subscriptions for a specific KOL wallet
   */
  async getSubscriptionsForKOL(kolWallet: string): Promise<{message: string, success: boolean, data: {subscriptions: UserSubscription[]}}> {
    try {
      const userIds = await this.getUsersForKOL(kolWallet);
      const subscriptions: UserSubscription[] = [];

      for (const userId of userIds) {
        const {data: {subscriptions: userSubscriptions}} = await this.getUserSubscriptions(userId);
        const kolSubscription = userSubscriptions.find(sub => sub.kolWallet === kolWallet);
        if (kolSubscription) {
          subscriptions.push(kolSubscription);
        }
      }

      return {
        message: "Subscriptions fetched successfully",
        success: true,
        data: {
          subscriptions: subscriptions
        }
      }
    } catch (error) {
      console.error(`Failed to get subscriptions for KOL ${kolWallet}:`, error);
      return {
        message: "Failed to get subscriptions for KOL",
        success: false,
        data: {
          subscriptions: []
        }
      }
    }
  }

  // ===== KOL WALLET MANAGEMENT =====

  /**
   * Get all currently watched KOL wallets
   */
  async getWatchedKOLWallets(): Promise<{message: string, success: boolean, data: {wallets: string[]}}> {
    try {
      const key = configService.getRedisKey(config.cache.keyPrefixes.kolWallets, 'active');
      const wallets = await this.redis.smembers(key);
      return {
        message: "Watched KOL wallets fetched successfully",
        success: true,
        data: {
          wallets: wallets
        }
      }
    } catch (error) {
      console.error('Failed to get watched KOL wallets:', error);
      return {
        message: "Failed to get watched KOL wallets",
        success: false,
        data: {
          wallets: []
        }
      }
    }
  }

  /**
   * Add a KOL wallet to the watched list
   */
  async addKOLWallet(walletAddress: string, ttl?: number): Promise<void> {
    try {
      console.log(`🔍 Adding KOL wallet to watch list: ${walletAddress}`);
      const key = configService.getRedisKey(config.cache.keyPrefixes.kolWallets, 'active');
      await this.redis.sadd(key, walletAddress);
      
      // Set expiration
      if (config.cache.ttl.kolWallets > 0 || ttl) {
        await this.redis.expire(key, config.cache.ttl.kolWallets || ttl!);
      }

      console.log(`✅ Added KOL wallet to watch list: ${walletAddress}`);
    } catch (error) {
      console.error(`Failed to add KOL wallet ${walletAddress}:`, error);
      throw error;
    }
  }

  /**
   * Remove a KOL wallet from the watched list
   * @param walletAddress - The wallet address to remove
   * development: kol:development:active
   * stagingKey: kol:staging:active
   * productionKey: kol:active
   */
  async removeKOLWallet(walletAddress: string): Promise<void> {
    try {
      const key = configService.getRedisKey(config.cache.keyPrefixes.kolWallets, 'active');
      await this.redis.srem(key, walletAddress);
      console.log(`✅ Removed KOL wallet from watch list: ${walletAddress}`);
    } catch (error) {
      console.error(`Failed to remove KOL wallet ${walletAddress}:`, error);
      throw error;
    }
  }

  /**
   * Add user to KOL wallet subscribers list
   */
  private async addKOLWalletSubscriber(kolWallet: string, userId: string): Promise<void> {
    try {
      const key = configService.getRedisKey(config.cache.keyPrefixes.kolWallets, `subscribers:${kolWallet}`);
      await this.redis.sadd(key, userId);
      
      // Set expiration
      if (config.cache.ttl.kolWallets > 0) {
        await this.redis.expire(key, config.cache.ttl.kolWallets);
      }
    } catch (error) {
      console.error(`Failed to add subscriber ${userId} to KOL ${kolWallet}:`, error);
    }
  }

  /**
   * Remove user from KOL wallet subscribers list
   */
  private async removeKOLWalletSubscriber(kolWallet: string, userId: string): Promise<void> {
    try {
      const key = configService.getRedisKey(config.cache.keyPrefixes.kolWallets, `subscribers:${kolWallet}`);
      await this.redis.srem(key, userId);

      // If no subscribers left, remove KOL wallet from active watch list
      const subscribersCount = await this.redis.scard(key);
      if (subscribersCount === 0) {
        await this.removeKOLWallet(kolWallet);
        // Also remove the empty subscribers set
        await this.redis.del(key);
      }
    } catch (error) {
      console.error(`Failed to remove subscriber ${userId} from KOL ${kolWallet}:`, error);
    }
  }

  // ===== TRADE HISTORY MANAGEMENT =====

  /**
   * Store a KOL trade in cache for quick access
   */
  async storeKOLTrade(trade: KOLTrade): Promise<void> {
    try {
      const key = configService.getRedisKey(config.cache.keyPrefixes.tradeHistory, `kol:${trade.kolWallet}:${trade.id}`);
      await this.redis.setex(
        key,
        config.cache.ttl.tradeHistory,
        JSON.stringify(trade)
      );

      // Also store in a sorted set for recent trades lookup
      const recentKey = configService.getRedisKey(config.cache.keyPrefixes.tradeHistory, `recent:${trade.kolWallet}`);
      await this.redis.zadd(recentKey, trade.timestamp.getTime(), trade.id);
      await this.redis.expire(recentKey, config.cache.ttl.tradeHistory);
       // Keep only last 100 trades per KOL
      await this.redis.zremrangebyrank(recentKey, 0, -101);

      
      
      const globalRecentKey = configService.getRedisKey(
        config.cache.keyPrefixes.tradeHistory,
        'recent'          // <- no kolWallet suffix
      );
      await this.redis.zadd(globalRecentKey, trade.timestamp.getTime(), JSON.stringify(trade));
      await this.redis.expire(globalRecentKey, config.cache.ttl.tradeHistory);
      // optional: trim global list to last N trades
      await this.redis.zremrangebyrank(globalRecentKey, 0, -1001);

      console.log(`✅ Stored KOL trade: ${trade.id} for ${trade.kolWallet}`);
    } catch (error) {
      console.error('Failed to store KOL trade:', error);
    }
  }

  async getRecentTrades(limit: number = 10): Promise<{message: string, success: boolean, data: {trades: KOLTrade[]}}> {
    try{
      const key = configService.getRedisKey(config.cache.keyPrefixes.tradeHistory, `recent`);
      const tradeIds = await this.redis.zrevrange(key, 0, limit - 1);
      const trades = [];
      for (const tradeId of tradeIds) {
        if(tradeId !== "9c4ff65c-ce4a-4793-a350-0b6d813b60a9"){
          trades.push(JSON.parse(tradeId));
        }
      }
      return {
        message: "Recent trades fetched successfully",
        success: true,
        data: {
          trades: trades
        }
      }
    }catch(error){
      console.error('Failed to get recent trades:', error);
      return {
        message: "Failed to get recent trades",
        success: false,
        data: {
          trades: []
        }
      }
    }
  }

  /**
   * Get recent trades for a KOL wallet
   */
  async getRecentKOLTrades(kolWallet: string, limit: number = 10): Promise<{message: string, success: boolean, data: {trades: KOLTrade[]}}> {
    try {
      const recentKey = configService.getRedisKey(config.cache.keyPrefixes.tradeHistory, `recent:${kolWallet}`);
      const tradeIds = await this.redis.zrevrange(recentKey, 0, limit - 1);
      
      const trades: KOLTrade[] = [];
      for (const tradeId of tradeIds) {
        const tradeKey = configService.getRedisKey(config.cache.keyPrefixes.tradeHistory, `kol:${kolWallet}:${tradeId}`);
        const tradeData = await this.redis.get(tradeKey);
        if (tradeData) {
          trades.push(JSON.parse(tradeData));
        }
      }

      return {
        message: "Recent trades fetched successfully",
        success: true,
        data: {
          trades: trades
        }
      }
    } catch (error) {
      console.error(`Failed to get recent trades for ${kolWallet}:`, error);
      return {
        message: "Failed to get recent trades",
        success: false,
        data: {
          trades: []
        }
      }
    }
  }

  // ===== SERVICE METRICS =====

  /**
   * Store service metrics
   */
  async storeServiceMetrics(metrics: ServiceMetrics): Promise<void> {
    try {
      const key = configService.getRedisKey(config.cache.keyPrefixes.serviceMetrics, 'current');
      await this.redis.setex(
        key,
        config.cache.ttl.serviceMetrics,
        JSON.stringify({
          ...metrics,
          timestamp: new Date().toISOString()
        })
      );
    } catch (error) {
      console.error('Failed to store service metrics:', error);
    }
  }

  /**
   * Get current service metrics
   */
  async getServiceMetrics(): Promise<ServiceMetrics | null> {
    try {
      const key = configService.getRedisKey(config.cache.keyPrefixes.serviceMetrics, 'current');
      const data = await this.redis.get(key);
      
      if (!data) {
        return null;
      }

      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to get service metrics:', error);
      return null;
    }
  }

  /**
   * Increment a counter metric
   */
  async incrementCounter(counterName: string, amount: number = 1): Promise<number> {
    try {
      const key = configService.getRedisKey(config.cache.keyPrefixes.serviceMetrics, `counter:${counterName}`);
      const newValue = await this.redis.incrby(key, amount);
      
      // Set expiration for daily reset
      await this.redis.expire(key, 86400); // 24 hours
      
      return newValue;
    } catch (error) {
      console.error(`Failed to increment counter ${counterName}:`, error);
      return 0;
    }
  }

  /**
   * Get counter value
   */
  async getCounter(counterName: string): Promise<number> {
    try {
      const key = configService.getRedisKey(config.cache.keyPrefixes.serviceMetrics, `counter:${counterName}`);
      const value = await this.redis.get(key);
      return value ? parseInt(value, 10) : 0;
    } catch (error) {
      console.error(`Failed to get counter ${counterName}:`, error);
      return 0;
    }
  }

  // ===== UTILITY METHODS =====

  /**
   * Set a key-value pair with optional expiration
   */
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
      
      if (ttlSeconds) {
        await this.redis.setex(key, ttlSeconds, serializedValue);
      } else {
        await this.redis.set(key, serializedValue);
      }
    } catch (error) {
      console.error(`Failed to set key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Get a value by key
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      if (!value) {
        return null;
      }

      try {
        return JSON.parse(value);
      } catch {
        // If JSON parsing fails, return as string
        return value as any;
      }
    } catch (error) {
      console.error(`Failed to get key ${key}:`, error);
      return null;
    }
  }

  /**
   * Delete a key
   */
  async delete(key: string): Promise<boolean> {
    try {
      const result = await this.redis.del(key);
      return result > 0;
    } catch (error) {
      console.error(`Failed to delete key ${key}:`, error);
      return false;
    }
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      console.error(`Failed to check existence of key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get Redis connection status
   */
  public isReady(): boolean {
    return this.isConnected && this.redis.status === 'ready';
  }

  /**
   * Get health information
   */
  public getHealth() {
    return {
      connected: this.isConnected,
      status: this.redis.status,
      url: config.cache.redisUrl
    };
  }

  /**
   * Flush all data (use with caution!)
   */
  async flushAll(): Promise<void> {
    try {
      if (!configService.isProduction()) {
        await this.redis.flushall();
        console.log('✅ Redis cache flushed');
      } else {
        console.warn('⚠️  Cannot flush Redis in production environment');
      }
    } catch (error) {
      console.error('Failed to flush Redis:', error);
      throw error;
    }
  }
} 