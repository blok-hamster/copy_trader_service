import { SolanaTrackerClient } from './solanaTrackerClient';
import { SolanaTrackerOHLCVExtractor } from './solana-tracker-ohlcv';
import { OHLCVCandle as SolanaTrackerCandle, ChartDataOptions } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import {
  OHLCVCandle,
  OHLCVFeatures,
  VolatilityMetrics,
  PriceMomentumMetrics,
  VolumeProfile,
} from '../types/ohlcv-features';


/**
 * OHLCV Feature Extractor for Solana tokens
 * Extracts historical OHLCV data from Solana Tracker and calculates volatility and momentum features
 */
export class OHLCVFeatureExtractor {
  private client: SolanaTrackerClient;
  private extractor: SolanaTrackerOHLCVExtractor;
  
  // Constants
  private static readonly WSOL_MINT = 'So11111111111111111111111111111111111111112';
  private static readonly MAX_LOOKBACK_HOURS = 24;
  
  constructor() {
    this.client = new SolanaTrackerClient();
    this.extractor = new SolanaTrackerOHLCVExtractor(this.client);
  }
  
  /**
   * Extract OHLCV features for a token at a specific buy timestamp
   */
  async extractOHLCVFeatures(
    tokenMint: string,
    buyTimestamp: string,
    quoteMint: string = OHLCVFeatureExtractor.WSOL_MINT,
    lookbackHours: number = 1,
    label?: string
  ): Promise<OHLCVFeatures> {
    // Parse the buy timestamp
    const buyTime = new Date(buyTimestamp);
    
    // Calculate the start time (going backwards from buy time)
    const startTime = new Date(buyTime.getTime() - (lookbackHours * 60 * 60 * 1000));
    
    // Validate timestamps
    if (isNaN(buyTime.getTime()) || isNaN(startTime.getTime())) {
      throw new Error(`Invalid timestamp format: ${buyTimestamp}`);
    }
    
    // Ensure we're not trying to get future data
    const now = new Date();
    if (buyTime > now) {
      //console.warn(`Buy timestamp ${buyTimestamp} is in the future, using current time instead`);
      buyTime.setTime(now.getTime());
      startTime.setTime(now.getTime() - (lookbackHours * 60 * 60 * 1000));
    }
    
    // console.log(`🔍 Extracting OHLCV features for ${tokenMint}:`);
    // console.log(`   📅 Buy Time: ${buyTime.toISOString()} (${buyTime.toLocaleString()})`);
    // console.log(`   📅 Start Time: ${startTime.toISOString()} (${startTime.toLocaleString()})`);
    // console.log(`   ⏰ Lookback Period: ${lookbackHours} hours`);
    // console.log(`   🎯 Time Range: ${startTime.toISOString()} → ${buyTime.toISOString()}`);
    // if (label) {
    //   console.log(`   🏷️  Performance Label: ${label}`);
    // }
    
    try {
      // Common options for both price and market cap data
      const baseOptions: ChartDataOptions = {
        type: '1m', // 1-minute candles for detailed analysis
        time_from: Math.floor(startTime.getTime() / 1000),
        time_to: Math.floor(buyTime.getTime() / 1000),
        removeOutliers: false
      };
      
      // Extract price data
      //console.log(`   📊 Extracting price OHLCV data...`);
      const priceOptions = { ...baseOptions };
      const rawPriceCandles = await this.extractor.extractTokenOHLCV(
        tokenMint,
        priceOptions,
        undefined // Don't save to files, just return data
      );
      
      // Extract market cap data
      //console.log(`   📊 Extracting market cap OHLCV data...`);
      const marketCapOptions = { ...baseOptions, marketCap: true };
      const rawMarketCapCandles = await this.extractor.extractTokenOHLCV(
        tokenMint,
        marketCapOptions,
        undefined // Don't save to files, just return data
      );
      
    //   console.log(`   ✅ Price candles received: ${rawPriceCandles.length}`);
    //   console.log(`   ✅ Market cap candles received: ${rawMarketCapCandles.length}`);
      
      if (!rawPriceCandles || rawPriceCandles.length === 0) {
        // console.warn(`   ❌ No price OHLCV data found for ${tokenMint} in the specified time range`);
        // console.warn(`   📊 This could mean the token had no trading activity during this period`);
        return this.createFallbackFeatures(tokenMint, quoteMint, buyTimestamp, label);
      }
      
      // Convert Solana Tracker candles to our internal format
      const priceCandles = this.convertPriceCandles(rawPriceCandles);
      
      const marketCapCandles = this.convertMarketCapCandles(rawMarketCapCandles);
      
      // Sort candles by timestamp (ascending - earliest first)
      priceCandles.sort((a, b) => a.timeUnix - b.timeUnix);
      marketCapCandles.sort((a, b) => a.timeUnix - b.timeUnix);
      
      // Log the data we received
    //   console.log(`   ✅ Price candles processed: ${priceCandles.length}`);
    //   console.log(`   ✅ Market cap candles processed: ${marketCapCandles.length}`);
      
      // Validate that candles are within the expected time range
    //   if (priceCandles.length > 0) {
    //     const firstCandle = priceCandles[0];
    //     const lastCandle = priceCandles[priceCandles.length - 1];
        
    //     // if (firstCandle && lastCandle) {      
    //     //   // Verify the time range is correct (data should be before or at buy time)
    //     //   //const lastCandleTime = new Date(lastCandle.timestamp);
    //     // //   if (lastCandleTime > buyTime) {
    //     // //     console.warn(`   ⚠️  Warning: Last candle (${lastCandle.timestamp}) is after buy time (${buyTime.toISOString()})`);
    //     // //   } else {
    //     // //     console.log(`   ✅ Time range validation passed: all data is before buy time`);
    //     // //   }
    //     // }
    //   }
      
      // Calculate features from price data
      //console.log(`   🔧 Calculating price-based features...`);
      const volatility = this.calculateVolatilityMetrics(priceCandles);
      const momentum = this.calculatePriceMomentumMetrics(priceCandles);
      const volumeProfile = this.calculateVolumeProfile(priceCandles);
      
      // Calculate features from market cap data
      //console.log(`   🔧 Calculating market cap-based features...`);
      const marketCapVolatility = this.calculateVolatilityMetrics(marketCapCandles);
      const marketCapMomentum = this.calculatePriceMomentumMetrics(marketCapCandles);
      
      // Calculate summary metrics
      const summary = this.calculateSummaryMetrics(priceCandles, buyTime);
      const marketCapSummary = this.calculateMarketCapSummaryMetrics(marketCapCandles, buyTime);
      
      //console.log(`   ✅ Feature extraction completed successfully`);
      
      return {
        tokenMint,
        quoteMint,
        buyTimestamp,
        dataStartTime: startTime.toISOString(),
        dataEndTime: buyTime.toISOString(),
        ...(label && { label }), // Include the performance label only if it exists
        
        // Price OHLCV data and metrics
        candleCount: priceCandles.length,
        candles: priceCandles, // Raw price OHLCV candles array
        volatility,
        momentum,
        volumeProfile,
        summary,
        
        // Market cap OHLCV data and metrics
        marketCapCandles, // Raw market cap OHLCV candles array
        marketCapCandleCount: marketCapCandles.length,
        marketCapVolatility,
        marketCapMomentum,
        marketCapSummary,
      };
      
    } catch (error) {
      console.error(`❌ Error extracting OHLCV features for ${tokenMint}:`, error);
      throw error;
    }
  }
  
