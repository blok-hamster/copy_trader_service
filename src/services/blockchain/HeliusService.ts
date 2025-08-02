import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import axios, { AxiosResponse } from 'axios';
import { config, configService } from '../../config';
import { KOLTrade, BlockchainConnection } from '../../types';
import { parseSwap, Side } from '../../utils/swapClassifier';

export interface HeliusServiceConfig {
  apiKey: string;
  environment: 'devnet' | 'mainnet';
  commitment?: 'processed' | 'confirmed' | 'finalized';
}

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

export class HeliusService extends EventEmitter {
  private ws: WebSocket | null = null;
  private connection: BlockchainConnection;
  private subscriptions: Map<string, number> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private isShuttingDown = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastPong = Date.now();

  constructor() {
    super();
    
    this.connection = {
      endpoint: configService.getHeliusWebSocketEndpoint(),
      commitment: config.helius.commitment || 'processed',
      isConnected: false,
      subscriptions: new Map()
    };
  }

  /**
   * Connect to Helius Enhanced WebSocket
   */
  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        console.log(`🔌 Connecting to Helius WebSocket: ${config.helius.environment}`);
        console.log(`📡 Endpoint: ${this.connection.endpoint}`);
        
        this.ws = new WebSocket(this.connection.endpoint);
        
        this.ws.onopen = () => {
          console.log('✅ Connected to Helius Enhanced WebSocket');
          this.connection.isConnected = true;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.emit('connected');
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(JSON.parse(event.data.toString()));
        };

        this.ws.onclose = (event) => {
          console.log(`Helius WebSocket closed: ${event.code} - ${event.reason}`);
          this.connection.isConnected = false;
          this.stopHeartbeat();
          
          if (!this.isShuttingDown) {
            this.reconnectWithBackoff();
          }
        };

        this.ws.onerror = (error) => {
          console.error('Helius WebSocket error:', error);
          this.connection.isConnected = false;
          if (!this.connection.isConnected) {
            reject(new Error('Failed to connect to Helius WebSocket'));
          }
        };

