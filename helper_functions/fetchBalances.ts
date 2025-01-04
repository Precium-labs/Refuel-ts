import { PublicKey } from "@solana/web3.js";
import { Balances, Prices, WalletData } from "./interfaces";
import axios from "axios";


async function fetchBalances(providers: any, evmWallet: WalletData, solanaWallet: WalletData): Promise<Balances> {
    try {
      const [ethBalance, arbBalance, baseBalance, optBalance, solBalance] = await Promise.all([
        providers.eth.getBalance(evmWallet.address).catch((e: Error) => {
          console.error('Error fetching ETH balance:', e);
          return 0n;
        }),
        providers.arb.getBalance(evmWallet.address).catch((e: Error) => {
          console.error('Error fetching ARB balance:', e);
          return 0n;
        }),
        providers.base.getBalance(evmWallet.address).catch((e: Error) => {
          console.error('Error fetching BASE balance:', e);
          return 0n;
        }), 
        providers.opt.getBalance(evmWallet.address).catch((e: Error) => {
          console.error('Error fetching OPT balance:', e);
          return 0n;
        }),
        providers.sol.getBalance(new PublicKey(solanaWallet.address)).catch((e: Error) => {
          console.error('Error fetching SOL balance:', e);
          return 0;
        }),
      ]);
  
      return {
        eth: ethBalance,
        arb: arbBalance,
        base: baseBalance,
        opt: optBalance,
        sol: solBalance,
      };
    } catch (error) {
      console.error('Error fetching balances:', error);
      return {
        eth: 0n,
        arb: 0n,
        base: 0n,
        opt: 0n,
        sol: 0,
      };
    }
  }

export async function fetchPrices(): Promise<Prices> {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum,solana&vs_currencies=usd');
      return {
        eth: response.data.ethereum.usd,
        sol: response.data.solana.usd,
      };
    } catch (error) {
      console.error('Error fetching prices:', error);
      return { eth: 0, sol: 0 };
    }
  }

export default fetchBalances