  /**
   * Extract OHLCV features for multiple tokens in batch
   */
  async extractBatchOHLCVFeatures(
    tokenPurchases: Array<{
      tokenMint: string;
      buyTimestamp: string;
      quoteMint?: string;
      label?: string;
    }>,
    lookbackHours: number = 24,
    options?: {
      chunkSize?: number;
      jsonFilePath?: string;
      csvFilePath?: string;
      traderName?: string;
    }
  ): Promise<OHLCVFeatures[]> {
    const results: OHLCVFeatures[] = [];
    const chunkSize = options?.chunkSize || 5;
    const totalChunks = Math.ceil(tokenPurchases.length / chunkSize);
    
    console.log(`🚀 Starting batch OHLCV extraction for ${tokenPurchases.length} token purchases`);
    console.log(`📊 Processing in ${totalChunks} chunks of ${chunkSize} tokens each`);
    if (options?.traderName) {
      console.log(`👤 Trader: ${options.traderName}`);
    }
    if (options?.jsonFilePath) {
      console.log(`💾 JSON results will be saved to: ${options.jsonFilePath}`);
    }
    if (options?.csvFilePath) {
      console.log(`📄 CSV results will be saved to: ${options.csvFilePath}`);
    }
    
    // Process in chunks to avoid rate limiting
    for (let i = 0; i < tokenPurchases.length; i += chunkSize) {
      const chunk = tokenPurchases.slice(i, i + chunkSize);
      const currentChunk = Math.floor(i / chunkSize) + 1;
      
      console.log(`\n🔄 Processing chunk ${currentChunk}/${totalChunks} (${chunk.length} tokens)`);
      console.log(`   📊 Progress: ${Math.round((i / tokenPurchases.length) * 100)}% complete`);
      
      const chunkResults = await Promise.allSettled(
        chunk.map(purchase =>
          this.extractOHLCVFeatures(
            purchase.tokenMint,
            purchase.buyTimestamp,
            purchase.quoteMint,
            lookbackHours,
            purchase.label
          )
        )
      );
      
      let chunkSuccessCount = 0;
      let chunkFailureCount = 0;
      
      chunkResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
          chunkSuccessCount++;
        } else {
          const tokenInfo = chunk[index];
          if (tokenInfo) {
            console.error(`   ❌ Failed to extract OHLCV for ${tokenInfo.tokenMint}:`, result.reason);
            chunkFailureCount++;
          }
        }
      });
      
      console.log(`   ✅ Chunk ${currentChunk} completed: ${chunkSuccessCount} success, ${chunkFailureCount} failed`);
      console.log(`   📊 Total accumulated results: ${results.length}/${tokenPurchases.length}`);
      
      // Small delay between chunks
      if (i + chunkSize < tokenPurchases.length) {
        console.log(`   ⏳ Waiting 1 second before next chunk...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`\n✅ Batch extraction completed!`);
    console.log(`📊 Final Results Summary:`);
    console.log(`   - Total tokens processed: ${tokenPurchases.length}`);
    console.log(`   - Successful extractions: ${results.length}`);
    console.log(`   - Failed extractions: ${tokenPurchases.length - results.length}`);
    console.log(`   - Success rate: ${Math.round((results.length / tokenPurchases.length) * 100)}%`);
    
    // Save results to files if paths are provided
    if (options?.jsonFilePath && results.length > 0) {
      console.log(`\n💾 Saving ${results.length} results to JSON file...`);
      await this.saveToJSON(results, options.jsonFilePath);
    }
    
    if (options?.csvFilePath && results.length > 0) {
      console.log(`📄 Saving ${results.length} results to CSV file...`);
      await this.saveToCSV(results, options.csvFilePath);
    }
    
    if (results.length === 0) {
      console.warn(`⚠️  No results to save - all extractions failed!`);
    }
    
    return results;
  }
  
  /**
   * Convert Solana Tracker candles to our internal format
   */
  private convertPriceCandles(rawCandles: SolanaTrackerCandle[]): OHLCVCandle[] {
    return rawCandles.map(candle => {
      const open = candle.open;
      const high = candle.high;
      const low = candle.low;
      const close = candle.close;
      
      // Calculate average price from OHLC
      const avgPrice = (open + high + low + close) / 4;
      
      // Convert Unix timestamp to ISO string
      const timestamp = new Date(candle.time * 1000).toISOString();
      const timeUnix = candle.time * 1000;
      
      return {
        timestamp,
        timeUnix,
        open,
        high,
        low,
        close,
        volume: candle.volume,
        volumeUSD: candle.volume * close, // Estimate USD volume using close price
        tradeCount: 1, // Default since Solana Tracker doesn't provide this
        buyers: 0, // Default since Solana Tracker doesn't provide this
        sellers: 0, // Default since Solana Tracker doesn't provide this
        buyVolume: candle.volume * 0.5, // Estimate 50% buy volume
        sellVolume: candle.volume * 0.5, // Estimate 50% sell volume
        buyVolumeUSD: (candle.volume * close) * 0.5, // Estimate USD buy volume
        sellVolumeUSD: (candle.volume * close) * 0.5, // Estimate USD sell volume
        avgPrice,
      };
    });
  }

  private convertMarketCapCandles(rawCandles: SolanaTrackerCandle[]): OHLCVCandle[] {
    return rawCandles.map(candle => {
      const open = candle.open;
      const high = candle.high;
      const low = candle.low;
      const close = candle.close;
     
      
      // Convert Unix timestamp to ISO string
      const timestamp = new Date(candle.time * 1000).toISOString();
      const timeUnix = candle.time * 1000;
      
      return {
        timestamp,
        timeUnix,
        open,
        high,
        low,
        close,
        volume: candle.volume,
        volumeUSD: candle.volume * close, // Estimate USD volume using close price
        tradeCount: 1, // Default since Solana Tracker doesn't provide this
        buyers: 0, // Default since Solana Tracker doesn't provide this
        sellers: 0, // Default since Solana Tracker doesn't provide this
        buyVolume: candle.volume * 0.5, // Estimate 50% buy volume
        sellVolume: candle.volume * 0.5, // Estimate 50% sell volume
        buyVolumeUSD: (candle.volume * close) * 0.5, // Estimate USD buy volume
        sellVolumeUSD: (candle.volume * close) * 0.5, // Estimate USD sell volume
        avgPrice: close, // Market cap is just the close price
      };
    });
  }
  
  /**
   * Calculate volatility metrics from OHLCV data
   */
  private calculateVolatilityMetrics(candles: OHLCVCandle[]): VolatilityMetrics {
    if (candles.length === 0) {
      return this.getDefaultVolatilityMetrics();
    }
    
    const prices = candles.map(c => c.close).filter(p => p > 0);
    const highs = candles.map(c => c.high).filter(p => p > 0);
    const lows = candles.map(c => c.low).filter(p => p > 0);
    
    // Calculate time-based volatility
    const volatility1h = this.calculateVolatility(prices.slice(-60)); // Last 60 minutes
    const volatility4h = this.calculateVolatility(prices.slice(-240)); // Last 4 hours
    const volatility24h = this.calculateVolatility(prices); // All available data
    
    // Calculate ATR
    const atr1h = this.calculateATR(candles.slice(-60));
    const atr4h = this.calculateATR(candles.slice(-240));
    const atr24h = this.calculateATR(candles);
    
    // Calculate price ranges
    const priceRange1h = this.calculatePriceRange(highs.slice(-60), lows.slice(-60));
    const priceRange4h = this.calculatePriceRange(highs.slice(-240), lows.slice(-240));
    const priceRange24h = this.calculatePriceRange(highs, lows);
    
    const currentPrice = prices[prices.length - 1] || 0;
    const priceRangePercent1h = currentPrice > 0 ? (priceRange1h / currentPrice) * 100 : 0;
    const priceRangePercent4h = currentPrice > 0 ? (priceRange4h / currentPrice) * 100 : 0;
    const priceRangePercent24h = currentPrice > 0 ? (priceRange24h / currentPrice) * 100 : 0;
    
    // Detect volatility spikes (above 2 standard deviations)
    const volatilitySpike1h = volatility1h > (volatility24h * 2);
    const volatilitySpike4h = volatility4h > (volatility24h * 1.5);
    const volatilitySpike24h = volatility24h > 0.1; // 10% daily volatility threshold
    
    // Calculate price stability score (inverse of volatility)
    const priceStabilityScore = Math.max(0, 1 - volatility24h);
    
    return {
      priceVolatility1h: volatility1h,
      priceVolatility4h: volatility4h,
      priceVolatility24h: volatility24h,
      atr1h,
      atr4h,
      atr24h,
      priceRange1h,
      priceRange4h,
      priceRange24h,
      priceRangePercent1h,
      priceRangePercent4h,
      priceRangePercent24h,
      volatilitySpike1h,
      volatilitySpike4h,
      volatilitySpike24h,
      priceStabilityScore,
    };
  }
  
  /**
   * Calculate price momentum metrics
   */
  private calculatePriceMomentumMetrics(candles: OHLCVCandle[]): PriceMomentumMetrics {
    if (candles.length === 0) {
      return this.getDefaultMomentumMetrics();
    }
    
    const prices = candles.map(c => c.close).filter(p => p > 0);
    const currentPrice = prices[prices.length - 1] || 0;
    
    // Calculate price changes
    const priceChange1h = this.calculatePriceChange(prices, 60);
    const priceChange4h = this.calculatePriceChange(prices, 240);
    const priceChange24h = this.calculatePriceChange(prices, 1440);
    
    // Calculate moving averages
    const sma5 = this.calculateSMA(prices, 5);
    const sma10 = this.calculateSMA(prices, 10);
    const sma20 = this.calculateSMA(prices, 20);
    const sma50 = this.calculateSMA(prices, 50);
    
    // Calculate exponential moving averages
    const ema5 = this.calculateEMA(prices, 5);
    const ema10 = this.calculateEMA(prices, 10);
    const ema20 = this.calculateEMA(prices, 20);
    const ema50 = this.calculateEMA(prices, 50);
    
    // Calculate technical indicators
    const rsi = this.calculateRSI(prices, 14);
    const { macd, macdSignal, macdHistogram } = this.calculateMACD(prices);
    
    // Calculate Bollinger Bands
    const { upper: bollingerUpper, lower: bollingerLower, position: bollingerPosition } = 
      this.calculateBollingerBands(prices, 20, 2);
    
    // Calculate momentum indicators
    const momentumScore = this.calculateMomentumScore(priceChange1h, priceChange4h, priceChange24h, rsi);
    const trendStrength = this.calculateTrendStrength(prices, sma20);
    const momentumDirection = this.determineMomentumDirection(priceChange1h, priceChange4h, rsi);
    
    return {
      priceChange1h: priceChange1h.absolute,
      priceChange4h: priceChange4h.absolute,
      priceChange24h: priceChange24h.absolute,
      priceChangePercent1h: priceChange1h.percent,
      priceChangePercent4h: priceChange4h.percent,
      priceChangePercent24h: priceChange24h.percent,
      sma5,
      sma10,
      sma20,
      sma50,
      ema5,
      ema10,
      ema20,
      ema50,
      rsi,
      macd,
      macdSignal,
      macdHistogram,
      bollingerUpper,
      bollingerLower,
      bollingerPosition,
      momentumScore,
      trendStrength,
      momentumDirection,
    };
  }
  
  /**
   * Calculate volume profile metrics
   */
  private calculateVolumeProfile(candles: OHLCVCandle[]): VolumeProfile {
    if (candles.length === 0) {
      return this.getDefaultVolumeProfile();
    }
    
    // Calculate buy volume ratios
    const buyVolumeRatio1h = this.calculateBuyVolumeRatio(candles.slice(-60));
    const buyVolumeRatio4h = this.calculateBuyVolumeRatio(candles.slice(-240));
    const buyVolumeRatio24h = this.calculateBuyVolumeRatio(candles);
    
    // Calculate volume trends
    const volumes = candles.map(c => c.volumeUSD);
    const volumeTrend1h = this.calculateTrend(volumes.slice(-60));
    const volumeTrend4h = this.calculateTrend(volumes.slice(-240));
    const volumeTrend24h = this.calculateTrend(volumes);
    
    // Calculate volume moving averages
    const volumeMA5 = this.calculateSMA(volumes, 5);
    const volumeMA10 = this.calculateSMA(volumes, 10);
    const volumeMA20 = this.calculateSMA(volumes, 20);
    
    // Detect volume spikes
    const avgVolume = volumeMA20;
    const currentVolume = volumes[volumes.length - 1] || 0;
    const volumeSpike1h = currentVolume > (avgVolume * 2);
    const volumeSpike4h = this.hasVolumeSpike(volumes.slice(-240), avgVolume);
    const volumeSpike24h = this.hasVolumeSpike(volumes, avgVolume);
    
    // Calculate volume-price correlation
    const prices = candles.map(c => c.close);
    const volumePriceCorrelation = this.calculateCorrelation(volumes, prices);
    
    // Calculate buy pressure
    const buyPressure = this.calculateBuyPressure(candles);
    
    return {
      buyVolumeRatio1h,
      buyVolumeRatio4h,
      buyVolumeRatio24h,
      volumeTrend1h,
      volumeTrend4h,
      volumeTrend24h,
      volumeSpike1h,
      volumeSpike4h,
      volumeSpike24h,
      volumeMA5,
      volumeMA10,
      volumeMA20,
      volumePriceCorrelation,
      buyPressure,
    };
  }
  
  /**
   * Calculate summary metrics
   */
  private calculateSummaryMetrics(candles: OHLCVCandle[], buyTime: Date) {
    if (candles.length === 0) {
      return {
        avgPrice: 0,
        totalVolume: 0,
        totalVolumeUSD: 0,
        totalTrades: 0,
        avgTradesPerMinute: 0,
        priceAtBuy: 0,
      };
    }
    
    const prices = candles.map(c => c.close).filter(p => p > 0);
    const avgPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const totalVolume = candles.reduce((sum, candle) => sum + candle.volume, 0);
    const totalVolumeUSD = candles.reduce((sum, candle) => sum + candle.volumeUSD, 0);
    const totalTrades = candles.reduce((sum, candle) => sum + candle.tradeCount, 0);
    const avgTradesPerMinute = totalTrades / candles.length;
    
    // Find price closest to buy time
    const priceAtBuy = this.findPriceAtTime(candles, buyTime);
    
    return {
      avgPrice,
      totalVolume,
      totalVolumeUSD,
      totalTrades,
      avgTradesPerMinute,
      priceAtBuy,
    };
  }

  /**
   * Calculate summary metrics for market cap data
   */
  private calculateMarketCapSummaryMetrics(candles: OHLCVCandle[], buyTime: Date) {
    if (candles.length === 0) {
      return {
        avgMarketCap: 0,
        marketCapAtBuy: 0,
        lastAvailableMarketCap: 0,
        marketCapVolatility24h: 0,
        marketCapChange24h: 0,
        marketCapChangePercent24h: 0,
      };
    }

    const marketCaps = candles.map(c => c.close).filter(mc => mc > 0);
    const avgMarketCap = marketCaps.reduce((sum, mc) => sum + mc, 0) / marketCaps.length;
    
    // Find market cap closest to buy time (most accurate)
    const marketCapAtBuy = this.findPriceAtTime(candles, buyTime);
    
    // Get last available market cap as fallback
    const lastAvailableMarketCap = marketCaps.length > 0 ? marketCaps[marketCaps.length - 1]! : 0;
    
    // Calculate market cap volatility
    const marketCapVolatility24h = this.calculateVolatility(marketCaps);
    
    // Calculate market cap change
    const marketCapChange24h = marketCaps.length > 1 ? 
      marketCaps[marketCaps.length - 1]! - marketCaps[0]! : 0;
    const marketCapChangePercent24h = marketCaps.length > 1 && marketCaps[0]! > 0 ? 
      (marketCapChange24h / marketCaps[0]!) * 100 : 0;

    // Log the market cap at buy time for clarity
    // if (marketCapAtBuy > 0) {
    //   console.log(`   💰 Market Cap at Buy Time: $${marketCapAtBuy.toFixed(2)} (${this.formatLargeNumber(marketCapAtBuy)})`);
    // }

    return {
      avgMarketCap,
      marketCapAtBuy,
      lastAvailableMarketCap,
      marketCapVolatility24h,
      marketCapChange24h,
      marketCapChangePercent24h,
    };
  }
  
  // Helper calculation methods
  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;
    
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const current = prices[i];
      const previous = prices[i-1];
      if (current !== undefined && previous !== undefined && previous > 0) {
        returns.push(Math.log(current / previous));
      }
    }
    
    if (returns.length === 0) return 0;
    
    const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance * 1440); // Annualized (1440 minutes per day)
  }
  
  private calculateATR(candles: OHLCVCandle[]): number {
    if (candles.length < 2) return 0;
    
    const trueRanges: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const current = candles[i];
      const previous = candles[i-1];
      
      if (current && previous) {
        const high = current.high;
        const low = current.low;
        const prevClose = previous.close;
        
        const tr = Math.max(
          high - low,
          Math.abs(high - prevClose),
          Math.abs(low - prevClose)
        );
        trueRanges.push(tr);
      }
    }
    
    return trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;
  }
  
  private calculatePriceRange(highs: number[], lows: number[]): number {
    if (highs.length === 0 || lows.length === 0) return 0;
    const maxHigh = Math.max(...highs);
    const minLow = Math.min(...lows);
    return maxHigh - minLow;
  }
  
  private calculatePriceChange(prices: number[], minutes: number) {
    if (prices.length < minutes) {
      return { absolute: 0, percent: 0 };
    }
    
    const currentPrice = prices[prices.length - 1];
    const pastPrice = prices[prices.length - minutes];
    
    if (currentPrice === undefined || pastPrice === undefined || pastPrice === 0) {
      return { absolute: 0, percent: 0 };
    }
    
    const absolute = currentPrice - pastPrice;
    const percent = (absolute / pastPrice) * 100;
    
    return { absolute, percent };
  }
  
  private calculateSMA(values: number[], period: number): number {
    if (values.length < period) return 0;
    const slice = values.slice(-period);
    return slice.reduce((sum, val) => sum + val, 0) / slice.length;
  }
  
  private calculateEMA(prices: number[], period: number): number {
    if (prices.length === 0) return 0;
    const firstPrice = prices[0];
    if (prices.length === 1) return firstPrice || 0;
    
    const k = 2 / (period + 1);
    let ema = firstPrice || 0;
    
    for (let i = 1; i < prices.length; i++) {
      const current = prices[i];
      if (current !== undefined) {
        ema = (current * k) + (ema * (1 - k));
      }
    }
    
    return ema;
  }
  
  private calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 50; // Neutral RSI
    
    const gains: number[] = [];
    const losses: number[] = [];
    
    for (let i = 1; i < prices.length; i++) {
      const current = prices[i];
      const previous = prices[i - 1];
      
      if (current !== undefined && previous !== undefined) {
        const change = current - previous;
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? -change : 0);
      }
    }
    
    const avgGain = this.calculateSMA(gains, period);
    const avgLoss = this.calculateSMA(losses, period);
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }
  
  private calculateMACD(prices: number[]) {
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macd = ema12 - ema26;
    
    // Simplified signal line calculation
    const macdSignal = this.calculateEMA([macd], 9);
    const macdHistogram = macd - macdSignal;
    
    return { macd, macdSignal, macdHistogram };
  }
  
  private calculateBollingerBands(prices: number[], period: number, multiplier: number) {
    const sma = this.calculateSMA(prices, period);
    const slice = prices.slice(-period);
    
    if (slice.length < period) {
      return { upper: 0, lower: 0, position: 0.5 };
    }
    
    const variance = slice.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / slice.length;
    const stdDev = Math.sqrt(variance);
    
    const upper = sma + (stdDev * multiplier);
    const lower = sma - (stdDev * multiplier);
    const currentPrice = prices[prices.length - 1] || 0;
    
    // Calculate position within bands (0 = at lower band, 1 = at upper band)
    const position = upper > lower ? (currentPrice - lower) / (upper - lower) : 0.5;
    
    return { upper, lower, position: Math.max(0, Math.min(1, position)) };
  }
  
  private calculateMomentumScore(change1h: any, change4h: any, change24h: any, rsi: number): number {
    // Weighted momentum score considering different timeframes and RSI
    const score = (
      (change1h.percent * 0.2) +
      (change4h.percent * 0.3) +
      (change24h.percent * 0.3) +
      ((rsi - 50) * 0.2) // RSI deviation from neutral
    );
    
    return Math.max(-100, Math.min(100, score)); // Clamp between -100 and 100
  }
  
  private calculateTrendStrength(prices: number[], sma: number): number {
    if (prices.length === 0 || sma === 0) return 0;
    
    const currentPrice = prices[prices.length - 1] || 0;
    const deviation = Math.abs(currentPrice - sma) / sma;
    
    return Math.min(1, deviation * 10); // Scale to 0-1
  }
  
  private determineMomentumDirection(change1h: any, change4h: any, rsi: number): 'bullish' | 'bearish' | 'neutral' {
    const shortTermPositive = change1h.percent > 0;
    const mediumTermPositive = change4h.percent > 0;
    const rsiOverbought = rsi > 70;
    const rsiOversold = rsi < 30;
    
    if (shortTermPositive && mediumTermPositive && !rsiOverbought) {
      return 'bullish';
    } else if (!shortTermPositive && !mediumTermPositive && !rsiOversold) {
      return 'bearish';
    } else {
      return 'neutral';
    }
  }
  
  private calculateBuyVolumeRatio(candles: OHLCVCandle[]): number {
    if (candles.length === 0) return 0.5;
    
    const totalBuyVolume = candles.reduce((sum, candle) => sum + candle.buyVolumeUSD, 0);
    const totalVolume = candles.reduce((sum, candle) => sum + candle.volumeUSD, 0);
    
    return totalVolume > 0 ? totalBuyVolume / totalVolume : 0.5;
  }
  
  private calculateTrend(values: number[]): number {
    if (values.length < 2) return 0;
    
    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    
    const firstAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length;
    
    return firstAvg > 0 ? (secondAvg - firstAvg) / firstAvg : 0;
  }
  
  private hasVolumeSpike(volumes: number[], avgVolume: number): boolean {
    return volumes.some(volume => volume > (avgVolume * 2));
  }
  
  private calculateCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length === 0) return 0;
    
    const n = x.length;
    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => {
      const yVal = y[i];
      return yVal !== undefined ? sum + val * yVal : sum;
    }, 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);
    const sumYY = y.reduce((sum, val) => sum + val * val, 0);
    
    const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
    
    return denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  }
  
  private calculateBuyPressure(candles: OHLCVCandle[]): number {
    if (candles.length === 0) return 0;
    
    const totalBuyVolume = candles.reduce((sum, candle) => sum + candle.buyVolumeUSD, 0);
    const totalSellVolume = candles.reduce((sum, candle) => sum + candle.sellVolumeUSD, 0);
    const totalVolume = totalBuyVolume + totalSellVolume;
    
    if (totalVolume === 0) return 0;
    
    return (totalBuyVolume - totalSellVolume) / totalVolume;
  }
  
  private findPriceAtTime(candles: OHLCVCandle[], targetTime: Date): number {
    if (candles.length === 0) return 0;
    
    const targetUnix = targetTime.getTime();
    let closestCandle = candles[0];
    if (!closestCandle) return 0;
    
    let minDiff = Math.abs(targetUnix - closestCandle.timeUnix);
    
    for (const candle of candles) {
      const diff = Math.abs(targetUnix - candle.timeUnix);
      if (diff < minDiff) {
        minDiff = diff;
        closestCandle = candle;
      }
    }
    
    return closestCandle?.close || 0;
  }

  private formatLargeNumber(num: number): string {
    if (num >= 1e12) {
      return (num / 1e12).toFixed(2) + 'T';
    } else if (num >= 1e9) {
      return (num / 1e9).toFixed(2) + 'B';
    } else if (num >= 1e6) {
      return (num / 1e6).toFixed(2) + 'M';
    } else if (num >= 1e3) {
      return (num / 1e3).toFixed(2) + 'K';
    }
    return num.toFixed(2);
  }
  
  // Default/fallback methods
  private createFallbackFeatures(tokenMint: string, quoteMint: string, buyTimestamp: string, label?: string): OHLCVFeatures {
    return {
      tokenMint,
      quoteMint,
      buyTimestamp,
      dataStartTime: buyTimestamp,
      dataEndTime: buyTimestamp,
      ...(label && { label }), // Include label only if it exists
      candleCount: 0,
      candles: [],
      marketCapCandles: [],
      marketCapCandleCount: 0,
      volatility: this.getDefaultVolatilityMetrics(),
      momentum: this.getDefaultMomentumMetrics(),
      volumeProfile: this.getDefaultVolumeProfile(),
      marketCapVolatility: this.getDefaultVolatilityMetrics(),
      marketCapMomentum: this.getDefaultMomentumMetrics(),
      summary: {
        avgPrice: 0,
        totalVolume: 0,
        totalVolumeUSD: 0,
        totalTrades: 0,
        avgTradesPerMinute: 0,
        priceAtBuy: 0,
      },
      marketCapSummary: {
        avgMarketCap: 0,
        marketCapAtBuy: 0,
        lastAvailableMarketCap: 0,
        marketCapVolatility24h: 0,
        marketCapChange24h: 0,
        marketCapChangePercent24h: 0,
      },
    };
  }
  
  private getDefaultVolatilityMetrics(): VolatilityMetrics {
    return {
      priceVolatility1h: 0,
      priceVolatility4h: 0,
      priceVolatility24h: 0,
      atr1h: 0,
      atr4h: 0,
      atr24h: 0,
      priceRange1h: 0,
      priceRange4h: 0,
      priceRange24h: 0,
      priceRangePercent1h: 0,
      priceRangePercent4h: 0,
      priceRangePercent24h: 0,
      volatilitySpike1h: false,
      volatilitySpike4h: false,
      volatilitySpike24h: false,
      priceStabilityScore: 0,
    };
  }
  
  private getDefaultMomentumMetrics(): PriceMomentumMetrics {
    return {
      priceChange1h: 0,
      priceChange4h: 0,
      priceChange24h: 0,
      priceChangePercent1h: 0,
      priceChangePercent4h: 0,
      priceChangePercent24h: 0,
      sma5: 0,
      sma10: 0,
      sma20: 0,
      sma50: 0,
      ema5: 0,
      ema10: 0,
      ema20: 0,
      ema50: 0,
      rsi: 50,
      macd: 0,
      macdSignal: 0,
      macdHistogram: 0,
      bollingerUpper: 0,
      bollingerLower: 0,
      bollingerPosition: 0.5,
      momentumScore: 0,
      trendStrength: 0,
      momentumDirection: 'neutral',
    };
  }
  
  private getDefaultVolumeProfile(): VolumeProfile {
    return {
      buyVolumeRatio1h: 0.5,
      buyVolumeRatio4h: 0.5,
      buyVolumeRatio24h: 0.5,
      volumeTrend1h: 0,
      volumeTrend4h: 0,
      volumeTrend24h: 0,
      volumeSpike1h: false,
      volumeSpike4h: false,
      volumeSpike24h: false,
      volumeMA5: 0,
      volumeMA10: 0,
      volumeMA20: 0,
      volumePriceCorrelation: 0,
      buyPressure: 0,
    };
  }
  
  /**
   * Ensure directory exists for the given file path
   */
  private ensureDirectoryExists(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Created directory: ${dir}`);
    }
  }

  /**
   * Save results to JSON file
   */
  async saveToJSON(features: OHLCVFeatures[], filePath: string): Promise<void> {
    try {
      this.ensureDirectoryExists(filePath);
      
      const outputData = {
        extractionTime: new Date().toISOString(),
        totalTokens: features.length,
        features: features.map(feature => ({
          token: {
            mint: feature.tokenMint,
            quoteMint: feature.quoteMint,
            buyTimestamp: feature.buyTimestamp,
          },
          dataMetrics: {
            candleCount: feature.candleCount,
            marketCapCandleCount: feature.marketCapCandleCount,
            dataStartTime: feature.dataStartTime,
            dataEndTime: feature.dataEndTime,
            avgPrice: feature.summary.avgPrice,
            totalVolumeUSD: feature.summary.totalVolumeUSD,
            priceAtBuy: feature.summary.priceAtBuy,
            avgMarketCap: feature.marketCapSummary.avgMarketCap,
            marketCapAtBuy: feature.marketCapSummary.marketCapAtBuy,
            lastAvailableMarketCap: feature.marketCapSummary.lastAvailableMarketCap,
            marketCapChangePercent24h: feature.marketCapSummary.marketCapChangePercent24h,
          },
          priceFeatures: {
            volatilityMetrics: feature.volatility,
            momentumMetrics: feature.momentum,
            volumeMetrics: feature.volumeProfile,
          },
          marketCapFeatures: {
            volatilityMetrics: feature.marketCapVolatility,
            momentumMetrics: feature.marketCapMomentum,
          },
          label: feature.label, // Include performance label
        })),
      };
      
      fs.writeFileSync(filePath, JSON.stringify(outputData, null, 2));
      console.log(`✅ OHLCV features saved to ${filePath}`);
    } catch (error) {
      console.error(`❌ Error saving JSON file to ${filePath}:`, error);
      throw error;
    }
  }
  
  /**
   * Save results to CSV file
   */
  async saveToCSV(features: OHLCVFeatures[], filePath: string): Promise<void> {
    try {
      this.ensureDirectoryExists(filePath);
      
      const headers = [
        'token_mint',
        'quote_mint', 
        'buy_timestamp',
        'candle_count',
        'market_cap_candle_count',
        'price_at_buy',
        'avg_price',
        'total_volume_usd',
        'market_cap_at_buy',
        'avg_market_cap',
        'last_available_market_cap',
        'market_cap_change_24h_percent',
        'price_volatility_1h',
        'price_volatility_4h',
        'price_volatility_24h',
        'market_cap_volatility_1h',
        'market_cap_volatility_4h',
        'market_cap_volatility_24h',
        'price_atr_24h',
        'market_cap_atr_24h',
        'price_range_24h_percent',
        'market_cap_range_24h_percent',
        'price_volatility_spike_24h',
        'market_cap_volatility_spike_24h',
        'price_change_1h_percent',
        'price_change_4h_percent',
        'price_change_24h_percent',
        'market_cap_change_1h_percent',
        'market_cap_change_4h_percent',
        'market_cap_change_24h_percent',
        'price_rsi',
        'market_cap_rsi',
        'price_macd',
        'market_cap_macd',
        'price_sma_20',
        'market_cap_sma_20',
        'price_ema_20',
        'market_cap_ema_20',
        'price_bollinger_position',
        'market_cap_bollinger_position',
        'price_momentum_score',
        'market_cap_momentum_score',
        'price_momentum_direction',
        'market_cap_momentum_direction',
        'buy_volume_ratio_24h',
        'volume_trend_24h',
        'buy_pressure',
        'volume_price_correlation',
        'performance_label', // Target variable at the end for ML training
      ];
      
      const rows = features.map(feature => [
        feature.tokenMint,
        feature.quoteMint,
        feature.buyTimestamp,
        feature.candleCount,
        feature.marketCapCandleCount,
        feature.summary.priceAtBuy,
        feature.summary.avgPrice,
        feature.summary.totalVolumeUSD,
        feature.marketCapSummary.marketCapAtBuy,
        feature.marketCapSummary.avgMarketCap,
        feature.marketCapSummary.lastAvailableMarketCap,
        feature.marketCapSummary.marketCapChangePercent24h,
        feature.volatility.priceVolatility1h,
        feature.volatility.priceVolatility4h,
        feature.volatility.priceVolatility24h,
        feature.marketCapVolatility.priceVolatility1h,
        feature.marketCapVolatility.priceVolatility4h,
        feature.marketCapVolatility.priceVolatility24h,
        feature.volatility.atr24h,
        feature.marketCapVolatility.atr24h,
        feature.volatility.priceRangePercent24h,
        feature.marketCapVolatility.priceRangePercent24h,
        feature.volatility.volatilitySpike24h,
        feature.marketCapVolatility.volatilitySpike24h,
        feature.momentum.priceChangePercent1h,
        feature.momentum.priceChangePercent4h,
        feature.momentum.priceChangePercent24h,
        feature.marketCapMomentum.priceChangePercent1h,
        feature.marketCapMomentum.priceChangePercent4h,
        feature.marketCapMomentum.priceChangePercent24h,
        feature.momentum.rsi,
        feature.marketCapMomentum.rsi,
        feature.momentum.macd,
        feature.marketCapMomentum.macd,
        feature.momentum.sma20,
        feature.marketCapMomentum.sma20,
        feature.momentum.ema20,
        feature.marketCapMomentum.ema20,
        feature.momentum.bollingerPosition,
        feature.marketCapMomentum.bollingerPosition,
        feature.momentum.momentumScore,
        feature.marketCapMomentum.momentumScore,
        feature.momentum.momentumDirection,
        feature.marketCapMomentum.momentumDirection,
        feature.volumeProfile.buyVolumeRatio24h,
        feature.volumeProfile.volumeTrend24h,
        feature.volumeProfile.buyPressure,
        feature.volumeProfile.volumePriceCorrelation,
        feature.label || 'N/A', // Target variable at the end for ML training
      ]);
      
      const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
      fs.writeFileSync(filePath, csvContent);
      console.log(`✅ OHLCV features saved to ${filePath}`);
    } catch (error) {
      console.error(`❌ Error saving CSV file to ${filePath}:`, error);
      throw error;
    }
  }
} 