import { Helius, TransactionType, WebhookType } from 'helius-sdk';
import { classifySwap, parseSwap, Side } from '../../utils/swapClassifier';
import { callRpcServer } from '../rpc/Rpc_consumer';
// import express, { Express, Request, Response } from 'express';
// import cors from 'cors';
import { CacheService } from '../cache/CacheService';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { config, configService } from '../../config';
import { KOLTrade } from '../../types';
import axios, { AxiosResponse } from 'axios';

//const WEBHOOK_ID = 'c6b11641-ac4a-4588-9ada-561f50cb0652'

export interface ParsedSwap {
  side: Side;
  tokenMint: string;
  tokenAmount: number;
  solAmount: number;
}

export interface AddressTransaction{transactions: ParsedSwap[], pagination?: { before?: string; after?: string; hasMore: boolean }}

export interface GetTransactionsByAddressParams {
  /** Maximum number of transactions to return (default: 100, max: 1000) */
  limit?: number;
  /** Cursor for pagination - transactions before this cursor */
  before?: string;
  /** Cursor for pagination - transactions after this cursor */
  after?: string;
  /** Commitment level for the query */
  commitment?: 'processed' | 'confirmed' | 'finalized';
  /** Filter by transaction type */
  type?: string[];
  /** Filter by source */
  source?: string[];
  /** Start time filter (Unix timestamp) */
  startTime?: number;
  /** End time filter (Unix timestamp) */
  endTime?: number;
}

export interface EnhancedTransaction {
  description: string;
  type: string;
  source: string;
  fee: number;
  feePayer: string;
  signature: string;
  slot: number;
  timestamp: number;
  nativeTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  tokenTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    fromTokenAccount: string;
    toTokenAccount: string;
    tokenAmount: number;
    mint: string;
  }>;
  accountData?: Array<{
    account: string;
    nativeBalanceChange: number;
    tokenBalanceChanges?: Array<{
      userAccount: string;
      tokenAccount: string;
      mint: string;
      rawTokenAmount: {
        tokenAmount: string;
        decimals: number;
      };
    }>;
  }>;
  transactionError?: {
    error: string;
  };
  instructions?: Array<any>;
  events?: {
    nft?: any;
    swap?: {
      nativeInput?: {
        account: string;
        amount: string;
      };
      nativeOutput?: {
        account: string;
        amount: string;
      };
      tokenInputs?: Array<{
        userAccount: string;
        tokenAccount: string;
        mint: string;
        rawTokenAmount: {
          tokenAmount: string;
          decimals: number;
        };
      }>;
      tokenOutputs?: Array<{
        userAccount: string;
        tokenAccount: string;
        mint: string;
        rawTokenAmount: {
          tokenAmount: string;
          decimals: number;
        };
      }>;
      tokenFees?: Array<any>;
      nativeFees?: Array<any>;
      innerSwaps?: Array<any>;
    };
    compressed?: any;
    distributeCompressionRewards?: any;
    setAuthority?: any;
  };
}

export interface GetTransactionsByAddressResponse {
  transactions: EnhancedTransaction[];
  pagination?: {
    before?: string;
    after?: string;
    hasMore: boolean;
  };
}

export interface QueuedTradeParams {
  agentId: string;
  tradeType: 'buy' | 'sell' | undefined;
  amount: number | undefined;
  privateKey: string | undefined;
  mint: string | undefined;
  priority?: 'high' | 'medium' | 'low';
  watchConfig?: {
    takeProfitPercentage?: number;
    stopLossPercentage?: number;
    enableTrailingStop?: boolean;
    trailingPercentage?: number;
    maxHoldTimeMinutes?: number;
  }
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

export interface WebhookConfig {
  webhookId: string;
  walletAddress: string;
  webhookURL?: string;
  transactionTypes?: TransactionType[];
  accountAddresses?: string[];
}

export interface HeliusWebhookData {
  accountData: any[];
  description: string;
  events: any;
  fee: number;
  feePayer: string;
  nativeTransfers: any[];
  signature: string;
  slot: number;
  source: string;
  timestamp: number;
  tokenTransfers: any[];
  type: string;
}

export class HeliusWebhookService extends EventEmitter {
  private helius: Helius;
//   private app: Express;
//   private server: any;
  private webhooks: Map<string, WebhookConfig> = new Map();
  private port: number;
  private isInitialized = false;
  private static instance: HeliusWebhookService;
  private webhookEndpoint = '/helius-webhook';
  private cacheService: CacheService;
  private webhookID: string;
  constructor(port: number = 3001, webhookID: string = process.env.HELIUS_WEBHOOK_ID || '') {
    super();
    this.webhookID = webhookID;
    this.port = port;
    this.helius = new Helius(config.helius.apiKey);
    this.cacheService = CacheService.getInstance();
  }

