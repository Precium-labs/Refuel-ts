export interface Prices {
    eth: number;
    sol: number;
  }
  
 export interface Balances {
    eth: bigint;
    arb: bigint;
    base: bigint;
    opt: bigint;
    sol: number;
  }
  
 export interface WalletData {
    address: string;
    private_key: string;
    seed_phrase?: string;
  }
  
 export interface UserWalletData {
    evm_wallet: WalletData;
    solana_wallet: WalletData;
  }

  export interface ReferralInfo {
    referralCode: string;
    referralCount: number;
    rewardsEarned: number;
}

export interface TransferResult {
    success: boolean;
    txHash: string;
    explorerLink: string;
    errorReason?: string;
}

export interface UserSettings {
  telegramId: string;
  language: string;
}

