import dotenv from 'dotenv';

dotenv.config();

export interface SolanaTrackerConfig {
  apiKey: string;
  endpoint: string;
  headers: Record<string, string>;
  rateLimit: {
    requestsPerSecond: number;
    requestsPerMinute: number;
  };
}

export const solanaTrackerConfig: SolanaTrackerConfig = {
  apiKey: process.env.SOLANA_TRACKER_API_KEY || '',
  endpoint: 'https://data.solanatracker.io',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.SOLANA_TRACKER_API_KEY || '9c349957-218c-49d5-ac1e-b8f0b676f0e3',
  },
  rateLimit: {
    requestsPerSecond: 1, // Default free tier has 1 request per second
    requestsPerMinute: 60,
  },
};

export const SOLANA_ENDPOINTS = {
  mainnet: 'https://data.solanatracker.io',
  testnet: 'https://data.solanatracker.io',
};

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'; 