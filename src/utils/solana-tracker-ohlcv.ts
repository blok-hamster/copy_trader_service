import { SolanaTrackerClient } from './solanaTrackerClient';
import { 
  OHLCVCandle, 
  OHLCVResponse, 
  ChartDataOptions, 
  ChartInterval,
  HoldersChartResponse,
  HoldersChartOptions
} from '../types';
import * as fs from 'fs';
import * as path from 'path';

export type OHLCVOutputFormat = 'json' | 'csv' | 'both';

export class SolanaTrackerOHLCVExtractor {
  private client: SolanaTrackerClient;
  private outputDir: string;
  private outputFormat: OHLCVOutputFormat;

  constructor(
    client: SolanaTrackerClient,
    outputDir: string = './output/ohlcv',
    outputFormat: OHLCVOutputFormat = 'both'
  ) {
    this.client = client;
    this.outputDir = outputDir;
    this.outputFormat = outputFormat;
  }

  /**
   * Extract OHLCV data for a token
   */
  async extractTokenOHLCV(
    tokenAddress: string,
    options?: ChartDataOptions,
    format?: OHLCVOutputFormat
  ): Promise<OHLCVCandle[]> {
    const outputFormat = format || this.outputFormat;
    
    // console.log(`🎯 Starting OHLCV extraction for token: ${tokenAddress}`);
    // console.log(`📊 Output format: ${outputFormat}`);
    // console.log(`📁 Output directory: ${this.outputDir}`);
    
    // if (options) {
    //   console.log(`⚙️  Options:`, options);
    // }

    // Ensure output directory exists
    //await this.ensureDirectoryExists(this.outputDir);

    try {
      const response: OHLCVResponse = await this.client.getTokenChartData(tokenAddress, options);
      
      if (!response.oclhv || response.oclhv.length === 0) {
        //console.log(`⚠️  No OHLCV data found for token: ${tokenAddress}`);
        return [];
      }

      const candles = response.oclhv;
      //console.log(`✅ Found ${candles.length} OHLCV candles for token: ${tokenAddress}`);

      // Save the data
      //await this.saveOHLCVData(tokenAddress, candles, outputFormat, options);

      return candles;
    } catch (error) {
      console.error(`❌ Error extracting OHLCV data for token ${tokenAddress}:`, error);
      throw error;
    }
  }

  /**
   * Extract OHLCV data for a specific token and pool
   */
  async extractTokenPoolOHLCV(
    tokenAddress: string,
    poolAddress: string,
    options?: ChartDataOptions,
    format?: OHLCVOutputFormat
  ): Promise<OHLCVCandle[]> {
    const outputFormat = format || this.outputFormat;
    
    console.log(`🎯 Starting OHLCV extraction for token: ${tokenAddress}, pool: ${poolAddress}`);
    console.log(`📊 Output format: ${outputFormat}`);
    console.log(`📁 Output directory: ${this.outputDir}`);
    
    if (options) {
      console.log(`⚙️  Options:`, options);
    }

    // Ensure output directory exists
    await this.ensureDirectoryExists(this.outputDir);

    try {
      const response: OHLCVResponse = await this.client.getTokenPoolChartData(tokenAddress, poolAddress, options);
      
      if (!response.oclhv || response.oclhv.length === 0) {
        console.log(`⚠️  No OHLCV data found for token: ${tokenAddress}, pool: ${poolAddress}`);
        return [];
      }

      const candles = response.oclhv;
      console.log(`✅ Found ${candles.length} OHLCV candles for token: ${tokenAddress}, pool: ${poolAddress}`);

      // Save the data
      await this.saveOHLCVData(`${tokenAddress}_${poolAddress}`, candles, outputFormat, options);

      return candles;
    } catch (error) {
      console.error(`❌ Error extracting OHLCV data for token ${tokenAddress}, pool ${poolAddress}:`, error);
      throw error;
    }
  }

