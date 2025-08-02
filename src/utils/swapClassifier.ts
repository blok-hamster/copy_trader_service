type TokenTransfer = {
    fromTokenAccount: string;
    fromUserAccount: string;
    mint: string;
    toTokenAccount: string;
    toUserAccount: string;
    tokenAmount: number;
    tokenStandard: 'Fungible' | string;
};
  
  type SwapInfo = {
    type: 'buy' | 'sell' | 'unknown';
    tokenMint: string;
    tokenAmount: number; // non-SOL token (absolute)
    solAmount: number;   // SOL/WSOL (absolute)
  };
  
  const WSOL_MINT = 'So11111111111111111111111111111111111111112';
  
  export function classifySwap(
    transfers: TokenTransfer[],
    owner: string
  ): SwapInfo {
    const ownerKey = owner.toString();
    const delta = new Map<string, number>();
  
    // Accumulate net change per mint
    for (const t of transfers) {
      const mint = t.mint;
      let change = 0;
  
      if (t.fromUserAccount === ownerKey) change -= t.tokenAmount;
      if (t.toUserAccount   === ownerKey) change += t.tokenAmount;
  
      if (change !== 0) {
        delta.set(mint, (delta.get(mint) || 0) + change);
      }
    }
  
    // We expect exactly two non-zero deltas for a simple swap
    if (delta.size !== 2) {
      return { type: 'unknown', tokenMint: '', tokenAmount: 0, solAmount: 0 };
    }
    const entries = Array.from(delta.entries());
    const [mintA, changeA] = entries[0] ?? ['', 0];
    const [mintB, changeB] = entries[1] ?? ['', 0];
  
    const isA_SOL = mintA === WSOL_MINT;
    const isB_SOL = mintB === WSOL_MINT;
  
    if (!isA_SOL && !isB_SOL) {
      return { type: 'unknown', tokenMint: '', tokenAmount: 0, solAmount: 0 };
    }
  
    const solChange   = isA_SOL ? changeA : changeB;
    const tokenMint   = isA_SOL ? mintB   : mintA;
    const tokenChange = isA_SOL ? changeB : changeA;
  
    if (solChange > 0 && tokenChange < 0) {
      // Owner ends with more SOL → they sold the token
      return {
        type: 'sell',
        tokenMint,
        tokenAmount: Math.abs(tokenChange),
        solAmount: Math.abs(solChange),
      };
    }
    if (solChange < 0 && tokenChange > 0) {
      // Owner ends with less SOL → they bought the token
      return {
        type: 'buy',
        tokenMint,
        tokenAmount: Math.abs(tokenChange),
        solAmount: Math.abs(solChange),
      };
    }
  
    return { type: 'unknown', tokenMint: '', tokenAmount: 0, solAmount: 0 };
  }

  // types.ts
export interface RawTokenAmount {
    decimals: number;
    tokenAmount: string; // signed string
  }
  
  export interface TokenBalanceChange {
    mint: string;
    rawTokenAmount: RawTokenAmount;
    tokenAccount: string;
    userAccount: string;
  }
  
  export interface Account {
    account: string;
    nativeBalanceChange: number; // lamports
    tokenBalanceChanges: TokenBalanceChange[];
  }
  
  export interface TransactionData {
    accountData: Account[];
    tokenTransfers: TokenTransfer[];
  }
  
  export type Side = 'buy' | 'sell' | 'unknown';
  
  export interface ParsedSwap {
    side: Side;
    tokenMint: string;
    tokenAmount: number;
    solAmount: number;
  }
  
  // helpers.ts
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  
  /**
   * Convert raw string amount to human-readable number.
   */
  function toHuman(raw: string, decimals: number): number {
    const sign = raw.startsWith('-') ? -1 : 1;
    const abs = raw.replace('-', '');
    return sign * Number(abs) / 10 ** decimals;
  }
  
  /**
   * Extract the swap side, token and amounts from a single Solana tx.
   * Returns null when the tx does not fit a simple buy/sell pattern.
   */
  export function parseSwap(tx: TransactionData, targetUser?: string): ParsedSwap  {
   try{ // 1. Build a map: userAccount -> mint -> net change
    const userChanges = new Map<string, Map<string, number>>();
    
    // First, process token balance changes
    for (const acc of tx.accountData) {
      for (const tbc of acc.tokenBalanceChanges) {
        const user = tbc.userAccount;
        const mint = tbc.mint;
        const delta = toHuman(tbc.rawTokenAmount.tokenAmount, tbc.rawTokenAmount.decimals);

        if (!userChanges.has(user)) userChanges.set(user, new Map());
        const mintMap = userChanges.get(user)!;
        mintMap.set(mint, (mintMap.get(mint) || 0) + delta);
      }
    }
    
    // Then, process native SOL balance changes
    for (const acc of tx.accountData) {
      if (acc.nativeBalanceChange !== 0) {
        // Find the user account - we need to determine which user this account belongs to
        // For now, we'll assume the account IS the user account if it has a balance change
        const user = acc.account;
        const delta = acc.nativeBalanceChange / 1e9; // Convert lamports to SOL
        
        if (!userChanges.has(user)) userChanges.set(user, new Map());
        const mintMap = userChanges.get(user)!;
        mintMap.set(SOL_MINT, (mintMap.get(SOL_MINT) || 0) + delta);
      }
    }

    // 2. Pick the user to analyse (first non-zero-change user if not supplied)
    const userToCheck = targetUser ?? [...userChanges.keys()][0];
    if (!userToCheck) return {} as ParsedSwap;
    
    const changes = userChanges.get(userToCheck);
    if (!changes) return {} as ParsedSwap;

    // 3. Separate SOL and non-SOL changes
    const solChange = changes.get(SOL_MINT) ?? 0;
    const tokenEntries = [...changes.entries()].filter(([m]) => m !== SOL_MINT);
    if (tokenEntries.length !== 1) return {} as ParsedSwap;

    const tokenEntry = tokenEntries[0];
    if (!tokenEntry) return {} as ParsedSwap;
    
    const [tokenMint, tokenChange] = tokenEntry;
    if (solChange === 0 || tokenChange === 0) return {} as ParsedSwap;

    // 4. Determine side
    //   buy  : user gives SOL (solChange < 0) → receives token (tokenChange > 0)
    //   sell : user gives token (tokenChange < 0) → receives SOL (solChange > 0)
    let side: Side = 'unknown';
    if (solChange < 0 && tokenChange > 0) {
      side = 'buy';
    } else if (tokenChange < 0 && solChange > 0) {
      side = 'sell';
    }

    return {
      side,
      tokenMint,
      tokenAmount: Math.abs(tokenChange),
      solAmount: Math.abs(solChange),
    };
    }catch(e){
      console.log(e);
      return {} as ParsedSwap;
    }
  }

