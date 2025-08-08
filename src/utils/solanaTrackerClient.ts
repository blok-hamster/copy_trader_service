import axios, { AxiosInstance } from 'axios';
import { solanaTrackerConfig } from '../config/solana-tracker.config';
import { OHLCVResponse, ChartDataOptions, HoldersChartResponse, HoldersChartOptions } from '../types';

export class SolanaTrackerClient {
  private client: AxiosInstance;
  private requestQueue: Array<() => Promise<any>> = [];
  private isProcessing = false;
  private lastRequestTime = 0;

  constructor() {
    this.client = axios.create({
      baseURL: solanaTrackerConfig.endpoint,
      headers: solanaTrackerConfig.headers,
      timeout: 30000,
    });

    this.setupInterceptors();
  }

  /**
   * Make a GET request to the Solana Tracker API with rate limiting
   */
  async get(endpoint: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const response = await this.executeRequest(endpoint, params);
          resolve(response);
        } catch (error) {
          reject(error);
        }
      });

      this.processQueue();
    });
  }

  /**
   * Get wallet trades from the Solana Tracker API
   */
  async getWalletTrades(walletAddress: string, cursor?: string): Promise<any> {
    const params: any = {};
    if (cursor) {
      params.cursor = cursor;
    }

    return this.get(`/wallet/${walletAddress}/trades`, params);
  }

  /**
   * Get wallet tokens from the Solana Tracker API
   */
  async getWalletTokens(walletAddress: string): Promise<any> {
    return this.get(`/wallet/${walletAddress}`);
  }

  /**
   * Get token information from the Solana Tracker API
   */
  async getTokenInfo(tokenAddress: string): Promise<any> {
    return this.get(`/tokens/${tokenAddress}`);
  }

  /**
   * Get OHLCV chart data for a token
   */
  async getTokenChartData(tokenAddress: string, options?: ChartDataOptions): Promise<OHLCVResponse> {
    const params: any = {};
    
    if (options?.type) {
      params.type = options.type;
    }
    if (options?.time_from) {
      params.time_from = options.time_from;
    }
    if (options?.time_to) {
      params.time_to = options.time_to;
    }
    if (options?.marketCap !== undefined) {
      params.marketCap = options.marketCap;
    }
    if (options?.removeOutliers !== undefined) {
      params.removeOutliers = options.removeOutliers;
    }
    const data = await this.get(`/chart/${tokenAddress}`, params);
    return data;
  }

  /**
   * Get OHLCV chart data for a specific token and pool
   */
  async getTokenPoolChartData(tokenAddress: string, poolAddress: string, options?: ChartDataOptions): Promise<OHLCVResponse> {
    const params: any = {};
    
    if (options?.type) {
      params.type = options.type;
    }
    if (options?.time_from) {
      params.time_from = options.time_from;
    }
    if (options?.time_to) {
      params.time_to = options.time_to;
    }
    if (options?.marketCap !== undefined) {
      params.marketCap = options.marketCap;
    }
    if (options?.removeOutliers !== undefined) {
      params.removeOutliers = options.removeOutliers;
    }

    return this.get(`/chart/${tokenAddress}/${poolAddress}`, params);
  }

  /**
   * Get holders chart data for a token
   */
  async getTokenHoldersChart(tokenAddress: string, options?: HoldersChartOptions): Promise<HoldersChartResponse> {
    const params: any = {};
    
    if (options?.type) {
      params.type = options.type;
    }
    if (options?.time_from) {
      params.time_from = options.time_from;
    }
    if (options?.time_to) {
      params.time_to = options.time_to;
    }

    return this.get(`/holders/chart/${tokenAddress}`, params);
  }

  /**
   * Process the request queue with rate limiting
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift()!;
      
      // Rate limiting: ensure minimum time between requests
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      const minInterval = 1000 / solanaTrackerConfig.rateLimit.requestsPerSecond;
      
      if (timeSinceLastRequest < minInterval) {
        await this.delay(minInterval - timeSinceLastRequest);
      }

      try {
        await request();
        this.lastRequestTime = Date.now();
      } catch (error) {
        console.error('Request failed:', error);
        // Continue processing other requests
      }
    }

    this.isProcessing = false;
  }

  /**
   * Execute the actual REST API request
   */
  private async executeRequest(endpoint: string, params?: any): Promise<any> {
    try {
      const response = await this.client.get(endpoint, { params });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorMessage = error.response?.data?.message || error.message;
        throw new Error(`Solana Tracker API error: ${errorMessage}`);
      }
      throw error;
    }
  }

  /**
   * Setup axios interceptors for logging and error handling
   */
  private setupInterceptors(): void {
    this.client.interceptors.request.use(
      (config) => {
        //console.log(`Making request to: ${config.baseURL}${config.url}`);
        return config;
      },
      (error) => {
        console.error('Request error:', error);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        // console.log(`Response received: ${response.status}`);
        // console.log(`response.data:`, response.data);
        return response;
      },
      (error) => {
        console.error('Response error:', error.response?.status, error.response?.data);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Utility method to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate API key configuration
   */
  validateConfig(): void {
    if (!solanaTrackerConfig.apiKey) {
      throw new Error('Solana Tracker API key is required. Set SOLANA_TRACKER_API_KEY environment variable.');
    }
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.get('/credits');
      return response && response.credits !== undefined;
    } catch (error) {
      console.error('API connection test failed:', error);
      return false;
    }
  }
} 