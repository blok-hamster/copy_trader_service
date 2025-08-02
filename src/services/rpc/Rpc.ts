import amqp, { Connection, Channel, ConsumeMessage } from 'amqplib';
import { CacheService } from '../cache/CacheService';
import { AddressTransaction, HeliusWebhookService, ParsedSwap } from '../blockchain/HeliusWebhookService';

export interface RpcServerOptions {
  /** RabbitMQ connection URL, e.g. 'amqp://localhost' */
  url: string;
  /** The queue name to listen for RPC requests */
  queue: string;
  /** The channel prefetch count; defaults to 1 */
  prefetch?: number;
}

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

interface IUnsubscribeFromKOL {
  kolWallet: string, 
  userId: string
}

export class RpcServer {
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private readonly options: RpcServerOptions;
  private isClosing = false;
  static instance: RpcServer;
  isInitialized = false;

  private cacheService: CacheService;
  private heliusWebhookService: HeliusWebhookService;

 
  constructor(options: RpcServerOptions) {
    this.options = options;
    this.cacheService = CacheService.getInstance();
    this.heliusWebhookService = HeliusWebhookService.getInstance();
  }

  static getInstance(options: RpcServerOptions): RpcServer {
    if(!RpcServer.instance || !RpcServer.instance.isInitialized) {
      RpcServer.instance = new RpcServer(options);
      RpcServer.instance.isInitialized = true;
    }
    return RpcServer.instance;
  }

  /**
   * Starts the RPC server by establishing a connection, creating a channel,
   * asserting the queue, and beginning consumption of messages.
   */
  public async start(): Promise<void> {
    try {
      this.connection = await amqp.connect(this.options.url) as unknown as Connection;
      this.setupConnectionHandlers();
      this.channel = await (this.connection as any).createChannel();
      await this.channel!.assertQueue(this.options.queue, { durable: false });
      const prefetchCount = this.options.prefetch ?? 1;
      this.channel!.prefetch(prefetchCount);
      console.log(` [x] Awaiting RPC requests on queue: ${this.options.queue}`);

      await this.channel!.consume(this.options.queue, async (msg) => {
        if (msg) {
          try {
            // Process the incoming message to fetch data from the server
            const responseData = await this.handleMessage(msg);
            this.channel!.sendToQueue(
              msg.properties.replyTo,
              Buffer.from(JSON.stringify(responseData)),
              { correlationId: msg.properties.correlationId }
            );
          } catch (err) {
            console.error('Error processing message:', err);
            // Optionally, respond with an error object
            this.channel!.sendToQueue(
              msg.properties.replyTo,
              Buffer.from(JSON.stringify({ error: 'Error processing request' })),
              { correlationId: msg.properties.correlationId }
            );
          } finally {
            this.channel!.ack(msg);
          }
        }
      });
    } catch (error) {
      console.error('Failed to start RPC server:', error);
      // If not shutting down, try to reconnect after a delay
      if (!this.isClosing) {
        setTimeout(() => this.start(), 1000);
      }
    }
  }

  /**
   * Processes the message received from the queue. This method is responsible for
   * retrieving data from the server. By default, it parses the incoming JSON payload
   * and passes it to getServerData. You can override this method in a subclass if needed.
   *
   * @param msg - The incoming RabbitMQ message
   * @returns The data to be sent back to the caller
   */
  protected async handleMessage(msg: ConsumeMessage): Promise<any> {
    const requestData = JSON.parse(msg.content.toString());
    console.log('Received request:', requestData);

    // Retrieve data from the server (replace with your actual logic)
    const serverData = await this.getServerData(requestData);
    return serverData;
  }