  static getInstance(port: number = 3001): HeliusWebhookService {
    if (!HeliusWebhookService.instance) {
      HeliusWebhookService.instance = new HeliusWebhookService(port, process.env.HELIUS_WEBHOOK_ID || '');
      HeliusWebhookService.instance.isInitialized = true;
    }
    return HeliusWebhookService.instance;
  }

  /**
   * Create a webhook for monitoring a KOL wallet
   */
  async createKOLWalletWebhook(walletAddress: string[], webhookURL: string): Promise<string> {
    try {
      console.log(`📡 Creating webhook for KOL wallet: ${walletAddress}`);
      console.log(`🎯 Webhook URL: ${webhookURL}`);

      const webhookRequest = {
        webhookURL,
        transactionTypes: [TransactionType.SWAP], // Use the correct enum value
        accountAddresses: walletAddress,
        webhookType: WebhookType.ENHANCED, // Use the correct enum
      };

      console.log('📤 Sending webhook creation request:', JSON.stringify(webhookRequest, null, 2));
      
      const response = await this.helius.createWebhook(webhookRequest);
      
      if (response && response.webhookID) {
        for(const wallet of walletAddress) {
            this.cacheService.addKOLWallet(wallet);
        }
        

        console.log(`✅ Webhook created successfully for ${walletAddress}`);
        console.log(`🆔 Webhook ID: ${response.webhookID}`);
        const {data: {wallets: activeKols}} = await this.cacheService.getWatchedKOLWallets();
        console.log(`📋 Total monitored wallets: ${activeKols.length}`);

        return response.webhookID;
      } else {
        throw new Error('Invalid response from Helius webhook creation');
      }
    } catch (error) {
      console.error(`❌ Failed to create webhook for ${walletAddress}:`, error);
      throw error;
    }
  }

  async addKolWalletToWebhook(walletAddress: string[]): Promise<{message: string, success: boolean, data: {webhookID: string, wallets: string[]}}> {
    try{    
        console.log(`🆔 Webhook ID: ${this.webhookID}`);
        console.log(`📋 Wallets to add: ${walletAddress}`);
        let {data: {wallets: activeKols}} = await this.cacheService.getWatchedKOLWallets();
        const response = await this.helius.appendAddressesToWebhook(this.webhookID, walletAddress);
        if(response) {
          for(const wallet of walletAddress) {
            if(!activeKols.includes(wallet)) {
                this.cacheService.addKOLWallet(wallet);
            }
          }
        }
        
        const {data: {wallets: _activeKols}} = await this.cacheService.getWatchedKOLWallets();
        return {
          message: "Wallets added to webhook successfully",
          success: true,
          data: {
            webhookID: this.webhookID,
            wallets: _activeKols
          }
        }
    }catch(error: any){
        console.error(`❌ Failed to add wallet to webhook: ${walletAddress}:`, error);
        throw error;
    }
    
  }

  /**
   * Delete a webhook for a KOL wallet
   */
  async removeKOLWalletWebhook(walletAddress: string): Promise<{message: string, success: boolean, data: {webhookID: string, wallets: string[]}}> {
    try {

      console.log(`🗑️ Deleting webhook for KOL wallet: ${walletAddress}`);
      await this.helius.removeAddressesFromWebhook(this.webhookID, [walletAddress]);
      this.cacheService.removeKOLWallet(walletAddress);
      const {data: {wallets: activeKols}} = await this.cacheService.getWatchedKOLWallets();
      console.log(`✅ Webhook deleted for ${walletAddress}`);
      console.log(`📋 Remaining monitored wallets: ${activeKols.length}`);
      return {
        message: "Webhook deleted successfully",
        success: true,
        data: {
          webhookID: this.webhookID,
          wallets: activeKols
        }
      }
    } catch (error) {
      console.error(`❌ Failed to delete webhook for ${walletAddress}:`, error);
      throw error;
    }
  }