  /**
   * Extract holders chart data for a token
   */
  async extractTokenHoldersChart(
    tokenAddress: string,
    options?: HoldersChartOptions,
    format?: OHLCVOutputFormat
  ): Promise<any[]> {
    const outputFormat = format || this.outputFormat;
    
    console.log(`🎯 Starting holders chart extraction for token: ${tokenAddress}`);
    console.log(`📊 Output format: ${outputFormat}`);
    console.log(`📁 Output directory: ${this.outputDir}`);
    
    if (options) {
      console.log(`⚙️  Options:`, options);
    }

    // Ensure output directory exists
    await this.ensureDirectoryExists(this.outputDir);

    try {
      const response: HoldersChartResponse = await this.client.getTokenHoldersChart(tokenAddress, options);
      
      if (!response.holders || response.holders.length === 0) {
        console.log(`⚠️  No holders chart data found for token: ${tokenAddress}`);
        return [];
      }

      const holdersData = response.holders;
      console.log(`✅ Found ${holdersData.length} holders data points for token: ${tokenAddress}`);

      // Save the data
      await this.saveHoldersData(tokenAddress, holdersData, outputFormat, options);

      return holdersData;
    } catch (error) {
      console.error(`❌ Error extracting holders chart data for token ${tokenAddress}:`, error);
      throw error;
    }
  }

  /**
   * Extract OHLCV data for multiple tokens
   */
  async extractMultipleTokensOHLCV(
    tokenAddresses: string[],
    options?: ChartDataOptions,
    format?: OHLCVOutputFormat
  ): Promise<Map<string, OHLCVCandle[]>> {
    const results = new Map<string, OHLCVCandle[]>();
    
    console.log(`🎯 Starting OHLCV extraction for ${tokenAddresses.length} tokens`);
    
    for (const tokenAddress of tokenAddresses) {
      try {
        const candles = await this.extractTokenOHLCV(tokenAddress, options, format);
        results.set(tokenAddress, candles);
        
        // Add delay between requests to respect rate limits
        await this.delay(400);
      } catch (error) {
        console.error(`❌ Error extracting OHLCV data for token ${tokenAddress}:`, error);
        results.set(tokenAddress, []);
      }
    }

    console.log(`📊 ===== OHLCV EXTRACTION COMPLETE =====`);
    console.log(`📊 Total tokens processed: ${tokenAddresses.length}`);
    console.log(`📊 Successful extractions: ${Array.from(results.values()).filter(candles => candles.length > 0).length}`);
    
    return results;
  }

