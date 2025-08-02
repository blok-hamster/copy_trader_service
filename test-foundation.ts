import { configService } from './src/config';
import { MessageProcessor } from './src/services/messaging/MessageProcessor';
import { CacheService } from './src/services/cache/CacheService';
import { HeliusService } from './src/services/blockchain/HeliusService';

/**
 * Test script to verify foundation services and real-time KOL monitoring
 */
async function testFoundationServices() {
  console.log('🧪 Testing Copy Trading Foundation Services...\n');

  // Test 1: Configuration Service
  console.log('1️⃣ Testing Configuration Service...');
  try {
    console.log('✅ Config loaded successfully:');
    console.log(`  - Environment: ${configService.config.environment}`);
    console.log(`  - Service: ${configService.config.serviceName}`);
    console.log(`  - Helius: ${configService.config.helius.environment}`);
    console.log(`  - RabbitMQ: ${configService.config.messaging.rabbitmqUrl}`);
    console.log(`  - Redis: ${configService.config.cache.redisUrl}\n`);
  } catch (error) {
    console.error('❌ Configuration test failed:', error);
    process.exit(1);
  }

  // Test 2: Cache Service (Redis)
  console.log('2️⃣ Testing Redis Cache Service...');
  const cacheService = new CacheService();
  try {
    await cacheService.connect();
    
    // Test basic operations
    await cacheService.set('test:key', { message: 'Hello Redis!' }, 60);
    const testValue = await cacheService.get('test:key');
    console.log(`✅ Redis test successful:`, testValue);
    
    // Cleanup
    await cacheService.delete('test:key');
    console.log(`✅ Redis cleanup successful\n`);
  } catch (error) {
    console.error('❌ Redis test failed:', error);
    console.log('💡 Make sure Redis is running: docker run -d -p 6379:6379 redis:latest\n');
  }

  // Test 3: Message Processor (RabbitMQ)
  console.log('3️⃣ Testing RabbitMQ Message Processor...');
  const messageProcessor = new MessageProcessor();
  try {
    await messageProcessor.start();
    console.log('✅ RabbitMQ connection successful');
    
    // Test message publishing
    const testMessage = {
      id: 'test-123',
      type: 'test_message',
      payload: { message: 'Hello RabbitMQ!' },
      timestamp: new Date(),
      retryCount: 0,
      priority: 'medium' as const
    };
    
    await messageProcessor.publishMessage(
      configService.config.messaging.exchanges.copyTradeEvents,
      'test.message',
      testMessage
    );
    console.log('✅ Message publishing test successful');
    
    await messageProcessor.stop();
    console.log('✅ RabbitMQ cleanup successful\n');
  } catch (error) {
    console.error('❌ RabbitMQ test failed:', error);
    console.log('💡 Make sure RabbitMQ is running: docker run -d -p 5672:5672 -p 15672:15672 rabbitmq:3-management\n');
  }

  // Test 4: Real-time KOL Transaction Monitoring
  console.log('4️⃣ Testing Real-time KOL Transaction Monitoring...');
  if (configService.config.helius.apiKey && configService.config.helius.apiKey !== '') {
    const heliusService = new HeliusService();
    try {
      await heliusService.connect();
      console.log('✅ Helius connection successful');
      
      // Famous KOL wallet addresses - add your actual KOL address here
      const kolWallets = [
        // Replace with your actual KOL wallet addresses
        'suqh5sHtr8HyJ7q8scBimULPkPpA557prMG47xCHQfK', // Example wallet - REPLACE THIS
        // Add more KOL addresses here:
        'JDd3hy3gQn2V982mi1zqhNqUw1GfV2UL6g76STojCJPN',
        '5B79fMkcFeRTiwm7ehsZsFiKsC7m7n1Bgv9yLxPp9q2X'
        // 'YOUR_KOL_WALLET_ADDRESS_HERE',
        // 'ANOTHER_KOL_WALLET_ADDRESS',
      ];
      
      console.log('\n🎯 Starting real-time monitoring...');
      console.log('📡 Monitoring KOL wallets for swap transactions:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      kolWallets.forEach((wallet, index) => {
        console.log(`${index + 1}. ${wallet}`);
      });
      
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`📊 Total wallets to monitor: ${kolWallets.length}`);
      console.log('');
      
      // Set up real-time event handlers
      heliusService.on('kolTrade', async (trade) => {
        console.log('\n🚨 LIVE KOL TRADE DETECTED! 🚨');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`📊 Signature: ${trade.signature}`);
        console.log(`👤 KOL Wallet: ${trade.kolWallet.slice(0, 8)}...${trade.kolWallet.slice(-8)}`);
        console.log(`🔄 Trade Type: ${trade.tradeType.toUpperCase()}`);
        console.log(`🏪 DEX: ${trade.dexProgram}`);
        console.log(`💰 Token In: ${trade.tokenIn}`);
        console.log(`💰 Token Out: ${trade.tokenOut}`);
        console.log(`📈 Amount In: ${trade.amountIn}`);
        console.log(`📈 Amount Out: ${trade.amountOut}`);
        console.log(`⏰ Timestamp: ${trade.timestamp.toISOString()}`);
        console.log(`💸 Fee: ${trade.fee} lamports`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        // Store trade in cache and show confirmation
        if (cacheService.isReady()) {
          try {
            await cacheService.storeKOLTrade(trade);
            console.log('✅ Trade stored in cache for processing');
            
            // Retrieve and display the saved trade to confirm it's stored correctly
            console.log('\n📦 SAVED TRADE DATA:');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            
            const savedTrades = await cacheService.getRecentKOLTrades(trade.kolWallet, 1);
            if (savedTrades.length > 0) {
              const savedTrade = savedTrades[0];
              if (savedTrade) {
                console.log(`🆔 Trade ID: ${savedTrade.id}`);
                console.log(`👤 KOL Wallet: ${savedTrade.kolWallet}`);
                console.log(`📋 Signature: ${savedTrade.signature}`);
                console.log(`🔄 Type: ${savedTrade.tradeType}`);
                console.log(`🏪 DEX: ${savedTrade.dexProgram}`);
                console.log(`💱 ${savedTrade.tokenIn} → ${savedTrade.tokenOut}`);
                console.log(`📊 Amount: ${savedTrade.amountIn} → ${savedTrade.amountOut}`);
                console.log(`⏰ Saved At: ${new Date(savedTrade.timestamp).toISOString()}`);
                console.log(`💾 Cache Status: SUCCESSFULLY STORED`);
              } else {
                console.log('⚠️  Saved trade data is invalid');
              }
            } else {
              console.log('⚠️  No trades found in cache (may be storage delay)');
            }
            
            // Also show all recent trades for this KOL
            const allRecentTrades = await cacheService.getRecentKOLTrades(trade.kolWallet, 5);
            console.log(`\n📊 Total Recent Trades for ${trade.kolWallet.slice(0, 8)}...${trade.kolWallet.slice(-8)}: ${allRecentTrades.length}`);
            
            if (allRecentTrades.length > 1) {
              console.log('📜 Recent Trade History:');
              allRecentTrades.forEach((t, index) => {
                const timeAgo = Math.round((Date.now() - new Date(t.timestamp).getTime()) / 1000);
                console.log(`  ${index + 1}. ${t.tradeType.toUpperCase()} on ${t.dexProgram} (${timeAgo}s ago) - ${t.signature.slice(0, 8)}...`);
              });
            }
            
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            
          } catch (error) {
            console.error('❌ Failed to store trade in cache:', error);
          }
        } else {
          console.log('⚠️  Cache service not available - trade not stored');
        }
      });

      // Subscribe to KOL wallets
      for (const wallet of kolWallets) {
        try {
          await heliusService.subscribeToKOLWallet(wallet);
          console.log(`✅ Subscribed to: ${wallet.slice(0, 8)}...${wallet.slice(-8)}`);
          
          // Add to cache as watched wallet
          if (cacheService.isReady()) {
            await cacheService.addKOLWallet(wallet);
          }
        } catch (error) {
          console.error(`❌ Failed to subscribe to ${wallet}:`, error);
        }
      }

      const health = heliusService.getHealth();
      console.log('\n✅ Real-time monitoring active:', {
        connected: health.connected,
        subscriptions: health.subscriptions,
        endpoint: health.endpoint,
        commitment: health.commitment
      });
      
      // Show existing cached trades for the monitored wallets
      console.log('\n📦 CHECKING EXISTING CACHED TRADES:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      for (const wallet of kolWallets) {
        try {
          const existingTrades = await cacheService.getRecentKOLTrades(wallet, 10);
          console.log(`💾 ${wallet.slice(0, 8)}...${wallet.slice(-8)}: ${existingTrades.length} cached trades`);
          
          if (existingTrades.length > 0) {
            console.log('   Recent trades:');
            existingTrades.forEach((trade, index) => {
              const timeAgo = Math.round((Date.now() - new Date(trade.timestamp).getTime()) / 1000);
              const timeUnit = timeAgo < 60 ? 's' : timeAgo < 3600 ? 'm' : 'h';
              const displayTime = timeAgo < 60 ? timeAgo : timeAgo < 3600 ? Math.round(timeAgo / 60) : Math.round(timeAgo / 3600);
              console.log(`   ${index + 1}. ${trade.tradeType.toUpperCase()} ${trade.dexProgram} (${displayTime}${timeUnit} ago) ${trade.signature.slice(0, 12)}...`);
            });
          }
        } catch (error) {
          console.log(`⚠️  Failed to check cache for ${wallet.slice(0, 8)}...: ${error}`);
        }
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      console.log('\n👂 Listening for transactions... (Press Ctrl+C to stop)');
      console.log('💡 Try making a swap transaction from one of the monitored wallets to see real-time detection!');
      console.log('🔍 You can also monitor transactions at https://solscan.io or https://solana.fm\n');
      
      // Keep monitoring for 2 minutes or until interrupted
      let countdown = 120; // 2 minutes
      let cacheCheckCounter = 0;
      
      const monitoringInterval = setInterval(async () => {
        process.stdout.write(`\r⏳ Monitoring active... ${countdown}s remaining (Ctrl+C to stop)    `);
        countdown--;
        cacheCheckCounter++;
        
        // Every 30 seconds, show cache status
        if (cacheCheckCounter % 30 === 0 && cacheService.isReady()) {
          console.log('\n\n📊 CACHE STATUS UPDATE:');
          for (const wallet of kolWallets) {
            const trades = await cacheService.getRecentKOLTrades(wallet, 5);
            console.log(`💾 ${wallet.slice(0, 8)}...${wallet.slice(-8)}: ${trades.length} recent trades`);
          }
          console.log('');
        }
        
        if (countdown <= 0) {
          console.log('\n\n⏰ Monitoring period ended');
          
          // Final cache summary
          console.log('\n📊 FINAL CACHE SUMMARY:');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          for (const wallet of kolWallets) {
            try {
              const finalTrades = await cacheService.getRecentKOLTrades(wallet, 10);
              console.log(`💾 ${wallet.slice(0, 8)}...${wallet.slice(-8)}: ${finalTrades.length} total cached trades`);
              
              if (finalTrades.length > 0) {
                console.log('   All cached trades:');
                finalTrades.forEach((trade, index) => {
                  console.log(`   ${index + 1}. [${trade.id.slice(0, 8)}] ${trade.tradeType.toUpperCase()} ${trade.dexProgram} - ${trade.signature.slice(0, 12)}...`);
                });
              }
            } catch (error) {
              console.log(`⚠️  Error reading final cache for ${wallet.slice(0, 8)}...: ${error}`);
            }
          }
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          
          clearInterval(monitoringInterval);
          cleanupAndExit();
        }
      }, 1000);

      // Handle Ctrl+C gracefully
      const cleanupAndExit = async () => {
        clearInterval(monitoringInterval);
        console.log('\n🛑 Stopping real-time monitoring...');
        
        await heliusService.disconnect();
        console.log('✅ Helius service disconnected');
        
        if (cacheService.isReady()) {
          await cacheService.disconnect();
        }
        console.log('✅ Cache service disconnected');
        
        console.log('\n🎉 Real-time monitoring test completed!');
        process.exit(0);
      };

      // Setup interrupt handler
      process.on('SIGINT', cleanupAndExit);
      process.on('SIGTERM', cleanupAndExit);
      
    } catch (error) {
      console.error('❌ Real-time monitoring test failed:', error);
      console.log('💡 Check your HELIUS_API_KEY environment variable\n');
      
      // Continue with integration test if Helius fails
      await runIntegrationTest(cacheService);
    }
  } else {
    console.log('⏭️  Skipping real-time monitoring - no API key provided');
    console.log('💡 Set HELIUS_API_KEY environment variable to test real-time monitoring\n');
    
    // Run basic integration test instead
    await runIntegrationTest(cacheService);
  }
}

