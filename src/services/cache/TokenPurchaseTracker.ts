import { Redis } from 'ioredis';
import { CacheService } from './CacheService';
import { configService, config } from '../../config';

export interface TokenPurchaseRecord {
  userId: string;
  tokenMint: string;
  currentCount: number;
  maxCount: number;
  lastPurchaseTimestamp: number;
  subscriptionId: string;
}

export interface PurchaseValidationResult {
  canPurchase: boolean;
  currentCount: number;
  maxCount: number;
  remainingPurchases: number;
}

export class TokenPurchaseTracker {
  private redis: Redis;
  private cacheService: CacheService;
  private static instance: TokenPurchaseTracker;
  
  // Cache key prefixes
  private readonly PURCHASE_COUNT_KEY = 'token_buy_count';
  private readonly PURCHASE_RECORD_KEY = 'token_purchase_record';
  
  // Default TTL for purchase records (24 hours)
  private readonly DEFAULT_TTL = 24 * 60 * 60;

  constructor() {
    this.cacheService = CacheService.getInstance();
    this.redis = (this.cacheService as any).redis; // Access Redis instance
  }

  static getInstance(): TokenPurchaseTracker {
    if (!TokenPurchaseTracker.instance) {
      TokenPurchaseTracker.instance = new TokenPurchaseTracker();
    }
    return TokenPurchaseTracker.instance;
  }

  /**
   * Ensure Redis connection is ready
   */
  private async ensureConnection(): Promise<void> {
    if (this.redis.status !== 'ready') {
      await this.cacheService.connect();
    }
  }

  /**
   * Fast validation check - returns in <1ms
   * Checks if user can purchase a token based on their subscription limits
   */
  async canUserPurchaseToken(
    userId: string, 
    tokenMint: string, 
    maxPurchaseCount: number
  ): Promise<PurchaseValidationResult> {
    try {
      await this.ensureConnection();
      
      const countKey = this.buildCountKey(userId, tokenMint);
      
      // Atomic get operation - single Redis call
      const currentCount = await this.redis.get(countKey);
      const count = currentCount ? parseInt(currentCount, 10) : 0;
      
      const canPurchase = count < maxPurchaseCount;
      const remainingPurchases = Math.max(0, maxPurchaseCount - count);
      
      return {
        canPurchase,
        currentCount: count,
        maxCount: maxPurchaseCount,
        remainingPurchases
      };
    } catch (error) {
      console.error(`Failed to validate purchase for user ${userId}, token ${tokenMint}:`, error);
      // Fail safe - allow purchase if validation fails
      return {
        canPurchase: true,
        currentCount: 0,
        maxCount: maxPurchaseCount,
        remainingPurchases: maxPurchaseCount
      };
    }
  }

  /**
   * Atomic increment and validation in single Redis transaction
   * Returns true if increment was successful (within limits)
   */
  async incrementAndValidatePurchase(
    userId: string,
    tokenMint: string,
    maxPurchaseCount: number,
    subscriptionId: string
  ): Promise<{ success: boolean; newCount: number; wasAtLimit: boolean }> {
    try {
      await this.ensureConnection();
      
      const countKey = this.buildCountKey(userId, tokenMint);
      const recordKey = this.buildRecordKey(userId, tokenMint);
      
      // Use Redis MULTI for atomic transaction
      const multi = this.redis.multi();
      
      // Increment counter
      multi.incr(countKey);
      multi.expire(countKey, this.DEFAULT_TTL);
      
      const results = await multi.exec();
      
      if (!results || results.some(([err]) => err)) {
        throw new Error('Redis transaction failed');
      }
      
      // Add null check for results[0]
      const firstResult = results[0];
      if (!firstResult || !Array.isArray(firstResult) || firstResult.length < 2) {
        throw new Error('Invalid Redis transaction result');
      }
      
      const newCount = firstResult[1] as number;
      const wasAtLimit = newCount > maxPurchaseCount;
      
      // If we exceeded the limit, decrement back
      if (wasAtLimit) {
        await this.redis.decr(countKey);
        return { success: false, newCount: newCount - 1, wasAtLimit: true };
      }
      
      // Update the detailed record with the actual count
      const record: TokenPurchaseRecord = {
        userId,
        tokenMint,
        currentCount: newCount,
        maxCount: maxPurchaseCount,
        lastPurchaseTimestamp: Date.now(),
        subscriptionId
      };
      
      await this.redis.set(recordKey, JSON.stringify(record), 'EX', this.DEFAULT_TTL);
      
      return { success: true, newCount, wasAtLimit: false };
      
    } catch (error) {
      console.error(`Failed to increment purchase for user ${userId}, token ${tokenMint}:`, error);
      return { success: false, newCount: 0, wasAtLimit: false };
    }
  }

  /**
   * Get current purchase count for a user-token pair
   */
  async getCurrentPurchaseCount(userId: string, tokenMint: string): Promise<number> {
    try {
      const countKey = this.buildCountKey(userId, tokenMint);
      const count = await this.redis.get(countKey);
      return count ? parseInt(count, 10) : 0;
    } catch (error) {
      console.error(`Failed to get purchase count for user ${userId}, token ${tokenMint}:`, error);
      return 0;
    }
  }

