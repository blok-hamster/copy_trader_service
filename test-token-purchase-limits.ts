import { TokenPurchaseTracker } from './src/services/cache/TokenPurchaseTracker';
import { CacheService } from './src/services/cache/CacheService';

async function testTokenPurchaseLimits() {
  console.log('🧪 Testing Token Purchase Limits System...\n');
  
  try {
    // Initialize services
    const cacheService = CacheService.getInstance();
    const tracker = TokenPurchaseTracker.getInstance();
    
    // Wait for Redis connection
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Test data
    const testUserId = 'test-user-123';
    const testTokenMint = 'test-token-mint-456';
    const maxPurchases = 3;
    const testSubscriptionId = 'sub-123';
    
    console.log(`👤 Test User: ${testUserId}`);
    console.log(`🪙 Test Token: ${testTokenMint}`);
    console.log(`🔢 Max Purchases: ${maxPurchases}\n`);
    
    // Clean up any existing data
    await tracker.resetPurchaseCount(testUserId, testTokenMint);
    console.log('🧹 Cleaned up existing test data\n');
    
    // Test 1: Initial validation (should allow purchase)
    console.log('=== Test 1: Initial Validation ===');
    const initialValidation = await tracker.canUserPurchaseToken(testUserId, testTokenMint, maxPurchases);
    console.log(`✅ Can purchase: ${initialValidation.canPurchase}`);
    console.log(`📊 Current count: ${initialValidation.currentCount}/${initialValidation.maxCount}`);
    console.log(`🔢 Remaining: ${initialValidation.remainingPurchases}\n`);
    
    // Test 2: Successful purchases up to limit
    console.log('=== Test 2: Successful Purchases ===');
    for (let i = 1; i <= maxPurchases; i++) {
      const result = await tracker.incrementAndValidatePurchase(
        testUserId, 
        testTokenMint, 
        maxPurchases, 
        testSubscriptionId
      );
      
      console.log(`Purchase ${i}: ${result.success ? '✅ Success' : '❌ Failed'} - Count: ${result.newCount}/${maxPurchases}`);
    }
    console.log();
    
    // Test 3: Attempt purchase beyond limit
    console.log('=== Test 3: Purchase Beyond Limit ===');
    const beyondLimitResult = await tracker.incrementAndValidatePurchase(
      testUserId, 
      testTokenMint, 
      maxPurchases, 
      testSubscriptionId
    );
    console.log(`Beyond limit attempt: ${beyondLimitResult.success ? '✅ Success' : '❌ Failed (Expected)'} - Count: ${beyondLimitResult.newCount}/${maxPurchases}`);
    console.log(`Was at limit: ${beyondLimitResult.wasAtLimit}\n`);
    
    // Test 4: Validation after limit reached
    console.log('=== Test 4: Validation After Limit ===');
    const finalValidation = await tracker.canUserPurchaseToken(testUserId, testTokenMint, maxPurchases);
    console.log(`✅ Can purchase: ${finalValidation.canPurchase} (Expected: false)`);
    console.log(`📊 Current count: ${finalValidation.currentCount}/${finalValidation.maxCount}`);
    console.log(`🔢 Remaining: ${finalValidation.remainingPurchases}\n`);
    
    // Test 5: Get purchase record
    console.log('=== Test 5: Purchase Record ===');
    const record = await tracker.getPurchaseRecord(testUserId, testTokenMint);
    if (record) {
      console.log(`📋 Record found:`);
      console.log(`   User ID: ${record.userId}`);
      console.log(`   Token: ${record.tokenMint}`);
      console.log(`   Count: ${record.currentCount}/${record.maxCount}`);
      console.log(`   Last Purchase: ${new Date(record.lastPurchaseTimestamp).toISOString()}`);
      console.log(`   Subscription: ${record.subscriptionId}\n`);
    }
    
    // Test 6: Get user's all token purchases
    console.log('=== Test 6: User Token Purchases ===');
    const userPurchases = await tracker.getUserTokenPurchases(testUserId);
    console.log(`📊 User has ${userPurchases.length} token purchase records:`);
    userPurchases.forEach(purchase => {
      console.log(`   - ${purchase.tokenMint}: ${purchase.currentCount}/${purchase.maxCount}`);
    });
    console.log();
    
    // Test 7: Performance test
    console.log('=== Test 7: Performance Test ===');
    const performanceTestUser = 'perf-test-user';
    const performanceTestToken = 'perf-test-token';
    
    await tracker.resetPurchaseCount(performanceTestUser, performanceTestToken);
    
    const startTime = process.hrtime.bigint();
    const perfValidation = await tracker.canUserPurchaseToken(performanceTestUser, performanceTestToken, 1);
    const endTime = process.hrtime.bigint();
    
    const executionTimeMs = Number(endTime - startTime) / 1_000_000;
    console.log(`⚡ Validation execution time: ${executionTimeMs.toFixed(3)}ms (Target: <1ms)`);
    console.log(`🎯 Performance: ${executionTimeMs < 1 ? '✅ PASSED' : '❌ FAILED'}\n`);
    
    // Test 8: Statistics
    console.log('=== Test 8: System Statistics ===');
    const stats = await tracker.getTokenPurchaseStats();
    console.log(`📈 System Stats:`);
    console.log(`   Total Tokens: ${stats.totalTokens}`);
    console.log(`   Total Users: ${stats.totalUsers}`);
    console.log(`   Active Tokens: ${stats.activeTokens.length}`);
    const topPurchase = stats.topTokensByPurchases.length > 0 ? stats.topTokensByPurchases[0] : null;
    console.log(`   Top Purchases: ${topPurchase ? topPurchase.tokenMint + ' (' + topPurchase.totalPurchases + ')' : 'None'}\n`);
    
    // Clean up
    console.log('🧹 Cleaning up test data...');
    await tracker.resetPurchaseCount(testUserId, testTokenMint);
    await tracker.resetPurchaseCount(performanceTestUser, performanceTestToken);
    
    console.log('✅ All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Run tests
if (require.main === module) {
  testTokenPurchaseLimits();
} 