/**
 * Run basic integration test when real-time monitoring is not available
 */
async function runIntegrationTest(cacheService: CacheService) {
  console.log('5️⃣ Testing Service Integration...');
  try {
    if (cacheService.isReady()) {
      const testSubscription = {
        id: 'test-sub-123',
        userId: 'user123',
        kolWallet: 'JDd3hy3gQn2V982mi1zqhNqUw1GfV2UL6g76STojCJPN',
        isActive: true,
        copyPercentage: 50,
        privateKey: 'encrypted-key',
        walletAddress: '7wXMao3ZoTm53QhzWiRoR6vMWkGCxJKNSkSPniqJsNZn',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await cacheService.addSubscription(testSubscription);
      const subscriptions = await cacheService.getUserSubscriptions('user123');
      console.log('✅ Subscription management test:', subscriptions.length === 1);

      // Test KOL wallet management
      const kolWallets = await cacheService.getWatchedKOLWallets();
      console.log('✅ KOL wallet management test:', kolWallets.includes('test-kol-wallet'));

      // Cleanup
      await cacheService.removeSubscription('user123', 'test-kol-wallet');
      console.log('✅ Integration cleanup successful');
    }
  } catch (error) {
    console.error('❌ Integration test failed:', error);
  }

  // Final cleanup
  if (cacheService.isReady()) {
    await cacheService.disconnect();
  }

  console.log('🎉 Foundation services testing completed!');
  console.log('📝 Ready to implement business logic layer');
  process.exit(0);
}

// Handle errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// Run tests
testFoundationServices().catch((error) => {
  console.error('Test execution failed:', error);
  process.exit(1);
}); 