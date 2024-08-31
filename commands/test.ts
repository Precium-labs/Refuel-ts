/ import { ethers } from 'ethers';
// import { Connection, clusterApiUrl, Keypair, PublicKey } from '@solana/web3.js';
// import { Wormhole, Network, Chain, routes, ChainContext, TokenId } from "@wormhole-foundation/sdk-connect";
// import { EvmPlatform } from "@wormhole-foundation/sdk-evm";
// import { SolanaPlatform } from "@wormhole-foundation/sdk-solana";
// import { MayanRoute } from "../mayan_route/index";
// import { getStuff, TransferStuff } from "../utils";
// import axios from 'axios';
// import { Markup, Telegraf } from 'telegraf';
// import { MyContext } from '../index';
// import BigNumber from 'bignumber.js';
// import bs58 from 'bs58';
// import { ReferrerAddresses } from '@mayanfinance/swap-sdk';

// class MayanRefRoute<N extends Network> extends MayanRoute<N> {
//   override referrerAddress(): ReferrerAddresses | undefined {
//     return { evm: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" };
//   }
// }

// // Setup Wormhole
// const wh = new Wormhole("Mainnet", [EvmPlatform, SolanaPlatform]);
// const resolver = wh.resolver([MayanRefRoute]);

// interface ChainInfo {
//   name: string;
//   chain: ChainContext<Network, Chain>;
// }

// interface WalletData {
//   address: string;
//   private_key: string;
// }

// interface UserWalletData {
//   evm_wallet: WalletData;
//   solana_wallet: WalletData;
// }

// interface Balances {
//   eth: bigint;
//   arb: bigint;
//   base: bigint;
//   opt: bigint;
//   sol: number;
// }

// const supportedChains: ChainInfo[] = [
//   { name: "Ethereum", chain: wh.getChain("Ethereum") },
//   { name: "Solana", chain: wh.getChain("Solana") },
//   { name: "Base", chain: wh.getChain("Base") },
//   { name: "Optimism", chain: wh.getChain("Optimism") },
//   { name: "Arbitrum", chain: wh.getChain("Arbitrum") }
// ];

// const chainToNativeToken: { [key: string]: string } = {
//   "Ethereum": "ethereum",
//   "Solana": "solana",
//   "Base": "ethereum",
//   "Optimism": "ethereum",
//   "Arbitrum": "ethereum"
// };



// function setupProviders() {
//   return {
//     eth: new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
//     arb: new ethers.JsonRpcProvider(`https://arb-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
//     base: new ethers.JsonRpcProvider(`https://base-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
//     opt: new ethers.JsonRpcProvider(`https://opt-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
//     sol: new Connection(clusterApiUrl('mainnet-beta'), 'confirmed')
//   };
// }

// async function fetchBalances(providers: any, evmWallet: WalletData, solanaWallet: WalletData): Promise<Balances> {
//   try {
//     const [ethBalance, arbBalance, baseBalance, optBalance, solBalance] = await Promise.all([
//       providers.eth.getBalance(evmWallet.address).catch((e: Error) => {
//         console.error('Error fetching ETH balance:', e);
//         return 0n;
//       }),
//       providers.arb.getBalance(evmWallet.address).catch((e: Error) => {
//         console.error('Error fetching ARB balance:', e);
//         return 0n;
//       }),
//       providers.base.getBalance(evmWallet.address).catch((e: Error) => {
//         console.error('Error fetching BASE balance:', e);
//         return 0n;
//       }),
//       providers.opt.getBalance(evmWallet.address).catch((e: Error) => {
//         console.error('Error fetching OPT balance:', e);
//         return 0n;
//       }),
//       providers.sol.getBalance(new PublicKey(solanaWallet.address)).catch((e: Error) => {
//         console.error('Error fetching SOL balance:', e);
//         return 0;
//       }),
//     ]);

//     return {
//       eth: ethBalance,
//       arb: arbBalance,
//       base: baseBalance,
//       opt: optBalance,
//       sol: solBalance,
//     };
//   } catch (error) {
//     console.error('Error fetching balances:', error);
//     return {
//       eth: 0n,
//       arb: 0n,
//       base: 0n,
//       opt: 0n,
//       sol: 0,
//     };
//   }
// }



// async function getUsdPrice(chainName: string): Promise<number> {
//   try {
//     const tokenSymbol = chainToNativeToken[chainName];
//     if (!tokenSymbol) {
//       throw new Error(`Unknown chain: ${chainName}`);
//     }
//     const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${tokenSymbol}&vs_currencies=usd`);
//     return response.data[tokenSymbol].usd;
//   } catch (error) {
//     console.error('Error fetching price:', error);
//     return 0;
//   }
// }

// async function getUserWalletData(telegramId: string): Promise<UserWalletData> {
//   const response = await axios.get(`https://refuel-database.onrender.com/api/refuel/wallet/${telegramId}`);
//   return response.data;
// }

// async function getChainBalance(chain: ChainInfo, address: string, userWalletData: UserWalletData): Promise<{ nativeBalance: string, usdBalance: number }> {
//   const providers = setupProviders();
//   const balances = await fetchBalances(providers, userWalletData.evm_wallet, userWalletData.solana_wallet);

//   let balance: BigNumber;
//   let chainBalance: bigint | number;

//   switch (chain.name) {
//     case "Ethereum":
//       chainBalance = balances.eth;
//       break;
//     case "Arbitrum":
//       chainBalance = balances.arb;
//       break;
//     case "Base":
//       chainBalance = balances.base;
//       break;
//     case "Optimism":
//       chainBalance = balances.opt;
//       break;
//     case "Solana":
//       chainBalance = balances.sol;
//       break;
//     default:
//       throw new Error(`Unsupported chain: ${chain.name}`);
//   }

//   if (chain.name === "Solana") {
//     balance = new BigNumber(chainBalance.toString()).dividedBy(1e9); // Convert lamports to SOL
//   } else {
//     balance = new BigNumber(chainBalance.toString()).dividedBy(1e18); // Convert wei to ETH
//   }

//   const usdPrice = await getUsdPrice(chain.name);
//   const usdBalance = balance.multipliedBy(usdPrice).toNumber();

//   return {
//     nativeBalance: balance.toString(),
//     usdBalance
//   };
// }

// module.exports = (bot: Telegraf<MyContext>) => {
//   let sourceChain: ChainInfo | null = null;
//   let destChain: ChainInfo | null = null;

//   bot.action('refuel', async (ctx) => {
//     const telegramId = ctx.from?.id.toString();
//     if (!telegramId) {
//       await ctx.reply('Unable to identify user');
//       return;
//     }

//     const userWalletData = await getUserWalletData(telegramId);
//     const balances = await Promise.all(supportedChains.map(async (chain) => {
//       const address = chain.name === "Solana" ? userWalletData.solana_wallet.address : userWalletData.evm_wallet.address;
//       const { nativeBalance, usdBalance } = await getChainBalance(chain, address, userWalletData);
//       return `${chain.name}: ${nativeBalance} (≈$${usdBalance.toFixed(2)})`;
//     }));