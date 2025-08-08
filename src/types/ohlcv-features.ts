/**
 * TypeScript interfaces for OHLCV historical data and derived features
 */

export interface OHLCVCandle {
    timestamp: string;
    timeUnix: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    volumeUSD: number;
    tradeCount: number;
    buyers: number;
    sellers: number;
    buyVolume: number;
    sellVolume: number;
    buyVolumeUSD: number;
    sellVolumeUSD: number;
    avgPrice: number;
  }
  
  export interface VolatilityMetrics {
    // Price volatility
    priceVolatility1h: number;
    priceVolatility4h: number;
    priceVolatility24h: number;
    
    // Average True Range (ATR)
    atr1h: number;
    atr4h: number;
    atr24h: number;
    
    // Price range metrics
    priceRange1h: number;
    priceRange4h: number;
    priceRange24h: number;
    priceRangePercent1h: number;
    priceRangePercent4h: number;
    priceRangePercent24h: number;
    
    // Volatility spikes
    volatilitySpike1h: boolean;
    volatilitySpike4h: boolean;
    volatilitySpike24h: boolean;
    
    // Price stability score (inverse of volatility)
    priceStabilityScore: number;
  }
  
  export interface PriceMomentumMetrics {
    // Price changes
    priceChange1h: number;
    priceChange4h: number;
    priceChange24h: number;
    priceChangePercent1h: number;
    priceChangePercent4h: number;
    priceChangePercent24h: number;
    
    // Moving averages
    sma5: number;
    sma10: number;
    sma20: number;
    sma50: number;
    
    // Exponential moving averages
    ema5: number;
    ema10: number;
    ema20: number;
    ema50: number;
    
    // Technical indicators
    rsi: number;
    macd: number;
    macdSignal: number;
    macdHistogram: number;
    
    // Bollinger Bands
    bollingerUpper: number;
    bollingerLower: number;
    bollingerPosition: number; // Position within bands (0-1)
    
    // Momentum indicators
    momentumScore: number;
    trendStrength: number;
    momentumDirection: 'bullish' | 'bearish' | 'neutral';
  }
  
  export interface VolumeProfile {
    // Volume ratios
    buyVolumeRatio1h: number;
    buyVolumeRatio4h: number;
    buyVolumeRatio24h: number;
    
    // Volume trends
    volumeTrend1h: number;
    volumeTrend4h: number;
    volumeTrend24h: number;
    
    // Volume spikes
    volumeSpike1h: boolean;
    volumeSpike4h: boolean;
    volumeSpike24h: boolean;
    
    // Volume moving averages
    volumeMA5: number;
    volumeMA10: number;
    volumeMA20: number;
    
    // Volume-Price relationship
    volumePriceCorrelation: number;
    buyPressure: number; // Net buying pressure
  }
  
  export interface OHLCVFeatures {
    tokenMint: string;
    quoteMint: string;
    buyTimestamp: string;
    dataStartTime: string;
    dataEndTime: string;
    candleCount: number;
    label?: string; // Performance label for the trade
    
    // Raw OHLCV data
    candles: OHLCVCandle[];
    
    // Market cap OHLCV data
    marketCapCandles: OHLCVCandle[];
    marketCapCandleCount: number;
    
    // Calculated features from price data
    volatility: VolatilityMetrics;
    momentum: PriceMomentumMetrics;
    volumeProfile: VolumeProfile;
    
    // Calculated features from market cap data
    marketCapVolatility: VolatilityMetrics;
    marketCapMomentum: PriceMomentumMetrics;
    
    // Summary metrics
    summary: {
      avgPrice: number;
      totalVolume: number;
      totalVolumeUSD: number;
      totalTrades: number;
      avgTradesPerMinute: number;
      priceAtBuy: number;
    };
    
    // Market cap summary metrics
    marketCapSummary: {
      avgMarketCap: number;
      marketCapAtBuy: number;
      lastAvailableMarketCap: number;
      marketCapVolatility24h: number;
      marketCapChange24h: number;
      marketCapChangePercent24h: number;
    };
  }
  
  export interface HistoricalOHLCVResponse {
    Solana: {
      DEXTradeByTokens: Array<{
        Block: {
          Timefield: string;
        };
        volume: string;
        volumeUSD: string;
        Trade: {
          high: string;
          low: string;
          open: string;
          close: string;
        };
        count: number;
        buyers: number;
        sellers: number;
        buyVolume: string;
        sellVolume: string;
        buyVolumeUSD: string;
        sellVolumeUSD: string;
      }>;
    };
  } 