import { configService } from './config';
import { MessageProcessor } from './services/messaging/MessageProcessor';
import { CacheService } from './services/cache/CacheService';
import { RpcServer } from './services/rpc/Rpc';
//import { HeliusService } from './services/blockchain/HeliusService';
import { 
  KOLTradeDetectedEvent, 
  NotificationEvent, 
  ServiceStatusEvent,
  ServiceMetrics
} from './types';
import { v4 as uuidv4 } from 'uuid';
import express, { Express, Request, response, Response } from 'express';
import cors from 'cors';
import { HeliusWebhookService } from './services/blockchain/HeliusWebhookService';
import {config} from 'dotenv';
import { PredictionResult } from '@inscribable/xg_boost_decision_tree_model';
import { MLService } from './services/ml';
import { getTokenInfo } from './utils/swapClassifier';
import axios, { AxiosError } from 'axios';

config();

const app = express();
 app.use(express.json({ limit: '10mb' }));
 app.use(express.urlencoded({ extended: true }));
 app.use(cors({ origin: '*' , methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']}));

// /**
//  * Main Copy Trading Service Application
//  */
class CopyTradingService {
  private messageProcessor: MessageProcessor;
  private cacheService: CacheService;
  //private heliusService: HeliusService;
  //private heliusWebhookIntegration: HeliusWebhookIntegration;
  private isRunning = false;
  private startTime = Date.now();
  private metrics: ServiceMetrics = {
    connectionsActive: 0,
    subscriptionsActive: 0,
    tradesDetected: 0,
    tradesExecuted: 0,
    errorCount: 0,
    avgProcessingTime: 0,
    uptime: 0,
    queueDepths: {}
  };
  private webhookService: HeliusWebhookService;
  static instance: CopyTradingService;
  isInitialized = false;
  constructor() {
    this.messageProcessor = new MessageProcessor();
    //this.heliusService = new HeliusService();
    this.cacheService = CacheService.getInstance();
    this.webhookService = new HeliusWebhookService(3001, process.env.HELIUS_WEBHOOK_ID || 'b57a3f61-4032-4345-ac02-bd3a750fe2fa');
    // this.heliusWebhookIntegration = new HeliusWebhookIntegration({
    //   useWebSocket: false,        // Enable WebSocket monitoring
    //   useWebhooks: true,  
    //   webhookID: "b57a3f61-4032-4345-ac02-bd3a750fe2fa",       // Enable Webhook monitoring  
    //   webhookServerPort: 3001,   // Port for webhook server
    //   webhookPublicURL: process.env.WEBHOOK_PUBLIC_URL || 'https://ba635eb13773.ngrok-free.app',
    //   fallbackMode: 'webhook'    // Prefer webhook if WebSocket fails
    // });
    this.setupServiceEventHandlers();
    this.setupGracefulShutdown();
  }

  static getInstance(): CopyTradingService {
    if (!CopyTradingService.instance || !CopyTradingService.instance.isInitialized) {
      CopyTradingService.instance = new CopyTradingService();
      CopyTradingService.instance.isInitialized = true;
    }
    return CopyTradingService.instance;
  }

  /**
   * Start the copy trading service
   */
  async start(): Promise<void> {
    console.log(`🚀 Starting ${configService.config.serviceName}...`);
    console.log(`📋 Environment: ${configService.config.environment}`);
    console.log(`🔗 Helius: ${configService.config.helius.environment} (${configService.config.helius.commitment})`);

    try {
      // Phase 1: Start infrastructure services
      console.log('\n📡 Starting infrastructure services...');
      
      await this.cacheService.connect();
      console.log('✅ Cache service connected');
      
      await this.messageProcessor.start();
      console.log('✅ Message processor started');

      // Phase 2: Start blockchain monitoring
        //console.log('\n🔗 Starting blockchain monitoring...');
        // await webhookService.start();
        //console.log('✅ Helius Webhook Integration started');
      // await this.heliusService.connect();
      // console.log('✅ Helius service connected');

      // Phase 3: Load initial subscriptions and start monitoring
      // console.log('\n📋 Loading initial configuration...');
      // await this.loadInitialKOLWallets();

      // Phase 4: Start metrics reporting
      this.startMetricsReporting();

      this.isRunning = true;
      console.log(`\n🎉 ${configService.config.serviceName} started successfully!`);
      
      //await this.publishServiceStatus('online');
      
    } catch (error) {
      console.error('❌ Failed to start copy trading service:', error);
      await this.stop();
      throw error;
    }
  }

  /**
   * Stop the copy trading service
   */
  async stop(): Promise<void> {
    console.log('\n🛑 Stopping copy trading service...');
    this.isRunning = false;

    try {
      // Publish offline status before shutting down
      //await this.publishServiceStatus('offline');
      
      // Stop services in reverse order
      // await this.heliusService.disconnect();
      // console.log('✅ Helius service disconnected');

      await this.messageProcessor.stop();
      console.log('✅ Message processor stopped');

      await this.cacheService.disconnect();
      console.log('✅ Cache service disconnected');

      console.log('✅ Copy trading service stopped successfully');
      
    } catch (error) {
      console.error('Error during shutdown:', error);
    }
  }

  /**
   * Setup event handlers for all services
   */
  private setupServiceEventHandlers(): void {
    
    // Message processor events
    this.messageProcessor.on('started', () => {
      this.metrics.connectionsActive++;
    });
    
    this.messageProcessor.on('stopped', () => {
      this.metrics.connectionsActive--;
    });

   

    this.messageProcessor.on('error', (error) => {
      console.error('Message processor error:', error);
      this.metrics.errorCount++;
    });
  }

  async  processWebhookData(data: any): Promise<void> {
    try{
      const startTime = Date.now();
      const kolWallet = data[0].feePayer;
      const kolTrade = await this.webhookService.parseKOLTradeFromWebhook(data[0], kolWallet!);

      const {data: {subscriptions}} = await this.cacheService.getSubscriptionsForKOL(kolWallet);
      // if (subscriptions.length === 0) {
      //   console.log('⏭️  No subscribers found, skipping notifications but still processing trade');
      //   retur
      // }
      
      await this.webhookService.processWebhookData(data);

      const tokenInfo = await getTokenInfo(kolTrade!.mint!);
      let imageUrl = '';
      // try{
      //   const response: any = await axios.get(tokenInfo.uri!);
      //   if(response.status !== 200){
      //     console.log('🤖 Token metadata not found, skipping');
      //   }
      //   imageUrl = response.data.image || response.data.logoURI;
      // }catch(error: any){
      //   if(error instanceof AxiosError){
      //     console.error('Token metadata not found:', error.response?.data);
      //   }else{  
      //     console.error('Failed to get token metadata:', error.message);
      //   }
      // }
      let prediction: PredictionResult = {probability: 0} as PredictionResult;
      // if(kolWallet === 'suqh5sHtr8HyJ7q8scBimULPkPpA557prMG47xCHQfK'){
      //   const mlService = new MLService();
      //   prediction = await mlService.predict({modelPath: process.cwd() + '/src/services/ml/models/cupsey_ohlcv_model', tokenMint: kolTrade!.mint!, buyTimestamp: new Date(kolTrade!.timestamp).toISOString(), lookbackHours: 1});
      // }
      //console.log('🤖 Prediction:', prediction);

      //Send notifications to affected users  // Create and publish KOL trade detected event
      const tradeDetectedEvent: KOLTradeDetectedEvent = {
        id: uuidv4(),
        type: 'kol_trade_detected',
        payload: {
          trade: {...kolTrade!, name: tokenInfo.name!, symbol: tokenInfo.symbol!, image: imageUrl, metadataUri: tokenInfo.uri!, prediction: prediction},
          affectedSubscriptions: subscriptions,
          estimatedCopyTrades: subscriptions.length
        },
        timestamp: new Date(),
        retryCount: 0,
        priority: 'high'
      };


      //console.log('tradeDetectedEvent:', tradeDetectedEvent);
      //console.log(`📢 Publishing trade detected event for ${subscriptions.length} subscriptions`);
      await this.messageProcessor.publishEvent(
        configService.config.messaging.routingKeys.kolTradeDetected,
        tradeDetectedEvent
      );
      
      for (const subscription of subscriptions) {
        const notification: NotificationEvent = {
          id: uuidv4(),
          type: 'client_notification',
          payload: {
            userId: subscription.userId,
            notificationType: 'trade_detected',
            data: {
              trade: {...kolTrade!, name: tokenInfo.name!, symbol: tokenInfo.symbol!, image: imageUrl, prediction: prediction},
              subscription,
              estimatedCopyAmount: (data.amountIn || 0) * (subscription.copyPercentage / 100) || 0
            }
          },
          timestamp: new Date(),
          retryCount: 0,
          priority: 'high'
        };

        //console.log(`📲 Publishing notification for user: ${subscription.userId}`);
        await this.messageProcessor.publishNotification(notification);
        //console.log(`✅ Notification published for user: ${subscription.userId}`);
      }

      this.metrics.tradesDetected++;
      const processingTime = Date.now() - startTime;
      this.metrics.avgProcessingTime = (this.metrics.avgProcessingTime + processingTime) / 2;
      
      console.log(`✅ KOL trade processed in ${processingTime}ms`);
    }catch(error){
      if(error instanceof AxiosError){
        console.error('Token metadata not found:', error.response?.data);
      }else{  
        console.error('Failed to process webhook data:', error);
      }
    }   
     
  }

  /**
   * Start metrics reporting
   */
  private startMetricsReporting(): void {
    if (!configService.config.monitoring.enableMetrics) {
      return;
    }

    setInterval(async () => {
      try {
        // Update uptime
        this.metrics.uptime = Date.now() - this.startTime;
        
        // Update connection statuses
        this.metrics.connectionsActive = 
          // (this.heliusService.getHealth().connected ? 1 : 0) +
          (this.cacheService.isReady() ? 1 : 0) +
          (this.messageProcessor.isReady() ? 1 : 0);

        //this.metrics.subscriptionsActive = this.heliusService.getMonitoredWallets().length;

        // Store metrics in cache
        await this.cacheService.storeServiceMetrics(this.metrics);

        console.log(`📊 Metrics - Connections: ${this.metrics.connectionsActive}, ` +
          `Subscriptions: ${this.metrics.subscriptionsActive}, ` +
          `Trades: ${this.metrics.tradesDetected}, ` +
          `Errors: ${this.metrics.errorCount}`);
          
      } catch (error) {
        console.error('Failed to publish metrics:', error);
      }
    }, configService.config.monitoring.metricsPublishInterval);
  }

 

  /**
   * Setup graceful shutdown handling
   */
  private setupGracefulShutdown(): void {
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
    
    signals.forEach(signal => {
      process.on(signal, async () => {
        console.log(`\nReceived ${signal}, shutting down gracefully...`);
        await this.stop();
        process.exit(0);
      });
    });

    process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
      this.metrics.errorCount++;
      //await this.publishServiceStatus('degraded');
      // Don't exit immediately in case it's recoverable
      setTimeout(async () => {
        await this.stop();
  process.exit(1);
      }, 5000);
    });

    process.on('unhandledRejection', async (reason) => {
      console.error('Unhandled Rejection:', reason);
      this.metrics.errorCount++;
      //await this.publishServiceStatus('degraded');
      // Don't exit immediately in case it's recoverable
      setTimeout(async () => {
        await this.stop();
        process.exit(1);
      }, 5000);
    });
  }

  /**
   * Get service health information
   */
  public getHealth() {
    return {
      service: configService.config.serviceName,
      running: this.isRunning,
      uptime: this.metrics.uptime,
      environment: configService.config.environment,
      services: {
        //helius: this.heliusService.getHealth(),
        cache: this.cacheService.getHealth(),
        messaging: this.messageProcessor.getMetrics()
      },
      metrics: this.metrics
    };
  }

  /**
   * Get current metrics
   */
  public getMetrics(): ServiceMetrics {
    return { ...this.metrics };
  }
}

// Main execution
async function main() {
  console.log('🎬 Initializing Copy Trading Service...\n');

  const service = CopyTradingService.getInstance();
  const rpcServer = RpcServer.getInstance({
    url: process.env.RABBITMQ_URL || 'amqp://localhost',
    queue: 'copy_trader_rpc_queue',
    prefetch: 1
  });
  await rpcServer.start();
  
  try {
    await service.start();
    
    //Keep the service running
    console.log('👂 Service is running... Press Ctrl+C to stop');
    
    
  } catch (error) {
    console.error('Failed to start service:', error);
    process.exit(1);
  }
}


//Run main function if this file is executed directly
if (require.main === module) {
 
}


app.get('/', (req: Request, res: Response) => {
  res.json({
  status: 'healthy',
  service: 'helius-webhook-service',
  timestamp: new Date().toISOString()
  });
})
 

    // Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    try {
        const service = CopyTradingService.getInstance();
        const health = service.getHealth();
        
        res.json({
            status: 'healthy',
            service: 'helius-webhook-service',
            timestamp: new Date().toISOString(),
            details: health
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            service: 'helius-webhook-service',
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

app.post('/helius-webhook', (req: Request, res: Response) => {
   
    //console.log('🎣 Received webhook data:', JSON.stringify(req.body, null, 2));
    res.status(200).json({ 
        success: true, 
        message: 'Webhook received',
        timestamp: new Date().toISOString()
      });
      
    const service = CopyTradingService.getInstance();
    
    // Call processWebhookData with additional error handling
    service.processWebhookData(req.body).then(() => {
        //console.log('✅ processWebhookData completed successfully');
    }).catch((error) => {
        //console.error('❌ processWebhookData failed:', error);
    });
});


app.listen(3001, () => {
    
    main().catch((error) => {
      console.error('Service startup failed:', error);
      process.exit(1);
    });

    console.log(`🚀 Helius Webhook Server started on port 3001`);
    console.log(`📡 Webhook URL: http://localhost:3001/helius-webhook`);
});