  /**
   * Get all webhooks managed by this service
   */
  async getAllWebhooks(): Promise<any[]> {
    try {
      const webhooks = await this.helius.getAllWebhooks();
      return webhooks || [];
    } catch (error) {
      console.error('❌ Failed to get all webhooks:', error);
      throw error;
    }
  }

  async subscribeToKOL(subscription: UserSubscription): Promise<UserSubscription[]> {
    try {
      const sub = await this.cacheService.addSubscription(subscription);
      //return subscription;
      const {data: {wallets: activeKols}} = await this.cacheService.getWatchedKOLWallets();
      if(!activeKols.includes(subscription.kolWallet)) {
        await this.addKolWalletToWebhook([subscription.kolWallet]);
      }
      return sub.data.subscription;
    } catch (error) {
      console.error('❌ Failed to subscribe to KOL:', error);
      throw error;
    }
  }

  async unsubscribeFromKOL(userId: string, kolWallet: string): Promise<{message: string, success: boolean, data: {kolWallet: string, userId: string}}> {
    try {
      await this.cacheService.removeSubscription(userId, kolWallet);
      const {data: {subscriptions: kolsSubscriptions}} = await this.cacheService.getSubscriptionsForKOL(kolWallet);
      
      if(kolsSubscriptions.length === 0) {
        await this.removeKOLWalletWebhook(kolWallet);
      }
      return {
        message: "Unsubscribed from KOL successfully",
        success: true,
        data: {
          kolWallet: kolWallet,
          userId: userId
        }
      }
      
    } catch (error) {
      console.error('❌ Failed to unsubscribe from KOL:', error);
      return {
        message: "Failed to unsubscribe from KOL",
        success: false,
        data: {
          kolWallet: kolWallet,
          userId: userId
        }
      }
    }
  }

  /**
   * Handle incoming webhook requests
   */
//   private async handleWebhookRequest(req: Request, res: Response): Promise<void> {
//     try {
//       const webhookData = req.body;
      
//       console.log('🎣 Received webhook data:', JSON.stringify(webhookData, null, 2));

//       // Acknowledge receipt immediately
//       res.status(200).json({ 
//         success: true, 
//         message: 'Webhook received',
//         timestamp: new Date().toISOString()
//       });

//       // Process the webhook data
//       await this.processWebhookData(webhookData);

//     } catch (error) {
//       console.error('❌ Error handling webhook request:', error);
//       res.status(500).json({ 
//         success: false, 
//         error: 'Internal server error',
//         timestamp: new Date().toISOString()
//       });
//     }
//   }

  /**
   * Process webhook data and convert to KOL trades
   */
  async processWebhookData(data: any): Promise<void> {
    try {
      // Handle both single objects and arrays
      const transactions = Array.isArray(data) ? data : [data];

      for (const transaction of transactions) {
        await this.processTransaction(transaction);
      }
    } catch (error) {
      console.error('❌ Error processing webhook data:', error);
    }
  }

