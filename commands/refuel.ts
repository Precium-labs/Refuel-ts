import { ethers } from 'ethers';
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { Wormhole, Network, Chain, routes, ChainContext, TokenId } from "@wormhole-foundation/sdk-connect";
import { EvmPlatform } from "@wormhole-foundation/sdk-evm";
import { SolanaPlatform } from "@wormhole-foundation/sdk-solana";
import { MayanRoute } from "../mayan_route/index";
import { getStuff, TransferStuff } from "../utils";
import axios from 'axios';
import { Markup, Telegraf } from 'telegraf';
import { MyContext } from '../index';

// Setup Wormhole
const wh = new Wormhole("Mainnet", [EvmPlatform, SolanaPlatform]);
const resolver = wh.resolver([MayanRoute]);

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

// Define setupProviders function directly
function setupProviders() {
  return {
    eth: new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
    arb: new ethers.JsonRpcProvider(`https://arb-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
    base: new ethers.JsonRpcProvider(`https://base-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
    opt: new ethers.JsonRpcProvider(`https://opt-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
    sol: new Connection(clusterApiUrl('mainnet-beta'), 'confirmed')
  };
}

async function getUsdPrice(tokenSymbol: string): Promise<number> {
  try {
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

module.exports = (bot: Telegraf<MyContext>) => {
  let sourceChain: ChainInfo | null = null;
  let destChain: ChainInfo | null = null;

  bot.action('refuel', async (ctx) => {
    const keyboard = Markup.inlineKeyboard(
      supportedChains.map(chain => [Markup.button.callback(chain.name, `source_${chain.name}`)])
    );
    await ctx.editMessageText('Select source chain:', keyboard);
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
      await ctx.editMessageText(`Source: ${sourceChain!.name}\nDestination: ${chain.name}\nEnter amount in USD:`);
      bot.on('text', async (ctx) => {
        const amountUsd = parseFloat(ctx.message.text);
        if (isNaN(amountUsd)) {
          await ctx.reply('Please enter a valid number.');
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

      const telegramId = ctx.from?.id.toString();
      if (!telegramId) {
        throw new Error('Unable to identify user');
      }

      const userWalletData = await getUserWalletData(telegramId);

      // Define source and destination tokens
      const source: TokenId = { chain: sourceChain.chain.chain, address: "native" };
      const destination: TokenId = { chain: destChain.chain.chain, address: "native" };

      const sourcePrice = await getUsdPrice(sourceChain.name.toLowerCase());
      const amountInSourceToken = (amountUsd / sourcePrice).toString();

      const tr = await routes.RouteTransferRequest.create(wh, {
        source,
        destination,
      });

      const foundRoutes = await resolver.findRoutes(tr);
      const bestRoute = foundRoutes[0]!;

      const transferParams = {
        amount: amountInSourceToken,
        options: bestRoute.getDefaultOptions(),
      };

      let validated = await bestRoute.validate(tr, transferParams);
      if (!validated.valid) {
        throw new Error(validated.error.message);
      }

      const quote = await bestRoute.quote(tr, validated.params);
      if (!quote.success) {
        throw new Error(`Error fetching a quote: ${quote.error.message}`);
      }

      // Get the user's signer and address
      const senderStuff: TransferStuff<Network, Chain> = await getStuff(
        sourceChain.chain, 
        sourceChain.name === "Solana" ? userWalletData.solana_wallet.private_key : userWalletData.evm_wallet.private_key
      );
      const receiverStuff: TransferStuff<Network, Chain> = await getStuff(
        destChain.chain, 
        destChain.name === "Solana" ? userWalletData.solana_wallet.private_key : userWalletData.evm_wallet.private_key
      );

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
};