  /**
   * Simulates data retrieval from the server. Replace this method with your actual
   * data retrieval logic, such as database queries or API calls.
   *
   * @param requestData - Data received from the RPC request
   * @returns An object containing data from the server
   */
  private async getServerData(requestData: any): Promise<any> {
    //The requestData should include the method and its arguements.. 
    /**
     * exampleMethod2: {
     *  "method": "getAgentsByCategory",
     *  "args": {
     *    "category": "Smart_Contract"
     *  }
     * },
     * exampleMethod3: {
     *  "method": "getAgentsByIds",
     *  "args": {
     *    "ids": ["AG0001", "AG0002", "AG0003"]
     *  }
     * },
     * exampleMethod4: {
     *  "method": "allAgents",
     *  "args": {}
     * }
     */

    const {method, args} = requestData
    switch (method) {
      case "createUserSubscription": //✅
        /**
         * userSubscription: {
         *  userId: string;
         *  kolWallet: string;
         *  isActive: boolean;
         *  copyPercentage: number;
         *  maxAmount: number;
         *  minAmount: number;
         *  privateKey: string;
         *  walletAddress: string;
         *  createdAt: Date;
         *  updatedAt: Date;
         *  settings: {
         *    enableSlippageProtection: boolean;
         *    maxSlippagePercent: number;
         *    enableDexWhitelist: boolean;
         *    allowedDexes: string[];
         *    enableTokenBlacklist: boolean;
         *    blacklistedTokens: string[];
         *    enableTimeRestrictions: boolean;
         *    tradingHours: {
         *      start: string;
         *      end: string;
         *      timezone: string;
         *    };
         *  }
         * }
         */
        const subscription: UserSubscription[] = await this.heliusWebhookService.subscribeToKOL(args.subscription);
        return subscription;

      case "removeUserSubscription": //✅
        const unsubscribeFromKOL = await this.heliusWebhookService.unsubscribeFromKOL(args.userId, args.kolWallet);
        const data: IUnsubscribeFromKOL = unsubscribeFromKOL.data
        return data
      case "addKolWalletToWebhook": //✅
        return await this.heliusWebhookService.addKolWalletToWebhook(args.kolWallets);
      case "removeKolWalletFromWebhook": //✅
        return await this.heliusWebhookService.removeKOLWalletWebhook(args.kolWallet);
        //////////////////////////////////////////////////////////////////////////////////
        //////////////////////////////////////////////////////////////////////////////////
      case "getSubscriptionsForKOL": //✅
        const subscriptionsForKOL = await this.cacheService.getSubscriptionsForKOL(args.kolWallet);
        const kolSub: UserSubscription[] = subscriptionsForKOL.data.subscriptions
        return kolSub;
      case "getSubscriptionsForUser": //✅
        const userSubscriptions = await this.cacheService.getUserSubscriptions(args.userId);
        const userSub: UserSubscription[] = userSubscriptions.data.subscriptions
        return userSub;
      case "getKolWallets": //✅
        const kolWallets = await this.cacheService.getWatchedKOLWallets();
        const kolWalletsData: string[] = kolWallets.data.wallets
        return kolWalletsData;
      case "getRecentKOLTrades": //✅
        const recentKOLTrades = await this.cacheService.getRecentKOLTrades(args.kolWallet, args.limit);
        const recentKOLTradesData: KOLTrade[] = recentKOLTrades.data.trades
        return recentKOLTradesData;
      case "getTradeHistory": //✅
        const tradeHistory = await this.cacheService.getRecentTrades(args.limit);
        const tradeHistoryData: KOLTrade[] = tradeHistory.data.trades
        return tradeHistoryData;
      case "getKOLSwapTransactions": //✅
        const swapTransactions = await this.heliusWebhookService.getKOLSwapTransactions(args.address, {
          limit: 100,
          before: args.before,
          after: args.after,
          commitment: "confirmed",
        });
        const swapTransactionsData: AddressTransaction = swapTransactions.data
        return swapTransactionsData;
    //   case "toolsByCategory":
    //     return toolsByCategory(args.category)
      default:
        return {
          message: 'Invalid method',
          request: requestData,
          timestamp: new Date().toISOString(),
          data:null
        }
    }
  }

  /**
   * Gracefully shuts down the RPC server by closing the channel and connection.
   */
  public async stop(): Promise<void> {
    this.isClosing = true;
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await (this.connection as any).close();
      }
      console.log('RPC server stopped gracefully.');
    } catch (error) {
      console.error('Error during shutdown:', error);
    }
  }

  /**
   * Sets up error and close event handlers for the AMQP connection.
   */
  private setupConnectionHandlers(): void {
    if (!this.connection) return;

    this.connection.on('error', (err) => {
      console.error('AMQP connection error:', err);
    });

    this.connection.on('close', () => {
      console.warn('AMQP connection closed.');
      if (!this.isClosing) {
        console.error('Connection closed unexpectedly. Attempting to restart...');
        setTimeout(() => this.start(), 1000);
      }
    });
  }
}