        // Set a connection timeout
        setTimeout(() => {
          if (!this.connection.isConnected) {
            this.ws?.close();
            reject(new Error('Helius WebSocket connection timeout'));
          }
        }, 10000); // 10 second timeout

      } catch (error) {
        console.error('Failed to connect to Helius:', error);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from Helius WebSocket
   */
  async disconnect(): Promise<void> {
    console.log('🛑 Disconnecting from Helius...');
    this.isShuttingDown = true;
    
    this.stopHeartbeat();
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    this.ws = null;
    
    this.connection.isConnected = false;
    this.subscriptions.clear();
    this.connection.subscriptions.clear();
    
    console.log('✅ Disconnected from Helius');
  }

  /**
   * Subscribe to monitor a KOL wallet for swap transactions
   */
  async subscribeToKOLWallet(walletAddress: string): Promise<void> {
    if (!this.ws || !this.connection.isConnected) {
      throw new Error('Not connected to Helius');
    }

    console.log(`📡 Subscribing to KOL wallet: ${walletAddress}`);
    console.log(`🎯 Target address: ${walletAddress}`);
    
    const subscribeRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'logsSubscribe',
      params: [
        {
          mentions: [walletAddress] // Monitor all transactions mentioning this wallet
        },
        {
          commitment: this.connection.commitment
        }
      ]
    };

    console.log('📤 Sending subscription request:', JSON.stringify(subscribeRequest, null, 2));
    this.ws.send(JSON.stringify(subscribeRequest));
    
    // Store subscription for reconnection
    const subscriptionId = Date.now();
    this.subscriptions.set(walletAddress, subscriptionId);
    this.connection.subscriptions.set(walletAddress, subscriptionId);
    
    console.log(`✅ Subscribed to KOL wallet: ${walletAddress}`);
    console.log(`📋 Total monitored wallets: ${this.subscriptions.size}`);
    console.log(`📋 All monitored wallets:`, Array.from(this.subscriptions.keys()));
  }

  /**
   * Unsubscribe from monitoring a KOL wallet
   */
  async unsubscribeFromKOLWallet(walletAddress: string): Promise<void> {
    if (!this.ws || !this.connection.isConnected) {
      console.warn('Not connected to Helius - cannot unsubscribe');
      return;
    }

    const subscriptionId = this.subscriptions.get(walletAddress);
    if (!subscriptionId) {
      console.warn(`No subscription found for wallet: ${walletAddress}`);
      return;
    }

    const unsubscribeRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'logsUnsubscribe',
      params: [subscriptionId]
    };

    this.ws.send(JSON.stringify(unsubscribeRequest));
    
    this.subscriptions.delete(walletAddress);
    this.connection.subscriptions.delete(walletAddress);
    
    console.log(`✅ Unsubscribed from KOL wallet: ${walletAddress}`);
  }

  /**
   * Get list of currently monitored KOL wallets
   */
  getMonitoredWallets(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  // /**
  //  * Get enhanced transactions for a specific address using Helius Enhanced Transactions API
  //  * @param address - The wallet address to get transactions for
  //  * @param params - Optional query parameters for filtering and pagination
  //  * @returns Promise<GetTransactionsByAddressResponse>
  //  */
  // async getTransactionsByAddress(
  //   address: string, 
  //   params: GetTransactionsByAddressParams = {}
  // ): Promise<{message: string, data: AddressTransaction}> {
  //   try {
  //     // Build the URL
  //     const baseUrl = `${configService.getHeliusHttpEndpoint()}/v0/addresses/${address}/transactions`;
      
  //     // Build query parameters
  //     const queryParams = new URLSearchParams();
      
  //     // Add API key
  //     queryParams.append('api-key', config.helius.apiKey);
      
  //     // Add optional parameters
  //     if (params.limit !== undefined) {
  //       queryParams.append('limit', params.limit.toString());
  //     }
      
  //     if (params.before) {
  //       queryParams.append('before', params.before);
  //     }
      
  //     if (params.after) {
  //       queryParams.append('after', params.after);
  //     }
      
  //     if (params.commitment) {
  //       queryParams.append('commitment', params.commitment);
  //     }
      
  //     if (params.type && params.type.length > 0) {
  //       params.type.forEach(type => queryParams.append('type', type));
  //     }
      
  //     if (params.source && params.source.length > 0) {
  //       params.source.forEach(source => queryParams.append('source', source));
  //     }
      
  //     if (params.startTime !== undefined) {
  //       queryParams.append('start-time', params.startTime.toString());
  //     }
      
  //     if (params.endTime !== undefined) {
  //       queryParams.append('end-time', params.endTime.toString());
  //     }
      
  //     const url = `${baseUrl}?${queryParams.toString()}`;
      
  //     //console.log(`🔍 Fetching transactions for address: ${address}`);
  //     //console.log(`📡 Request URL: ${url.replace(config.helius.apiKey, '[REDACTED]')}`);
      
  //     // Make the API request
  //     const response: AxiosResponse<EnhancedTransaction[]> = await axios.get(url, {
  //       timeout: 30000, // 30 second timeout
  //       headers: {
  //         'Content-Type': 'application/json',
  //         'Accept': 'application/json'
  //       }
  //     });
      
  //     const transactions = response.data;
  //     const parsed = transactions.map((tx) => {
  //       const txData = {
  //         tokenTransfers: (tx.tokenTransfers || []).map(transfer => ({
  //           fromTokenAccount: transfer.fromTokenAccount,
  //           fromUserAccount: transfer.fromUserAccount,
  //           mint: transfer.mint,
  //           toTokenAccount: transfer.toTokenAccount,
  //           toUserAccount: transfer.toUserAccount,
  //           tokenAmount: transfer.tokenAmount,
  //           tokenStandard: 'Fungible' as const
  //         })),
  //         accountData: (tx.accountData || []).map(acc => ({
  //           account: acc.account,
  //           nativeBalanceChange: acc.nativeBalanceChange,
  //           tokenBalanceChanges: acc.tokenBalanceChanges || []
  //         }))
  //       };
        
  //       const swapData = parseSwap(txData, address);
  //       return swapData;
  //     });
      
  //     //console.log(`✅ Retrieved ${transactions.length} transactions for address: ${address}`);
      
  //     // Extract pagination info from response headers if available
  //     let pagination: { before?: string; after?: string; hasMore: boolean } | undefined;
  //     if (response.headers['x-pagination-before'] || response.headers['x-pagination-after']) {
  //       pagination = {
  //         before: response.headers['x-pagination-before'],
  //         after: response.headers['x-pagination-after'],
  //         hasMore: response.headers['x-has-more'] === 'true'
  //       };
  //     }
      
  //     const data = {
  //       transactions: parsed.filter((swap): swap is ParsedSwap => swap !== null),
  //       ...(pagination && { pagination })
  //     };

  //     return {
  //       message: 'Transactions fetched successfully',
  //       data: data
  //     }
      
  //   } catch (error) {
  //     //console.error(`❌ Failed to fetch transactions for address ${address}:`, error);
  //     let message = 'Failed to fetch transactions';
  //     if (axios.isAxiosError(error)) {
  //       const status = error.response?.status;
  //       const statusText = error.response?.statusText;
  //       const data = error.response?.data;
        
  //       console.error(`HTTP ${status}: ${statusText}`);
  //       if (data) {
  //         console.error('Response data:', data);
  //       }

  //       // Handle specific error cases
  //       if (status === 400) {
  //         message = `Bad request: Invalid parameters for address ${address}`;
  //       } else if (status === 401) {
  //         message = 'Unauthorized: Invalid API key';
  //       } else if (status === 403) {
  //         message = 'Forbidden: Access denied to Helius API';
  //       } else if (status === 404) {
  //         message = `Address not found: ${address}`;
  //       } else if (status === 429) {
  //         message = 'Rate limit exceeded: Too many requests to Helius API';
  //       } else if (status && status >= 500) {
  //         message = `Helius API server error: ${status} ${statusText}`;
  //       }
  //     }
      
  //     //throw new Error(`Failed to fetch transactions for address ${address}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  //     return {
  //       message: message,
  //       data: {
  //         transactions: [],
  //         pagination: {
  //           before: '',
  //           after: '',
  //           hasMore: false
  //         }
  //       }
  //     };
  //   }
  // }

  // /**
  //  * Get only swap transactions for a KOL wallet (convenience method)
  //  * @param kolWallet - The KOL wallet address
  //  * @param params - Optional query parameters
  //  * @returns Promise<{transactions: ParsedSwap[], pagination?: { before?: string; after?: string; hasMore: boolean }}> with only swap transactions
  //  */
  // async getKOLSwapTransactions(
  //   kolWallet: string,
  //   params: Omit<GetTransactionsByAddressParams, 'type'> = {}
  // ): Promise<{message: string, data: AddressTransaction}> {
  //   //console.log(`🔍 Fetching swap transactions for KOL: ${kolWallet}`);
    
  //   // Add swap-related type filters
  //   try{const swapParams: GetTransactionsByAddressParams = {
  //     ...params,
  //     type: [
  //       'SWAP'
  //     ]
  //   };
    
  //   const result: {message: string, data: AddressTransaction} = await this.getTransactionsByAddress(kolWallet, swapParams);
    
  //   // Filter for successful swaps (not 'unknown')
  //   const swapTransactions = result.data.transactions.filter(tx => 
  //     tx.side === 'buy' || tx.side === 'sell'
  //   );
    
  //   //console.log(`✅ Found ${swapTransactions.length} swap transactions out of ${result.data.transactions.length} total for KOL: ${kolWallet}`);
    
  //   const data = {
  //     transactions: swapTransactions,
  //     ...(result.data.pagination && { pagination: result.data.pagination })
  //   };

  //   return {
  //     message: result.message,
  //     data: data
  //   };
  // }catch(e){
  //   //console.error(`❌ Failed to fetch swap transactions for KOL: ${kolWallet}:`, e);
  //   return {
  //     message: 'Failed to fetch swap transactions',
  //     data: { transactions: [], pagination: { before: '', after: '', hasMore: false } }
  //   };
  // }
  // }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: any): void {
    if (data.method === 'logsNotification') {
      console.log('🔍 Received logsNotification for subscription:', data.params.subscription);
      console.log('📋 Currently monitoring wallets:', Array.from(this.subscriptions.keys()));
      this.handleTransactionLogs(data.params);
    } else if (data.result && data.id) {
      console.log(`✅ Subscription confirmed: ${data.result}`);
    } else if (data.method === 'pong') {
      this.lastPong = Date.now();
    } else {
      console.log('📨 Unknown message type:', data);
    }
  }

  /**
   * Handle transaction log notifications
   */
  private handleTransactionLogs(params: any): void {
    const { result, subscription } = params;
    const { signature, logs, err } = result.value;

    console.log(`🔎 Processing transaction ${signature} for subscription ${subscription}`);
    
    // Find which wallet this subscription belongs to
    let walletAddress = 'unknown';
    for (const [wallet, subId] of this.subscriptions.entries()) {
      if (subId === subscription) {
        walletAddress = wallet;
        break;
      }
    }
    
    console.log(`👤 Transaction is for wallet: ${walletAddress}`);

    // Skip failed transactions
    if (err) {
      console.log(`⏭️  Skipping failed transaction: ${signature} for wallet: ${walletAddress}`);
      return;
    }

    // Log all transaction logs for debugging
    console.log('📝 Transaction logs:', logs);

    // Check if this is a swap transaction
    if (this.isSwapTransaction(logs)) {
      console.log(`🔍 Swap transaction detected: ${signature} for wallet: ${walletAddress}`);
      this.processSwapTransaction(signature, logs, walletAddress);
    } else {
      console.log(`ℹ️  Non-swap transaction: ${signature} for wallet: ${walletAddress}`);
    }
  }

  /**
   * Check if transaction logs indicate a swap
   */
  private isSwapTransaction(logs: string[]): boolean {
    const swapPatterns = [
      'Program Jupiter',           // Jupiter aggregator
      'Program Raydium',           // Raydium DEX  
      'Program Orca',              // Orca DEX
      'Program Phoenix',           // Phoenix protocol
      'Program Meteora',           // Meteora
      'Program Lifinity',          // Lifinity
      'invokeSwap',               // Generic swap instruction
      'TokenSwap',                // SPL Token swap
      'Swap:',                    // Common swap log prefix
      'swapBaseIn',               // Raydium specific
      'swapBaseOut',              // Raydium specific
      'swap(',                    // Function call pattern
      'Instruction: Swap',         // Anchor program pattern
      'SellExactIn',
      'BuyExactIn'
    ];

    return logs.some(log => 
      swapPatterns.some(pattern => log.includes(pattern))
    );
  }

  /**
   * Process detected swap transaction
   */
  private async processSwapTransaction(signature: string, logs: string[], walletAddress: string): Promise<void> {
    try {
      console.log(`🔍 Processing swap transaction ${signature} for KOL: ${walletAddress}`);
      
      // Get enhanced transaction details from Helius
      const transaction = await this.getEnhancedTransaction(signature);
      
      if (transaction && this.validateSwapTransaction(transaction)) {
        const kolTrade = this.parseKOLTrade(transaction, logs, walletAddress);
        
        if (kolTrade) {
          console.log('✅ KOL Trade parsed:', {
            signature: kolTrade.signature,
            wallet: kolTrade.kolWallet,
            type: kolTrade.tradeType,
            dex: kolTrade.dexProgram
          });
          
          // Emit the trade event for other services to handle
          this.emit('kolTrade', kolTrade);
        } else {
          console.log('⚠️  Failed to parse KOL trade from transaction');
        }
      } else {
        console.log('⚠️  Transaction validation failed or transaction not found');
      }
    } catch (error) {
      console.error(`Failed to process swap transaction ${signature}:`, error);
    }
  }

  /**
   * Get enhanced transaction details from Helius API
   */
  private async getEnhancedTransaction(signature: string): Promise<any> {
    const url = `${configService.getHeliusHttpEndpoint()}/transactions/${signature}`;
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 404) {
          console.log(`Transaction not found yet: ${signature} (may still be processing)`);
          return null;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error(`Failed to fetch enhanced transaction ${signature}:`, error);
      return null;
    }
  }

  /**
   * Validate if transaction is a legitimate swap
   */
  private validateSwapTransaction(transaction: any): boolean {
    return transaction && 
           transaction.signature && 
           transaction.accountKeys && 
           transaction.accountKeys.length > 0 &&
           transaction.meta &&
           !transaction.meta.err; // Ensure transaction succeeded
  }

  /**
   * Parse transaction into KOLTrade structure
   */
  private parseKOLTrade(transaction: any, logs: string[], walletAddress: string): KOLTrade | null {
    try {
      // Extract DEX program from logs
      const dexProgram = this.identifyDEXProgram(logs);
      
      // Get the main signer (KOL wallet)
      const kolWallet = walletAddress;
      
      // Determine trade direction and amounts (simplified parsing)
      const { tradeType, tokenIn, tokenOut, amountIn, amountOut } = this.parseTradeDetails(transaction, logs);
      
      return {
        id: uuidv4(),
        kolWallet,
        signature: transaction.signature,
        timestamp: new Date(transaction.blockTime ? transaction.blockTime * 1000 : Date.now()),
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
        tradeType,
        dexProgram,
        slotNumber: transaction.slot,
        blockTime: transaction.blockTime,
        fee: this.calculateFee(transaction)
      };
      
    } catch (error) {
      console.error('Failed to parse KOL trade:', error);
      return null;
    }
  }

  /**
   * Identify which DEX was used based on logs
   */
  private identifyDEXProgram(logs: string[]): string {
    const dexPatterns = {
      'Jupiter': 'Program Jupiter',
      'Raydium': 'Program Raydium',
      'Orca': 'Program Orca',
      'Phoenix': 'Program Phoenix',
      'Meteora': 'Program Meteora',
      'Lifinity': 'Program Lifinity',
    };

    for (const [dex, pattern] of Object.entries(dexPatterns)) {
      if (logs.some(log => log.includes(pattern))) {
        return dex;
      }
    }

    return 'Unknown DEX';
  }

  /**
   * Parse trade details from transaction (simplified implementation)
   */
  private parseTradeDetails(transaction: any, logs: string[]): {
    tradeType: 'buy' | 'sell';
    tokenIn: string;
    tokenOut: string;
    amountIn: number;
    amountOut: number;
  } {
    // This is a simplified implementation
    // In production, you'd need more sophisticated parsing based on the specific DEX
    
    // Default values
    let tradeType: 'buy' | 'sell' = 'buy';
    let tokenIn = 'UNKNOWN';
    let tokenOut = 'UNKNOWN';
    let amountIn = 0;
    let amountOut = 0;

    try {
      // Look for token balance changes in transaction meta
      if (transaction.meta && transaction.meta.preTokenBalances && transaction.meta.postTokenBalances) {
        const preBalances = transaction.meta.preTokenBalances;
        const postBalances = transaction.meta.postTokenBalances;
        
        // Find balance changes
        const balanceChanges = this.calculateBalanceChanges(preBalances, postBalances);
        
        if (balanceChanges.length >= 2) {
          // Assume first change is tokenIn, second is tokenOut
          const [tokenInChange, tokenOutChange] = balanceChanges;
          
          tokenIn = tokenInChange.mint;
          tokenOut = tokenOutChange.mint;
          amountIn = Math.abs(tokenInChange.change);
          amountOut = Math.abs(tokenOutChange.change);
          
          // Determine trade type based on SOL involvement
          const solMint = 'So11111111111111111111111111111111111111112'; // Wrapped SOL
          if (tokenIn === solMint || tokenIn === 'SOL') {
            tradeType = 'buy'; // SOL -> Token
          } else if (tokenOut === solMint || tokenOut === 'SOL') {
            tradeType = 'sell'; // Token -> SOL
          }
        }
      }
    } catch (error) {
      console.error('Error parsing trade details:', error);
    }

    return { tradeType, tokenIn, tokenOut, amountIn, amountOut };
  }

  /**
   * Calculate balance changes from pre/post token balances
   */
  private calculateBalanceChanges(preBalances: any[], postBalances: any[]): any[] {
    const changes = [];
    
    // Create maps for easier lookup
    const preMap = new Map(preBalances.map(b => [`${b.accountIndex}_${b.mint}`, b]));
    const postMap = new Map(postBalances.map(b => [`${b.accountIndex}_${b.mint}`, b]));
    
    // Find changes
    for (const [key, postBalance] of postMap) {
      const preBalance = preMap.get(key);
      const preAmount = preBalance ? parseFloat(preBalance.uiTokenAmount.amount) : 0;
      const postAmount = parseFloat(postBalance.uiTokenAmount.amount);
      const change = postAmount - preAmount;
      
      if (change !== 0) {
        changes.push({
          mint: postBalance.mint,
          change,
          preAmount,
          postAmount,
          accountIndex: postBalance.accountIndex
        });
      }
    }
    
    return changes.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)); // Sort by magnitude
  }

  /**
   * Calculate transaction fee
   */
  private calculateFee(transaction: any): number {
    try {
      return transaction.meta?.fee || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          jsonrpc: '2.0',
          method: 'ping',
          id: Date.now()
        }));
        
        // Check if we received a pong recently
        const timeSinceLastPong = Date.now() - this.lastPong;
        if (timeSinceLastPong > 30000) { // 30 seconds timeout
          console.warn('No pong received, connection may be stale');
          this.ws?.close();
        }
      }
    }, 10000); // Ping every 10 seconds
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Reconnect with exponential backoff
   */
  private reconnectWithBackoff(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max Helius reconnection attempts reached');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`🔄 Reconnecting to Helius in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(async () => {
      try {
        await this.connect();
        await this.restoreSubscriptions();
        console.log('✅ Reconnected to Helius');
        this.emit('reconnected');
      } catch (error) {
        console.error('Helius reconnection failed:', error);
        this.reconnectWithBackoff();
      }
    }, delay);
  }

  /**
   * Restore subscriptions after reconnection
   */
  private async restoreSubscriptions(): Promise<void> {
    console.log('🔄 Restoring KOL wallet subscriptions...');
    
    const wallets = Array.from(this.subscriptions.keys());
    this.subscriptions.clear();
    
    for (const wallet of wallets) {
      try {
        await this.subscribeToKOLWallet(wallet);
      } catch (error) {
        console.error(`Failed to restore subscription for ${wallet}:`, error);
      }
    }
    
    console.log(`✅ Restored ${wallets.length} KOL wallet subscriptions`);
  }

  /**
   * Get connection status
   */
  public getConnectionStatus(): BlockchainConnection {
    return { ...this.connection };
  }

  /**
   * Get service health
   */
  public getHealth() {
    return {
      connected: this.connection.isConnected,
      subscriptions: this.subscriptions.size,
      endpoint: config.helius.environment,
      commitment: this.connection.commitment,
      reconnectAttempts: this.reconnectAttempts
    };
  }
} 