import { ethers } from 'ethers';
import { Connection, clusterApiUrl, Keypair } from '@solana/web3.js';
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
import { ReferrerAddresses } from '@mayanfinance/swap-sdk'

class MayanRefRoute<N extends Network> extends MayanRoute<N> {
   override referrerAddress(): ReferrerAddresses | undefined {
     return {
       solana: "EFFkREkW7DjubGzkXAYt3xCqz4rWuLJjY1L2yD9Mtuym",
       evm: "0x9319b3c6B01df3e375abdB3Be42DA19C558D3E69" 
    };
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
  const response = await axios.get(`https://refuel-gux8.onrender.com/api/refuel/wallet/${telegramId}`);
  return response.data;
}

module.exports = (bot: Telegraf<MyContext>) => {
  let sourceChain: ChainInfo | null = null;
  let destChain: ChainInfo | null = null;

  bot.action('refuel', async (ctx) => {
    const walletButton = Markup.button.callback('Check Balance', 'wallet');
    const chainButtons = supportedChains.map(chain => Markup.button.callback(chain.name, `source_${chain.name}`));
    
    const keyboard = Markup.inlineKeyboard([
      [walletButton],  // Wallet button on the first row
      ...chainButtons.map(button => [button])  // Each chain button on a separate row
    ]);
  
    await ctx.reply('Select source chain:', keyboard);
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
      const keyboard = Markup.inlineKeyboard([Markup.button.callback(`👜Check Balance`, 'wallet')]);
      destChain = chain;
      await ctx.editMessageText(`Source: ${sourceChain!.name}\nDestination: ${chain.name}\nBridging would take 1-3 minutes \nEnter amount in USD (minimum $2):`);
      bot.on('text', async (ctx) => {
        const amountUsd = parseFloat(ctx.message.text);
        if (isNaN(amountUsd)) {
          await ctx.reply('Please enter a valid number.');
          return;
        }
        if (amountUsd < 2) {
          await ctx.reply('Minimum bridge amount is $2.', keyboard);
          return;
        }
        await ctx.reply('Transaction processing. It will take 1-3 minutes for the transaction to be completed.');
        
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
  
      // Define source and destination tokens
      const source: TokenId = { chain: sourceChain.chain.chain, address: "native" };
      const destination: TokenId = { chain: destChain.chain.chain, address: "native" };
  
      const sourcePrice = await getUsdPrice(sourceChain.name);
      console.log(`Price for ${sourceChain.name}: ${sourcePrice} USD`);
  
      if (sourcePrice === 0) {
        throw new Error(`Unable to fetch price for ${sourceChain.name}`);
      }
  
      if (amountUsd <= 0) {
        throw new Error('Amount must be greater than 0');
      }
  
      const sourcePriceBN = new BigNumber(sourcePrice);
      const amountUsdBN = new BigNumber(amountUsd);
      let amountInSourceToken: string;
  
      if (sourceChain.name === "Solana") {
        // For Solana, convert to lamports (1 SOL = 1e9 lamports)
        const solAmount = amountUsdBN.dividedBy(sourcePriceBN);
        amountInSourceToken = solAmount.toString();
        console.log(`Amount in SOL: ${solAmount.toFixed(9)}`);
        console.log(`Amount in lamports: ${amountInSourceToken}`);
      } else {
        // For EVM chains, convert to wei (1 ETH = 1e18 wei)
        const ethAmount = amountUsdBN.dividedBy(sourcePriceBN);
        amountInSourceToken = ethAmount.toString();
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
          console.log("private",senderPrivateKey)
        } else {
          senderStuff = await getStuff(sourceChain.chain, userWalletData.evm_wallet.private_key);
        }
  
        if (destChain.name === "Solana") {
          const privateKey = userWalletData.solana_wallet.private_key;
          const privateKeyBuffer = Buffer.from(privateKey, 'hex');
          const recieverPrivateKey = bs58.encode(privateKeyBuffer);
          receiverStuff = await getStuff(destChain.chain, recieverPrivateKey );
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
        await ctx.reply(`Insufficient Balance Please Fund your Wallet`);
      } else {
        await ctx.reply('An unknown error occurred.');
      }
    }
  }  
};