  /**
   * Process individual transaction from webhook
   */
  private async processTransaction(transaction: HeliusWebhookData): Promise<void> {
    try {
      // console.log(`🔍 Processing transaction: ${transaction.signature}`);
      // console.log(`📝 Description: ${transaction.description}`);
      // console.log(`🏷️  Type: ${transaction.type}`);
      

      // Check if this is a swap transaction
      if (this.isSwapTransaction(transaction)) {
        console.log(`🔄 Swap transaction detected: ${transaction.signature}`);
        
        // Find which wallet this transaction belongs to
        const walletAddress = await this.findWalletAddress(transaction);
        console.log(`👤 Wallet address: ${walletAddress}`);
        
        if (walletAddress) {
          //console.log(`👤 Transaction belongs to monitored wallet: ${walletAddress}`);
          
          const kolTrade = await this.parseKOLTradeFromWebhook(transaction, walletAddress);
          const {data: {subscriptions}} = await this.cacheService.getSubscriptionsForKOL(walletAddress);

          if (kolTrade) {
            // console.log('✅ KOL Trade parsed from webhook:', {
            //   signature: kolTrade.signature,
            //   wallet: kolTrade.kolWallet,
            //   type: kolTrade.tradeType,
            //   dex: kolTrade.dexProgram
            // });

            //const trades: QueuedTradeParams[] = ko

            //Store the trade in the cache
            await this.cacheService.storeKOLTrade(kolTrade);

            
            // Emit the trade event for other services to handle
            this.emit('kolTrade', kolTrade);
          } else {
            console.log('⚠️ Failed to parse KOL trade from webhook');
          }
          
          if(subscriptions.length > 0) {
          const userSubscriptions = subscriptions.filter((subscription: UserSubscription) => subscription.type === "trade").map((subscription: UserSubscription) => {
            return {
              agentId: subscription.userId,
              tradeType: kolTrade?.tradeType,
              amount: subscription?.minAmount,
              privateKey: subscription?.privateKey,
              mint: kolTrade?.mint, 
              priority: 'high',
              watchConfig: subscription.watchConfig ? subscription.watchConfig : null
            }
          })

            await callRpcServer({
              method: 'performBatchTrades',
              args: {
                trades: userSubscriptions
              }
            })
          }

        } else {
          console.log('⚠️ Could not determine wallet address for transaction');
        }
      } else {
        console.log(`ℹ️ Non-swap transaction: ${transaction.signature}`);
      }
    } catch (error) {
      console.error(`❌ Error processing transaction ${transaction.signature}:`, error);
    }
  }

  /**
   * Check if transaction is a swap based on type and events
   */
  private isSwapTransaction(transaction: HeliusWebhookData): boolean {
    // Check transaction type
    const swapTypes = [
      'SWAP',
      'TOKEN_TRADE',
      'DeFi_SWAP',
      'EXCHANGE'
    ];

    if (swapTypes.some(type => transaction.type?.includes(type))) {
      return true;
    }
    return false;
  }

  /**
   * Find which monitored wallet address this transaction belongs to
   */
  private async findWalletAddress(transaction: HeliusWebhookData): Promise<string | null> {
    // Check in account data
    const {data: {wallets: activeKols}} = await this.cacheService.getWatchedKOLWallets();
    for (const accountInfo of transaction.accountData || []) {
      const address = accountInfo.account;
      if (activeKols.includes(address)) {
        return address;
      }
    }

    // Check in native transfers
    for (const transfer of transaction.nativeTransfers || []) {
      if (activeKols.includes(transfer.fromUserAccount)) {
        return transfer.fromUserAccount;
      }
      if (activeKols.includes(transfer.toUserAccount)) {
        return transfer.toUserAccount;
      }
    }

    // Check in token transfers
    for (const transfer of transaction.tokenTransfers || []) {
      if (activeKols.includes(transfer.fromUserAccount)) {
        return transfer.fromUserAccount;
      }
      if (activeKols.includes(transfer.toUserAccount)) {
        return transfer.toUserAccount;
      }
    }

    // Check fee payer
    if (transaction.feePayer && activeKols.includes(transaction.feePayer)) {
      console.log("👤 Fee payer: ", transaction.feePayer);
      return transaction.feePayer;
    }

    return null;
  }

  /**
   * Parse webhook transaction data into KOLTrade structure
   */
  private async parseKOLTradeFromWebhook(transaction: HeliusWebhookData, walletAddress: string): Promise<KOLTrade | null> {
    try {
      // Extract DEX program from description or source
      const dexProgram = this.identifyDEXFromWebhook(transaction);
      
      // Parse trade details from token transfers
      const { tradeType, tokenIn, tokenOut, amountIn, amountOut, mint } = this.parseTradeDetailsFromWebhook(transaction);
      
      return {
        id: uuidv4(),
        kolWallet: walletAddress,
        signature: transaction.signature,
        timestamp: new Date(transaction.timestamp * 1000), // Convert from Unix timestamp
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
        tradeType,
        mint,
        dexProgram,
        slotNumber: transaction.slot,
        blockTime: transaction.timestamp,
        fee: transaction.fee || 0
      };
    } catch (error) {
      console.error('❌ Failed to parse KOL trade from webhook:', error);
      return null;
    }
  }

