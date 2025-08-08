import {
    Model,
    DataLoader,
    defaultLogger,
    RawDataRecord,
    PredictionResult
  } from '@inscribable/xg_boost_decision_tree_model'
  import fs from 'fs'
  import { OHLCVFeatureExtractor } from '../../utils/ohlvc-features-extractor'
import { OHLCVFeatures } from '../../types/ohlcv-features';

// interface TestSample {
//     [key: string]: any; // Add index signature for RawDataRecord compatibility
//     candle_count: number;
//     market_cap_candle_count: number;
//     price_at_buy: number;
//     avg_price: number;
//     total_volume_usd: number;
//     market_cap_at_buy: number;
//     avg_market_cap: number;
//     last_available_market_cap: number;
//     price_change_1h_percent: number;
//     price_change_4h_percent: number;
//     price_change_24h_percent: number;
//     market_cap_change_1h_percent: number;
//     market_cap_change_4h_percent: number;
//     market_cap_change_24h_percent: number;
//     price_volatility_1h: number;
//     price_volatility_4h: number;
//     price_volatility_24h: number;
//     market_cap_volatility_1h: number;
//     market_cap_volatility_4h: number;
//     market_cap_volatility_24h: number;
//     price_atr_24h: number;
//     market_cap_atr_24h: number;
//     price_range_24h_percent: number;
//     market_cap_range_24h_percent: number;
//     price_rsi: number;
//     market_cap_rsi: number;
//     price_macd: number;
//     market_cap_macd: number;
//     price_sma_20: number;
//     market_cap_sma_20: number;
//     price_ema_20: number;
//     market_cap_ema_20: number;
//     price_bollinger_position: number;
//     market_cap_bollinger_position: number;
//     price_momentum_score: number;
//     market_cap_momentum_score: number;
//     buy_volume_ratio_24h: number;
//     volume_trend_24h: number;
//     buy_pressure: number;
//     volume_price_correlation: number;
//     performance_label?: string; // Optional for new predictions
//   }

  export class MLService {
    
    private static readonly WSOL_MINT = 'So11111111111111111111111111111111111111112';

    constructor() {}

    async extractFeatures({tokenMint, buyTimestamp, lookbackHours}:
        {
            tokenMint: string,
            buyTimestamp: string,
            lookbackHours: number,
        }):Promise<RawDataRecord> {
        try{
            const featureExtractor = new OHLCVFeatureExtractor()
            const features: OHLCVFeatures = await featureExtractor.extractOHLCVFeatures(tokenMint, buyTimestamp, MLService.WSOL_MINT, lookbackHours)
            
            const extractedFeatures:RawDataRecord= {
                token_mint: features.tokenMint,
                quote_mint: features.quoteMint, 
                buy_timestamp: features.buyTimestamp,
                candle_count: features.candleCount,
                market_cap_candle_count: features.marketCapCandleCount,
                price_at_buy: features.summary.priceAtBuy,
                avg_price: features.summary.avgPrice,
                total_volume_usd: features.summary.totalVolumeUSD,
                market_cap_at_buy: features.marketCapSummary.marketCapAtBuy,
                avg_market_cap: features.marketCapSummary.avgMarketCap,
                last_available_market_cap: features.marketCapSummary.lastAvailableMarketCap,
                market_cap_change_24h_percent: features.marketCapSummary.marketCapChangePercent24h,
                price_volatility_1h: features.volatility.priceVolatility1h,
                price_volatility_4h: features.volatility.priceVolatility4h,
                price_volatility_24h: features.volatility.priceVolatility24h,
                market_cap_volatility_1h: features.marketCapVolatility.priceVolatility1h,
                market_cap_volatility_4h: features.marketCapVolatility.priceVolatility4h,
                market_cap_volatility_24h: features.marketCapVolatility.priceVolatility24h,
                price_atr_24h: features.volatility.atr24h,
                market_cap_atr_24h: features.marketCapVolatility.atr24h,
                price_range_24h_percent: features.volatility.priceRangePercent24h,
                market_cap_range_24h_percent: features.marketCapVolatility.priceRangePercent24h,
                price_volatility_spike_24h: features.volatility.volatilitySpike24h,
                market_cap_volatility_spike_24h: features.marketCapVolatility.volatilitySpike24h,
                price_change_1h_percent: features.momentum.priceChangePercent1h,
                price_change_4h_percent: features.momentum.priceChangePercent4h,
                price_change_24h_percent: features.momentum.priceChangePercent24h,
                market_cap_change_1h_percent: features.marketCapMomentum.priceChangePercent1h,
                market_cap_change_4h_percent: features.marketCapMomentum.priceChangePercent4h,
                market_cap_change_24h_percent_1: features.marketCapMomentum.priceChangePercent24h,
                price_rsi: features.momentum.rsi,
                market_cap_rsi: features.marketCapMomentum.rsi,
                price_macd: features.momentum.macd,
                market_cap_macd: features.marketCapMomentum.macd,
                price_sma_20: features.momentum.sma20,
                market_cap_sma_20: features.marketCapMomentum.sma20,
                price_ema_20: features.momentum.ema20,
                market_cap_ema_20: features.marketCapMomentum.ema20,
                price_bollinger_position: features.momentum.bollingerPosition,
                market_cap_bollinger_position: features.marketCapMomentum.bollingerPosition,
                price_momentum_score: features.momentum.momentumScore,
                market_cap_momentum_score: features.marketCapMomentum.momentumScore,
                price_momentum_direction: features.momentum.momentumDirection,
                market_cap_momentum_direction: features.marketCapMomentum.momentumDirection,
                buy_volume_ratio_24h: features.volumeProfile.buyVolumeRatio24h,
                volume_trend_24h: features.volumeProfile.volumeTrend24h,
                buy_pressure: features.volumeProfile.buyPressure,
                volume_price_correlation: features.volumeProfile.volumePriceCorrelation,
                performance_label: features.label || 'N/A', // Target variable at the end for ML training
            };
            
            return extractedFeatures
        } catch (error) {
            defaultLogger.error(`Error extracting features: ${error}`)
            return {} as RawDataRecord
        }
    }
    
    
    async predict({modelPath, tokenMint, buyTimestamp, lookbackHours}: {modelPath: string,  tokenMint: string, buyTimestamp: string, lookbackHours: number,}):Promise<PredictionResult> {
        try{
            const model = await Model.load(modelPath)
            const data = await this.extractFeatures({tokenMint, buyTimestamp, lookbackHours})
            const prediction = model.predictWithProbabilities(data)
            return prediction
        } catch (error) {
            defaultLogger.error(`Error predicting: ${error}`)
            return {} as PredictionResult
        }
    }
    
  }

//   const mlService = new MLService();
//   mlService.predict({modelPath: process.cwd() + '/src/services/ml/models/cupsey_ohlcv_model', tokenMint: '9hdynudAhhWzuNFAnpz7NjvdKMfh9z8mcZKNYHuAUgJQ', buyTimestamp: new Date().toISOString(), lookbackHours: 1}).then(prediction => {
//     console.log('🤖 Prediction:', prediction);
//   });
  //console.log('🤖 Prediction:', prediction);