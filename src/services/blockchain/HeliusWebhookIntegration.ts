import { EventEmitter } from 'events';
import { HeliusService } from './HeliusService';
import { HeliusWebhookService } from './HeliusWebhookService';
import { KOLTrade } from '../../types';
import { config } from '../../config';

export interface MonitoringConfig {
  useWebSocket: boolean;
  useWebhooks: boolean;
  webhookServerPort?: number;
  webhookPublicURL?: string;
  webhookID?: string;
  fallbackMode?: 'websocket' | 'webhook';
}

export class HeliusWebhookIntegration extends EventEmitter {
  private webSocketService?: HeliusService;
  private webhookService?: HeliusWebhookService;
  private config: MonitoringConfig;
  private monitoredWallets: Set<string> = new Set();

  constructor(config: MonitoringConfig) {
    super();
    
    this.config = {
      webhookServerPort: 3001,
      fallbackMode: 'websocket',
      ...config
    };

    // Initialize services based on configuration
    // if (this.config.useWebSocket) {
    //   this.webSocketService = new HeliusService();
    //   this.setupWebSocketListeners();
    // }

    if (this.config.useWebhooks) {
      this.webhookService = new HeliusWebhookService(this.config.webhookServerPort);
      this.setupWebhookListeners();
    }

    console.log('🔗 Helius Integration Service initialized with config:', {
      webSocket: this.config.useWebSocket,
      webhooks: this.config.useWebhooks,
      port: this.config.webhookServerPort,
      fallback: this.config.fallbackMode
    });
  }

  /**
   * Setup WebSocket service event listeners
   */
  private setupWebSocketListeners(): void {
    if (!this.webSocketService) return;

    this.webSocketService.on('connected', () => {
      console.log('🔌 WebSocket service connected');
      this.emit('webSocketConnected');
    });

    this.webSocketService.on('kolTrade', (trade: KOLTrade) => {
      console.log('📈 Trade detected via WebSocket:', trade.signature);
      this.emit('kolTrade', { ...trade, source: 'websocket' });
    });

    this.webSocketService.on('maxReconnectAttemptsReached', () => {
      console.error('❌ WebSocket max reconnect attempts reached');
      if (this.config.fallbackMode === 'webhook' && this.config.useWebhooks) {
        console.log('🔄 Switching to webhook-only mode');
        this.emit('fallbackActivated', 'webhook');
      }
    });
  }

  /**
   * Setup Webhook service event listeners
   */
  private setupWebhookListeners(): void {
    if (!this.webhookService) return;

    // this.webhookService.on('serverStarted', () => {
    //   console.log('🚀 Webhook server started');
    //   this.emit('webhookServerStarted');
    // });

    this.webhookService.on('kolTrade', (trade: KOLTrade) => {
      console.log('📈 Trade detected via Webhook:', trade.signature);
      this.emit('kolTrade', { ...trade, source: 'webhook' });
    });

    // this.webhookService.on('serverStopped', () => {
    //   console.log('🛑 Webhook server stopped');
    //   if (this.config.fallbackMode === 'websocket' && this.config.useWebSocket) {
    //     console.log('🔄 Ensuring WebSocket connection is active');
    //     this.emit('fallbackActivated', 'websocket');
    //   }
    // });
  }

  /**
   * Start monitoring services
   */
  async startMonitoring(): Promise<void> {
    console.log('🚀 Starting Helius monitoring services...');

    const promises: Promise<any>[] = [];

    // Start WebSocket service
    if (this.config.useWebSocket && this.webSocketService) {
      promises.push(this.webSocketService.connect().catch(error => {
        console.error('❌ Failed to start WebSocket service:', error);
        if (this.config.fallbackMode === 'webhook' && !this.config.useWebhooks) {
          throw error; // Fail if no fallback available
        }
      }));
    }

    // Start Webhook service
    // if (this.config.useWebhooks && this.webhookService) {
    //   promises.push(this.webhookService.startServer().catch(error => {
    //     console.error('❌ Failed to start Webhook server:', error);
    //     if (this.config.fallbackMode === 'websocket' && !this.config.useWebSocket) {
    //       throw error; // Fail if no fallback available
    //     }
    //   }));
    // }

    await Promise.allSettled(promises);
    
    console.log('✅ Helius monitoring services started');
    this.emit('monitoringStarted');
  }

  /**
   * Stop monitoring services
   */
  async stopMonitoring(): Promise<void> {
    console.log('🛑 Stopping Helius monitoring services...');

    const promises: Promise<any>[] = [];

    if (this.webSocketService) {
      promises.push(this.webSocketService.disconnect());
    }

    // if (this.webhookService) {
    //   promises.push(this.webhookService.stopServer());
    // }

    await Promise.allSettled(promises);
    
    console.log('✅ Helius monitoring services stopped');
    this.emit('monitoringStopped');
  }

  /**
   * Add a KOL wallet to monitoring
   */
  async addKOLWallet(walletAddress: string[]): Promise<void> {
    console.log(`👤 Adding KOL wallet to monitoring: ${walletAddress}`);

    // Add to WebSocket monitoring
    // if (this.config.useWebSocket && this.webSocketService) {
    //   promises.push(
    //     this.webSocketService.subscribeToKOLWallet(walletAddress).catch(error => {
    //       console.error(`❌ Failed to add wallet to WebSocket monitoring: ${error.message}`);
    //     })
    //   );
    // }

    // Add to Webhook monitoring
    if (this.config.useWebhooks && this.webhookService) {
      await this.webhookService.addKolWalletToWebhook(walletAddress);
      //this.monitoredWallets.add(walletAddress);
      console.log(`✅ KOL wallet added to monitoring: ${walletAddress}`);
      this.emit('walletAdded', walletAddress.join(','));
    }
  }

