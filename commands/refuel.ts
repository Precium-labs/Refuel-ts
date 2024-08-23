import { ethers } from 'ethers';
import { Connection, clusterApiUrl, Keypair, PublicKey } from '@solana/web3.js';
import { Wormhole, Network, Chain, routes, ChainContext, TokenId } from "@wormhole-foundation/sdk-connect";
import { EvmPlatform } from "@wormhole-foundation/sdk-evm";
import { SolanaPlatform } from "@wormhole-foundation/sdk-solana";
import { MayanRoute } from "../mayan_route/index";
import { getStuff, TransferStuff } from "../utils";
import axios from 'axios';
import { Markup, Telegraf } from 'telegraf';
import { MyContext } from '../index';
import BigNumber from 'bignumber.js';
import bs58 from 'bs58';
import { ReferrerAddresses } from '@mayanfinance/swap-sdk';

class MayanRefRoute<N extends Network> extends MayanRoute<N> {
  override referrerAddress(): ReferrerAddresses | undefined {
    return { evm: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" };
  }
}

// Setup Wormhole
const wh = new Wormhole("Mainnet", [EvmPlatform, SolanaPlatform]);
const resolver = wh.resolver([MayanRefRoute]);

interface ChainInfo {
  name: string;
  chain: ChainContext<Network, Chain>;
}

interface WalletData {
  address: string;
  private_key: string;
}

interface UserWalletData {
  evm_wallet: WalletData;
  solana_wallet: WalletData;
}

interface Balances {
  eth: bigint;
  arb: bigint;
  base: bigint;
  opt: bigint;
  sol: number;
}

const supportedChains: ChainInfo[] = [
  { name: "Ethereum", chain: wh.getChain("Ethereum") },
  { name: "Solana", chain: wh.getChain("Solana") },
  { name: "Base", chain: wh.getChain("Base") },
  { name: "Optimism", chain: wh.getChain("Optimism") },
  { name: "Arbitrum", chain: wh.getChain("Arbitrum") }
];

const chainToNativeToken: { [key: string]: string } = {
  "Ethereum": "ethereum",
  "Solana": "solana",
  "Base": "ethereum",
  "Optimism": "ethereum",
  "Arbitrum": "ethereum"
};



function setupProviders() {
  return {
    eth: new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
    arb: new ethers.JsonRpcProvider(`https://arb-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
    base: new ethers.JsonRpcProvider(`https://base-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
    opt: new ethers.JsonRpcProvider(`https://opt-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
    sol: new Connection(clusterApiUrl('mainnet-beta'), 'confirmed')
  };
}

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



async function getUsdPrice(chainName: string): Promise<number> {
  try {
    const tokenSymbol = chainToNativeToken[chainName];
    if (!tokenSymbol) {
      throw new Error(`Unknown chain: ${chainName}`);
    }
    const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${tokenSymbol}&vs_currencies=usd`);
    return response.data[tokenSymbol].usd;
  } catch (error) {
    console.error('Error fetching price:', error);
    return 0;
  }
}

async function getUserWalletData(telegramId: string): Promise<UserWalletData> {
  const response = await axios.get(`https://refuel-database.onrender.com/api/refuel/wallet/${telegramId}`);
  return response.data;
}

async function getChainBalance(chain: ChainInfo, address: string, userWalletData: UserWalletData): Promise<{ nativeBalance: string, usdBalance: number }> {
  const providers = setupProviders();
  const balances = await fetchBalances(providers, userWalletData.evm_wallet, userWalletData.solana_wallet);

  let balance: BigNumber;
  let chainBalance: bigint | number;

  switch (chain.name) {
    case "Ethereum":
      chainBalance = balances.eth;
      break;
    case "Arbitrum":
      chainBalance = balances.arb;
      break;
    case "Base":
      chainBalance = balances.base;
      break;
    case "Optimism":
      chainBalance = balances.opt;
      break;
    case "Solana":
      chainBalance = balances.sol;
      break;
    default:
      throw new Error(`Unsupported chain: ${chain.name}`);
  }

  if (chain.name === "Solana") {
    balance = new BigNumber(chainBalance.toString()).dividedBy(1e9); // Convert lamports to SOL
  } else {
    balance = new BigNumber(chainBalance.toString()).dividedBy(1e18); // Convert wei to ETH
  }

  const usdPrice = await getUsdPrice(chain.name);
  const usdBalance = balance.multipliedBy(usdPrice).toNumber();

  return {
    nativeBalance: balance.toString(),
    usdBalance
  };
}

module.exports = (bot: Telegraf<MyContext>) => {
  let sourceChain: ChainInfo | null = null;
  let destChain: ChainInfo | null = null;

  bot.action('refuel', async (ctx) => {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.reply('Unable to identify user');
      return;
    }

    const userWalletData = await getUserWalletData(telegramId);
    const balances = await Promise.all(supportedChains.map(async (chain) => {
      const address = chain.name === "Solana" ? userWalletData.solana_wallet.address : userWalletData.evm_wallet.address;
      const { nativeBalance, usdBalance } = await getChainBalance(chain, address, userWalletData);
      return `${chain.name}: ${nativeBalance} (≈$${usdBalance.toFixed(2)})`;
    }));

    const balanceMessage = "Your balances:\n" + balances.join("\n");
    
    const keyboard = Markup.inlineKeyboard(
      supportedChains.map(chain => [Markup.button.callback(chain.name, `source_${chain.name}`)])
    );
    
    await ctx.reply(balanceMessage + "\n\nSelect source chain:", keyboard);
  });

  supportedChains.forEach(chain => {
    bot.action(`source_${chain.name}`, async (ctx) => {
      sourceChain = chain;
      const keyboard = Markup.inlineKeyboard(
        supportedChains.filter(c => c.name !== chain.name).map(c => [Markup.button.callback(c.name, `dest_${c.name}`)])
      );
      await ctx.editMessageText(`Source: ${chain.name}\nSelect destination chain:`, keyboard);
    });
  });

  supportedChains.forEach(chain => {
    bot.action(`dest_${chain.name}`, async (ctx) => {
      destChain = chain;
      await ctx.editMessageText(`Source: ${sourceChain!.name}\nDestination: ${chain.name}\nEnter amount in USD (minimum $2):`);
      bot.on('text', async (ctx) => {
        const amountUsd = parseFloat(ctx.message.text);
        if (isNaN(amountUsd)) {
          await ctx.reply('Please enter a valid number.');
          return;
        }
        if (amountUsd < 2) {
          await ctx.reply('Minimum bridge amount is $2.');
          return;
        }
        await performRefuel(ctx, amountUsd);
      });
    });
  });

  
async function performRefuel(ctx: MyContext, amountUsd: number) {
  try {
    if (!sourceChain || !destChain) {
      throw new Error('Source or destination chain not selected');
    }

    console.log(`Starting refuel from ${sourceChain.name} to ${destChain.name} for ${amountUsd} USD`);

    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      throw new Error('Unable to identify user');
    }

    const userWalletData = await getUserWalletData(telegramId);
    console.log('User wallet data retrieved');

    // Get balances for both source and destination chains
    const sourceAddress = sourceChain.name === "Solana" ? userWalletData.solana_wallet.address : userWalletData.evm_wallet.address;
    const destAddress = destChain.name === "Solana" ? userWalletData.solana_wallet.address : userWalletData.evm_wallet.address;

    const sourceBalance = await getChainBalance(sourceChain, sourceAddress, userWalletData);
    const destBalance = await getChainBalance(destChain, destAddress, userWalletData);


    await ctx.reply(
      `Current balances:\n` +
      `${sourceChain.name}: ${sourceBalance.nativeBalance} (≈$${sourceUsdBalance.toFixed(2)})\n` +
      `${destChain.name}: ${destBalance.nativeBalance} (≈$${destUsdBalance.toFixed(2)})\n\n` +
      `Initiating transfer of $${amountUsd.toFixed(2)}...`
    );


    // Define source and destination tokens
    const source: TokenId = { chain: sourceChain.chain.chain, address: "native" };
    const destination: TokenId = { chain: destChain.chain.chain, address: "native" };

    console.log(`Price for ${sourceChain.name}: ${sourcePrice} USD`);

    const sourcePriceBN = new BigNumber(sourcePrice);
    const amountUsdBN = new BigNumber(amountUsd);
    let amountInSourceToken: string;

    if (sourceChain.name === "Solana") {
      // For Solana, convert to lamports (1 SOL = 1e9 lamports)
      const solAmount = amountUsdBN.dividedBy(sourcePriceBN);
      amountInSourceToken = solAmount.multipliedBy(1e9).toFixed(0);
      console.log(`Amount in SOL: ${solAmount.toFixed(9)}`);
      console.log(`Amount in lamports: ${amountInSourceToken}`);
    } else {
      // For EVM chains, convert to wei (1 ETH = 1e18 wei)
      const ethAmount = amountUsdBN.dividedBy(sourcePriceBN);
      amountInSourceToken = ethAmount.multipliedBy(1e18).toFixed(0);
      console.log(`Amount in ETH: ${ethAmount.toFixed(18)}`);
      console.log(`Amount in wei: ${amountInSourceToken}`);
    }

    console.log(`Amount in source token: ${amountInSourceToken}`);

    const tr = await routes.RouteTransferRequest.create(wh, {
      source,
      destination,
    });

    console.log('Route transfer request created');

    const foundRoutes = await resolver.findRoutes(tr);
    console.log(`Found ${foundRoutes.length} routes`);

    const bestRoute = foundRoutes[0]!;
    console.log('Selected best route');

    const transferParams = {
      amount: amountInSourceToken,
      options: bestRoute.getDefaultOptions(),
    };

    console.log('Transfer params:', transferParams);

    let validated = await bestRoute.validate(tr, transferParams);
    if (!validated.valid) {
      throw new Error(validated.error.message);
    }
    console.log('Route validated');

    const quote = await bestRoute.quote(tr, validated.params);
    if (!quote.success) {
      throw new Error(`Error fetching a quote: ${quote.error.message}`);
    }
    console.log('Quote received:', quote);

    // Get the user's signer and address
    let senderStuff: TransferStuff<Network, Chain>;
    let receiverStuff: TransferStuff<Network, Chain>;

    try {
      if (sourceChain.name === "Solana") {
        const privateKey = userWalletData.solana_wallet.private_key;
        const privateKeyBuffer = Buffer.from(privateKey, 'hex');
        const senderPrivateKey = bs58.encode(privateKeyBuffer);
        senderStuff = await getStuff(sourceChain.chain, senderPrivateKey);
        console.log("private", senderPrivateKey);
      } else {
        senderStuff = await getStuff(sourceChain.chain, userWalletData.evm_wallet.private_key);
      }

      if (destChain.name === "Solana") {
        const privateKey = userWalletData.solana_wallet.private_key;
        const privateKeyBuffer = Buffer.from(privateKey, 'hex');
        const receiverPrivateKey = bs58.encode(privateKeyBuffer);
        receiverStuff = await getStuff(destChain.chain, receiverPrivateKey);
      } else {
        receiverStuff = await getStuff(destChain.chain, userWalletData.evm_wallet.private_key);
      }
    } catch (error) {
      console.error('Error preparing wallet stuff:', error);
      throw new Error('Failed to prepare wallet information. Please check your wallet keys.');
    }

    console.log('Sender details:');
    console.log('Chain:', sourceChain.name);
    console.log('Address:', senderStuff.address);
    console.log('Signer type:', typeof senderStuff.signer);

    console.log('Receiver details:');
    console.log('Chain:', destChain.name);
    console.log('Address:', receiverStuff.address);
    console.log('Signer type:', typeof receiverStuff.signer);

    console.log('Sender and receiver stuff prepared');

    // Initiate the transfer
    const receipt = await bestRoute.initiate(
      tr,
      senderStuff.signer,
      quote,
      receiverStuff.address
    );
    console.log("Initiated transfer with receipt: ", receipt);

    // Check and complete the transfer
    await routes.checkAndCompleteTransfer(
      bestRoute,
      receipt,
      receiverStuff.signer,
      15 * 60 * 1000
    );

    console.log('Transfer completed');

    await ctx.reply(`Transfer initiated successfully. Receipt: ${JSON.stringify(receipt)}`);

  } catch (error) {
    console.error('Error in refuel:', error);

    if (error instanceof Error) {
      await ctx.reply(`An error occurred: ${error.message}`);
    } else {
      await ctx.reply('An unknown error occurred.');
    }
  }
}
}