// if (require.main === module) {
//   const sampleTransfers: TokenTransfer[] = [
//     {
//         "fromTokenAccount": "pFjfMg939dcZ2zJtw6zbuECZJt51v4mY69BZ7W1XRbG",
//         "fromUserAccount": "8rvAsDKeAcEjEkiZMug9k8v1y8mW6gQQiMobd89Uy7qR",
//         "mint": "So11111111111111111111111111111111111111112",
//         "toTokenAccount": "DD7k4bSWt8MGcb4PhXXHmtNqFaPVb4ReqwZANBwpEqAj",
//         "toUserAccount": "CdQTNULjDiTsvyR5UKjYBMqWvYpxXj6HY4m6atm2hErk",
//         "tokenAmount": 0.02,
//         "tokenStandard": "Fungible"
//     },
//     {
//         "fromTokenAccount": "pFjfMg939dcZ2zJtw6zbuECZJt51v4mY69BZ7W1XRbG",
//         "fromUserAccount": "8rvAsDKeAcEjEkiZMug9k8v1y8mW6gQQiMobd89Uy7qR",
//         "mint": "So11111111111111111111111111111111111111112",
//         "toTokenAccount": "HZeLxbZ9uHtSpwZC3LBr4Nubd14iHwz7bRSghRZf5VCG",
//         "toUserAccount": "FERjPVNEa7Udq8CEv68h6tPL46Tq7ieE49HrE2wea3XT",
//         "tokenAmount": 9.98,
//         "tokenStandard": "Fungible"
//     },
//     {
//         "fromTokenAccount": "F1qQKR26sARrMN9gQMNHfBUcZi5i2TSNVJaLkWZpnMnr",
//         "fromUserAccount": "CL5t9j5mymkSkAEHpCD9v9gtZtinVMVdC3ij7PFxALsW",
//         "mint": "2fdtCHuvyLcD2q86XZGFmYbDux9ZbbUgMmFhzChqmoon",
//         "toTokenAccount": "BZuD4Heg3eUSx5STTGDdzW3xPyRuFfLFUTFnzPePvnqi",
//         "toUserAccount": "8rvAsDKeAcEjEkiZMug9k8v1y8mW6gQQiMobd89Uy7qR",
//         "tokenAmount": 1479574.406117774,
//         "tokenStandard": "Fungible"
//     },
//     {
//         "fromTokenAccount": "FTkEx6kvBkYM1oRdv5c9xV6fbp2v7UbnQRV7nnyY2ToF",
//         "fromUserAccount": "CdQTNULjDiTsvyR5UKjYBMqWvYpxXj6HY4m6atm2hErk",
//         "mint": "9qYULtX43DCTBjGuPE8cLMieh7R6uX7ixevD4nwRbhwK",
//         "toTokenAccount": "",
//         "toUserAccount": "",
//         "tokenAmount": 1479574.406117774,
//         "tokenStandard": "Fungible"
//     },
//     {
//         "fromTokenAccount": "",
//         "fromUserAccount": "",
//         "mint": "FZN7QZ8ZUUAxMPfxYEYkH3cXUASzH8EqA6B4tyCL8f1j",
//         "toTokenAccount": "CdQTNULjDiTsvyR5UKjYBMqWvYpxXj6HY4m6atm2hErk",
//         "toUserAccount": "CdQTNULjDiTsvyR5UKjYBMqWvYpxXj6HY4m6atm2hErk",
//         "tokenAmount": 9.115624101,
//         "tokenStandard": "Fungible"
//     }
// ]

//   const owner = '8rvAsDKeAcEjEkiZMug9k8v1y8mW6gQQiMobd89Uy7qR';
//   console.log(classifySwap(sampleTransfers, owner)); // → 'buy'
// }