  /**
   * Remove a KOL wallet from monitoring
   */
  async removeKOLWallet(walletAddress: string): Promise<void> {
    console.log(`👤 Removing KOL wallet from monitoring: ${walletAddress}`);

    const promises: Promise<any>[] = [];

    // Remove from WebSocket monitoring
    // if (this.config.useWebSocket && this.webSocketService) {
    //   promises.push(
    //     this.webSocketService.unsubscribeFromKOLWallet(walletAddress).catch(error => {
    //       console.error(`❌ Failed to remove wallet from WebSocket monitoring: ${error.message}`);
    //     })
    //   );
    // }

    // Remove from Webhook monitoring
    if (this.config.useWebhooks && this.webhookService) {
      await this.webhookService.removeKOLWalletWebhook(walletAddress);
      this.monitoredWallets.delete(walletAddress);
      console.log(`✅ KOL wallet removed from monitoring: ${walletAddress}`);
      this.emit('walletRemoved', walletAddress);
    }
  }

  /**
   * Get list of monitored wallets from all services
   */
  getMonitoredWallets(): {
    total: string[];
    webSocket: string[];
    webhook: string[];
  } {
    const webSocketWallets = this.webSocketService?.getMonitoredWallets() || [];
    const webhookWallets = this.webhookService?.getMonitoredWallets() || [];
    
    const allWallets = [...new Set([...webSocketWallets, ...webhookWallets])];

    return {
      total: allWallets,
      webSocket: webSocketWallets,
      webhook: webhookWallets
    };
  }

  /**
   * Get health status of all monitoring services
   */
  getHealthStatus() {
    const webSocketHealth = this.webSocketService?.getHealth() || null;
    const webhookHealth = this.webhookService?.getHealth() || null;

    return {
      integration: {
        enabled: {
          webSocket: this.config.useWebSocket,
          webhooks: this.config.useWebhooks
        },
        monitoredWallets: this.monitoredWallets.size,
        fallbackMode: this.config.fallbackMode
      },
      webSocket: webSocketHealth,
      webhook: webhookHealth,
      overall: {
        healthy: (
          (!this.config.useWebSocket || (webSocketHealth?.connected ?? false)) &&
          (!this.config.useWebhooks || (webhookHealth?.serverRunning ?? false))
        ),
        activeConnections: [
          ...(webSocketHealth?.connected ? ['websocket'] : []),
          ...(webhookHealth?.serverRunning ? ['webhook'] : [])
        ]
      }
    };
  }

  /**
   * Test both monitoring methods with a wallet
   */
  async testMonitoring(walletAddress: string): Promise<{
    webSocket: boolean;
    webhook: boolean;
  }> {
    const results = {
      webSocket: false,
      webhook: false
    };

    // Test WebSocket
    if (this.config.useWebSocket && this.webSocketService) {
      try {
        const wsHealth = this.webSocketService.getHealth();
        results.webSocket = wsHealth.connected;
      } catch (error) {
        console.error('❌ WebSocket test failed:', error);
      }
    }

    // Test Webhook
    if (this.config.useWebhooks && this.webhookService) {
      try {
        await this.webhookService.testWebhook(walletAddress);
        results.webhook = true;
      } catch (error) {
        console.error('❌ Webhook test failed:', error);
      }
    }

    console.log('🧪 Monitoring test results:', results);
    return results;
  }

  /**
   * Sync monitored wallets between services
   */
  async syncWallets(): Promise<void> {
    console.log('🔄 Syncing wallets between monitoring services...');

    const webSocketWallets = this.webSocketService?.getMonitoredWallets() || [];
    const webhookWallets = this.webhookService?.getMonitoredWallets() || [];
    
    // Get all unique wallets
    const allWallets = [...new Set([...webSocketWallets, ...webhookWallets])];
    const unavailable = []
    // Ensure all wallets are monitored by both services
    for (const wallet of allWallets) {
      if (this.config.useWebSocket && this.webSocketService && !webSocketWallets.includes(wallet)) {
        try {
          await this.webSocketService.subscribeToKOLWallet(wallet);
        } catch (error) {
          console.error(`❌ Failed to sync wallet ${wallet} to WebSocket:`, error);
        }
      }
      
      if (this.config.useWebhooks && this.webhookService && !webhookWallets.includes(wallet) && this.config.webhookPublicURL) {
       unavailable.push(wallet)
      }
    }

    if(unavailable.length > 0 && this.config.useWebhooks && this.webhookService){
        await this.webhookService.addKolWalletToWebhook(unavailable);
        console.log(`✅ Wallets added to webhook successfully: ${unavailable}`);
    }
    

    console.log(`✅ Wallet sync completed. Total wallets: ${allWallets.length}`);
  }

  /**
   * Get detailed monitoring statistics
   */
  getMonitoringStats() {
    const wallets = this.getMonitoredWallets();
    const health = this.getHealthStatus();

    return {
      timestamp: new Date().toISOString(),
      wallets,
      health,
      config: this.config,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
  }
} 