  /**
   * Identify DEX program from webhook data
   */
  private identifyDEXFromWebhook(transaction: HeliusWebhookData): string {
    // Check source field first
    if (transaction.source) {
      return transaction.source;
    }

    // Check description for DEX patterns
    const description = transaction.description?.toLowerCase() || '';
    const dexPatterns = {
      'jupiter': 'Jupiter',
      'raydium': 'Raydium', 
      'orca': 'Orca',
      'phoenix': 'Phoenix',
      'meteora': 'Meteora',
      'lifinity': 'Lifinity',
      'magic eden': 'Magic Eden',
      'tensor': 'Tensor'
    };

    for (const [pattern, dex] of Object.entries(dexPatterns)) {
      if (description.includes(pattern)) {
        return dex;
      }
    }

    return 'Unknown DEX';
  }

  /**
   * Parse trade details from webhook token transfers
   */
  private parseTradeDetailsFromWebhook(transaction: HeliusWebhookData): {
    tradeType: 'buy' | 'sell';
    tokenIn: string;
    tokenOut: string;
    amountIn: number;
    amountOut: number;
    mint: string;
  } {
    let tradeType: 'buy' | 'sell'  = 'buy';
    let tokenIn = 'UNKNOWN';
    let tokenOut = 'UNKNOWN';
    let amountIn = 0;
    let amountOut = 0;
    let mint = 'UNKNOWN';
    try {
      // Look at token transfers
      if (transaction.tokenTransfers && transaction.tokenTransfers.length > 0) {
        //const swapInfo = classifySwap([transfers], transaction.feePayer);
        const parsedSwap = parseSwap(transaction, transaction.feePayer);

        //console.log("swapInfo:", swapInfo);
        //console.log("parsedSwap:", parsedSwap);
        if (parsedSwap?.side === 'buy') {
          tokenIn = parsedSwap.tokenMint;
          amountIn = parsedSwap.tokenAmount;
          tokenOut = 'So11111111111111111111111111111111111111112';
          amountOut = parsedSwap.solAmount;
          tradeType = 'buy';
          mint = parsedSwap.tokenMint;
        } else if (parsedSwap?.side === 'sell') {
          tokenIn = 'So11111111111111111111111111111111111111112';
          amountIn = parsedSwap.solAmount;
          tokenOut = parsedSwap.tokenMint;
          amountOut = parsedSwap.tokenAmount;
          tradeType = 'sell';
          mint = parsedSwap.tokenMint;
        }
          
      }

      // Look at native transfers for SOL trades
      // if (transaction.nativeTransfers && transaction.nativeTransfers.length > 0) {
      //   const nativeTransfer = transaction.nativeTransfers[0];
      //   const amount = Math.abs(nativeTransfer.amount || 0) / 1e9; // Convert from lamports to SOL

      //   if (amount > 0) {
      //     // Determine if buying or selling SOL
      //     const solMint = 'So11111111111111111111111111111111111111112';
          
      //     if (tokenIn === 'UNKNOWN' && tokenOut !== 'UNKNOWN') {
      //       tokenIn = solMint;
      //       amountIn = amount;
      //       tradeType = 'buy'; // SOL -> Token
      //     } else if (tokenOut === 'UNKNOWN' && tokenIn !== 'UNKNOWN') {
      //       tokenOut = solMint;
      //       amountOut = amount;
      //       tradeType = 'sell'; // Token -> SOL
      //     }
      //   }
      // }

      // Try to parse from description if amounts are still unknown
      // if (amountIn === 0 && amountOut === 0) {
      //   const description = transaction.description || '';
      //   const amountMatch = description.match(/(\d+(?:\.\d+)?)\s*(SOL|USDC|USDT)/i);
      //   if (amountMatch && amountMatch[1] && amountMatch[2]) {
      //     const amount = parseFloat(amountMatch[1]);
      //     const token = amountMatch[2].toUpperCase();
          
      //     if (token === 'SOL') {
      //       amountIn = amount;
      //       tokenIn = 'So11111111111111111111111111111111111111112';
      //     }
      //   }
      // }
    } catch (error) {
      console.error('❌ Error parsing trade details from webhook:', error);
    }

    return { tradeType, tokenIn, tokenOut, amountIn, amountOut, mint };
  }