  /**
   * Save OHLCV data to files
   */
  private async saveOHLCVData(
    identifier: string,
    candles: OHLCVCandle[],
    format: OHLCVOutputFormat,
    options?: ChartDataOptions
  ): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${identifier}_${timestamp}`;
    
    // Add options to filename if provided
    let optionsStr = '';
    if (options) {
      const parts: string[] = [];
      if (options.type) parts.push(`${options.type}`);
      if (options.time_from) parts.push(`from_${options.time_from}`);
      if (options.time_to) parts.push(`to_${options.time_to}`);
      if (parts.length > 0) {
        optionsStr = `_${parts.join('_')}`;
      }
    }

    const fullFilename = `${filename}${optionsStr}`;

    // Save JSON format
    if (format === 'json' || format === 'both') {
      await this.saveOHLCVJSON(fullFilename, candles, options);
    }

    // Save CSV format
    if (format === 'csv' || format === 'both') {
      await this.saveOHLCVCSV(fullFilename, candles, options);
    }
  }

  /**
   * Save OHLCV data as JSON
   */
  private async saveOHLCVJSON(
    filename: string,
    candles: OHLCVCandle[],
    options?: ChartDataOptions
  ): Promise<void> {
    const filePath = path.join(this.outputDir, `${filename}.json`);
    
    const data = {
      metadata: {
        filename,
        extractedAt: new Date().toISOString(),
        candleCount: candles.length,
        options: options || {},
        timeRange: candles.length > 0 ? {
          start: new Date(candles[0]!.time * 1000).toISOString(),
          end: new Date(candles[candles.length - 1]!.time * 1000).toISOString()
        } : null
      },
      candles
    };

    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
    console.log(`💾 JSON: Saved ${candles.length} candles to ${filePath}`);
  }

  /**
   * Save OHLCV data as CSV
   */
  private async saveOHLCVCSV(
    filename: string,
    candles: OHLCVCandle[],
    options?: ChartDataOptions
  ): Promise<void> {
    const filePath = path.join(this.outputDir, `${filename}.csv`);
    
    const csvHeader = 'timestamp,datetime,open,high,low,close,volume';
    const csvRows = candles.map(candle => 
      `${candle.time},${new Date(candle.time * 1000).toISOString()},${candle.open},${candle.high},${candle.low},${candle.close},${candle.volume}`
    );
    
    const csvContent = [csvHeader, ...csvRows].join('\n');
    
    await fs.promises.writeFile(filePath, csvContent);
    console.log(`💾 CSV: Saved ${candles.length} candles to ${filePath}`);
  }

  /**
   * Save holders data to files
   */
  private async saveHoldersData(
    tokenAddress: string,
    holdersData: any[],
    format: OHLCVOutputFormat,
    options?: HoldersChartOptions
  ): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${tokenAddress}_holders_${timestamp}`;
    
    // Add options to filename if provided
    let optionsStr = '';
    if (options) {
      const parts: string[] = [];
      if (options.type) parts.push(`${options.type}`);
      if (options.time_from) parts.push(`from_${options.time_from}`);
      if (options.time_to) parts.push(`to_${options.time_to}`);
      if (parts.length > 0) {
        optionsStr = `_${parts.join('_')}`;
      }
    }

    const fullFilename = `${filename}${optionsStr}`;

    // Save JSON format
    if (format === 'json' || format === 'both') {
      await this.saveHoldersJSON(fullFilename, holdersData, options);
    }

    // Save CSV format
    if (format === 'csv' || format === 'both') {
      await this.saveHoldersCSV(fullFilename, holdersData, options);
    }
  }

  /**
   * Save holders data as JSON
   */
  private async saveHoldersJSON(
    filename: string,
    holdersData: any[],
    options?: HoldersChartOptions
  ): Promise<void> {
    const filePath = path.join(this.outputDir, `${filename}.json`);
    
    const data = {
      metadata: {
        filename,
        extractedAt: new Date().toISOString(),
        dataPointCount: holdersData.length,
        options: options || {},
        timeRange: holdersData.length > 0 ? {
          start: new Date(holdersData[0]!.time * 1000).toISOString(),
          end: new Date(holdersData[holdersData.length - 1]!.time * 1000).toISOString()
        } : null
      },
      holdersData
    };

    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
    console.log(`💾 JSON: Saved ${holdersData.length} holders data points to ${filePath}`);
  }

  /**
   * Save holders data as CSV
   */
  private async saveHoldersCSV(
    filename: string,
    holdersData: any[],
    options?: HoldersChartOptions
  ): Promise<void> {
    const filePath = path.join(this.outputDir, `${filename}.csv`);
    
    const csvHeader = 'timestamp,datetime,holders';
    const csvRows = holdersData.map(data => 
      `${data.time},${new Date(data.time * 1000).toISOString()},${data.holders}`
    );
    
    const csvContent = [csvHeader, ...csvRows].join('\n');
    
    await fs.promises.writeFile(filePath, csvContent);
    console.log(`💾 CSV: Saved ${holdersData.length} holders data points to ${filePath}`);
  }

  /**
   * Ensure directory exists, create if it doesn't
   */
  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.promises.access(dirPath);
    } catch (error) {
      // Directory doesn't exist, create it
      await fs.promises.mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * Utility method to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
} 