  /**
   * Get detailed purchase record
   */
  async getPurchaseRecord(userId: string, tokenMint: string): Promise<TokenPurchaseRecord | null> {
    try {
      const recordKey = this.buildRecordKey(userId, tokenMint);
      const record = await this.redis.get(recordKey);
      
      if (!record) {
        return null;
      }
      
      return JSON.parse(record) as TokenPurchaseRecord;
    } catch (error) {
      console.error(`Failed to get purchase record for user ${userId}, token ${tokenMint}:`, error);
      return null;
    }
  }

  /**
   * Reset purchase count for a user-token pair (admin function)
   */
  async resetPurchaseCount(userId: string, tokenMint: string): Promise<boolean> {
    try {
      const countKey = this.buildCountKey(userId, tokenMint);
      const recordKey = this.buildRecordKey(userId, tokenMint);
      
      const multi = this.redis.multi();
      multi.del(countKey);
      multi.del(recordKey);
      
      const results = await multi.exec();
      return !results?.some(([err]) => err);
    } catch (error) {
      console.error(`Failed to reset purchase count for user ${userId}, token ${tokenMint}:`, error);
      return false;
    }
  }

  /**
   * Get all token purchase records for a user
   */
  async getUserTokenPurchases(userId: string): Promise<TokenPurchaseRecord[]> {
    try {
      const pattern = this.buildRecordKey(userId, '*');
      const keys = await this.redis.keys(pattern);
      
      if (keys.length === 0) {
        return [];
      }
      
      const records = await this.redis.mget(...keys);
      return records
        .filter(record => record !== null)
        .map(record => JSON.parse(record!))
        .filter(record => record !== null);
    } catch (error) {
      console.error(`Failed to get user token purchases for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Get statistics about token purchases for monitoring
   */
  async getTokenPurchaseStats(): Promise<{
    totalTokens: number;
    totalUsers: number;
    activeTokens: string[];
    topTokensByPurchases: { tokenMint: string; totalPurchases: number }[];
  }> {
    try {
      const countPattern = `${configService.getRedisKey(config.cache.keyPrefixes.tokenPurchases || 'token_purchases', `${this.PURCHASE_COUNT_KEY}:*`)}`;
      const countKeys = await this.redis.keys(countPattern);
      
      const uniqueTokens = new Set<string>();
      const uniqueUsers = new Set<string>();
      const tokenPurchaseCounts: { [key: string]: number } = {};
      
      // Process all count keys to gather statistics
      for (const key of countKeys) {
        const parts = key.split(':');
        if (parts.length >= 4) {
          const userId = parts[parts.length - 2];
          const tokenMint = parts[parts.length - 1];
          
          // Add type guards to ensure userId and tokenMint are defined
          if (userId && tokenMint) {
            uniqueUsers.add(userId);
            uniqueTokens.add(tokenMint);
            
            const count = await this.redis.get(key);
            const purchaseCount = count ? parseInt(count, 10) : 0;
            tokenPurchaseCounts[tokenMint] = (tokenPurchaseCounts[tokenMint] || 0) + purchaseCount;
          }
        }
      }
      
      // Sort tokens by total purchases
      const topTokensByPurchases = Object.entries(tokenPurchaseCounts)
        .map(([tokenMint, totalPurchases]) => ({ tokenMint, totalPurchases }))
        .sort((a, b) => b.totalPurchases - a.totalPurchases)
        .slice(0, 10); // Top 10 tokens
      
      return {
        totalTokens: uniqueTokens.size,
        totalUsers: uniqueUsers.size,
        activeTokens: Array.from(uniqueTokens),
        topTokensByPurchases
      };
    } catch (error) {
      console.error('Failed to get token purchase stats:', error);
      return {
        totalTokens: 0,
        totalUsers: 0,
        activeTokens: [],
        topTokensByPurchases: []
      };
    }
  }

  /**
   * Cleanup expired records (maintenance function)
   */
  async cleanupExpiredRecords(): Promise<number> {
    try {
      const pattern = `${configService.getRedisKey(config.cache.keyPrefixes.tokenPurchases || 'token_purchases', '*')}`;
      const keys = await this.redis.keys(pattern);
      
      if (keys.length === 0) {
        return 0;
      }
      
      // Check TTL for each key and remove expired ones
      const expiredKeys: string[] = [];
      
      for (const key of keys) {
        const ttl = await this.redis.ttl(key);
        if (ttl === -2) { // Key doesn't exist
          expiredKeys.push(key);
        }
      }
      
      if (expiredKeys.length > 0) {
        await this.redis.del(...expiredKeys);
      }
      
      return expiredKeys.length;
    } catch (error) {
      console.error('Failed to cleanup expired records:', error);
      return 0;
    }
  }

  // Private helper methods
  private buildCountKey(userId: string, tokenMint: string): string {
    return configService.getRedisKey(
      config.cache.keyPrefixes.tokenPurchases || 'token_purchases',
      `${this.PURCHASE_COUNT_KEY}:${userId}:${tokenMint}`
    );
  }

  private buildRecordKey(userId: string, tokenMint: string): string {
    return configService.getRedisKey(
      config.cache.keyPrefixes.tokenPurchases || 'token_purchases', 
      `${this.PURCHASE_RECORD_KEY}:${userId}:${tokenMint}`
    );
  }
} 