  /**
   * Get list of currently monitored wallets
   */
  getMonitoredWallets(): string[] {
    return Array.from(this.webhooks.keys());
  }

    /**
   * Get enhanced transactions for a specific address using Helius Enhanced Transactions API
   * @param address - The wallet address to get transactions for
   * @param params - Optional query parameters for filtering and pagination
   * @returns Promise<GetTransactionsByAddressResponse>
   */
    async getTransactionsByAddress(
      address: string, 
      params: GetTransactionsByAddressParams = {}
    ): Promise<{message: string, data: AddressTransaction}> {
      try {
        // Build the URL
        const baseUrl = `https://api.helius.xyz/v0/addresses/${address}/transactions`;
        
        // Build query parameters
        const queryParams = new URLSearchParams();
        
        // Add API key
        queryParams.append('api-key', config.helius.apiKey);
        
        // Add optional parameters
        if (params.limit !== undefined) {
          queryParams.append('limit', params.limit.toString());
        }
        
        if (params.before) {
          queryParams.append('before', params.before);
        }
        
        if (params.after) {
          queryParams.append('after', params.after);
        }
        
        if (params.commitment) {
          queryParams.append('commitment', params.commitment);
        }
        
        if (params.type && params.type.length > 0) {
          params.type.forEach(type => queryParams.append('type', type));
        }
        
        if (params.source && params.source.length > 0) {
          params.source.forEach(source => queryParams.append('source', source));
        }
        
        if (params.startTime !== undefined) {
          queryParams.append('start-time', params.startTime.toString());
        }
        
        if (params.endTime !== undefined) {
          queryParams.append('end-time', params.endTime.toString());
        }
        
        const url = `${baseUrl}?${queryParams.toString()}`;
        
        //console.log(`🔍 Fetching transactions for address: ${address}`);
        //console.log(`📡 Request URL: ${url.replace(config.helius.apiKey, '[REDACTED]')}`);
        
        // Make the API request
        const response: AxiosResponse<EnhancedTransaction[]> = await axios.get(url, {
          //timeout: 30000, // 30 second timeout
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        });

        //console.log("response:", response);
        
        const transactions = response.data;
        const parsed = transactions.map((tx) => {
          const txData = {
            tokenTransfers: (tx.tokenTransfers || []).map(transfer => ({
              fromTokenAccount: transfer.fromTokenAccount,
              fromUserAccount: transfer.fromUserAccount,
              mint: transfer.mint,
              toTokenAccount: transfer.toTokenAccount,
              toUserAccount: transfer.toUserAccount,
              tokenAmount: transfer.tokenAmount,
              tokenStandard: 'Fungible' as const
            })),
            accountData: (tx.accountData || []).map(acc => ({
              account: acc.account,
              nativeBalanceChange: acc.nativeBalanceChange,
              tokenBalanceChanges: acc.tokenBalanceChanges || []
            }))
          };
          
          const swapData = parseSwap(txData, address);
          return swapData;
        });
        
        //console.log(`✅ Retrieved ${transactions.length} transactions for address: ${address}`);
        
        // Extract pagination info from response headers if available
        let pagination: { before?: string; after?: string; hasMore: boolean } | undefined;
        if (response.headers['x-pagination-before'] || response.headers['x-pagination-after']) {
          pagination = {
            before: response.headers['x-pagination-before'],
            after: response.headers['x-pagination-after'],
            hasMore: response.headers['x-has-more'] === 'true'
          };
        }
        
        const data = {
          transactions: parsed.filter((swap): swap is ParsedSwap => swap !== null),
          ...(pagination && { pagination })
        };
  
        return {
          message: 'Transactions fetched successfully',
          data: data
        }
        
      } catch (error) {
        //console.error(`❌ Failed to fetch transactions for address ${address}:`, error);
        let message = 'Failed to fetch transactions';
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          const statusText = error.response?.statusText;
          const data = error.response?.data;
          
          console.error(`HTTP ${status}: ${statusText}`);
          if (data) {
            console.error('Response data:', data);
          }
  
          // Handle specific error cases
          if (status === 400) {
            message = `Bad request: Invalid parameters for address ${address}`;
          } else if (status === 401) {
            message = 'Unauthorized: Invalid API key';
          } else if (status === 403) {
            message = 'Forbidden: Access denied to Helius API';
          } else if (status === 404) {
            message = `Address not found: ${address}`;
          } else if (status === 429) {
            message = 'Rate limit exceeded: Too many requests to Helius API';
          } else if (status && status >= 500) {
            message = `Helius API server error: ${status} ${statusText}`;
          }
        }
        
        //throw new Error(`Failed to fetch transactions for address ${address}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return {
          message: message,
          data: {
            transactions: [],
            pagination: {
              before: '',
              after: '',
              hasMore: false
            }
          }
        };
      }
    }
  
    /**
     * Get only swap transactions for a KOL wallet (convenience method)
     * @param kolWallet - The KOL wallet address
     * @param params - Optional query parameters
     * @returns Promise<{transactions: ParsedSwap[], pagination?: { before?: string; after?: string; hasMore: boolean }}> with only swap transactions
     */
    async getKOLSwapTransactions(
      kolWallet: string,
      params: Omit<GetTransactionsByAddressParams, 'type'> = {}
    ): Promise<{message: string, data: AddressTransaction}> {
      //console.log(`🔍 Fetching swap transactions for KOL: ${kolWallet}`);
      
      // Add swap-related type filters
      try{const swapParams: GetTransactionsByAddressParams = {
        ...params,
        type: [
          'SWAP','SWAP_EXACT_OUT', 'SWAP_WITH_PRICE_IMPACT', 'TOKEN_TRADE', 'DeFi_SWAP', 'EXCHANGE'
        ]
      };
      
      const result: {message: string, data: AddressTransaction} = await this.getTransactionsByAddress(kolWallet, swapParams);
      
      // Filter for successful swaps (not 'unknown')
      const swapTransactions = result.data.transactions.filter(tx => 
        tx.side === 'buy' || tx.side === 'sell'
      );
      
      //console.log(`✅ Found ${swapTransactions.length} swap transactions out of ${result.data.transactions.length} total for KOL: ${kolWallet}`);
      
      const data = {
        transactions: swapTransactions,
        ...(result.data.pagination && { pagination: result.data.pagination })
      };
  
      return {
        message: result.message,
        data: data
      };
    }catch(e){
      //console.error(`❌ Failed to fetch swap transactions for KOL: ${kolWallet}:`, e);
      return {
        message: 'Failed to fetch swap transactions',
        data: { transactions: [], pagination: { before: '', after: '', hasMore: false } }
      };
    }
    }

  /**
   * Get webhook configuration for a wallet
   */
  getWebhookConfig(walletAddress: string): WebhookConfig | undefined {
    return this.webhooks.get(walletAddress);
  }

  /**
   * Get service health information
   */
  getHealth() {
    return {
      serverRunning: this.isInitialized,
      port: this.port,
      webhooks: this.webhooks.size,
      monitoredWallets: this.getMonitoredWallets(),
      endpoint: `http://localhost:${this.port}${this.webhookEndpoint}`,
      heliusEnvironment: config.helius.environment
    };
  }

  // /**
  //  * Test webhook functionality
  //  */
  // async testWebhook(walletAddress: string): Promise<void> {
  //   const webhookConfig = this.webhooks.get(walletAddress);
  //   if (!webhookConfig) {
  //     throw new Error(`No webhook found for wallet: ${walletAddress}`);
  //   }

  //   try {
  //     // You can trigger a test from Helius dashboard or use their test endpoint
  //     console.log(`🧪 Testing webhook for wallet: ${walletAddress}`);
  //     console.log(`🆔 Webhook ID: ${webhookConfig.webhookId}`);
  //     console.log(`📡 Webhook URL: ${webhookConfig.webhookURL}`);
      
  //     // This would typically be done via Helius dashboard test button
  //     console.log('✅ Test webhook request completed - check Helius dashboard for results');
  //   } catch (error) {
  //     console.error(`❌ Failed to test webhook for ${walletAddress}:`, error);
  //     throw error;
  //   }
  // }
} 