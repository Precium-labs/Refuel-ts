import { Telegraf, Markup } from 'telegraf';
import { MyContext } from '../index';
import { ethers } from 'ethers';
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { Wormhole, Network, Chain, routes, ChainContext, TokenId } from "@wormhole-foundation/sdk-connect";
import { EvmPlatform } from "@wormhole-foundation/sdk-evm";
import { SolanaPlatform } from "@wormhole-foundation/sdk-solana";
import { MayanRoute } from "../mayan_route/index";
import { getStuff, TransferStuff } from "../utils";
import axios from 'axios';
import BigNumber from 'bignumber.js';
import bs58 from 'bs58';
import { ReferrerAddresses } from '@mayanfinance/swap-sdk';

// Store user states in a map using telegram user ID as key
const userStates = new Map<string, {
  sourceChain: ChainInfo | null;
  destChain: ChainInfo | null;
  waitingForAmount: boolean;
}>();

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

// Helper function to get or create user state
function getUserState(userId: string) {
  if (!userStates.has(userId)) {
    userStates.set(userId, {
      sourceChain: null,
      destChain: null,
      waitingForAmount: false
    });
  }
  return userStates.get(userId)!;
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

async function getUserWalletData(telegramId: string) {
  const response = await axios.get(`https://refuel-gux8.onrender.com/api/refuel/wallet/${telegramId}`);
  return response.data;
}

// Export the command setup function
export = (bot: Telegraf<MyContext>) => {
  bot.action('refuel', async (ctx) => {
    if (!ctx.from) return;

    const userState = getUserState(ctx.from.id.toString());
    userState.sourceChain = null;
    userState.destChain = null;
    userState.waitingForAmount = false;

    const chainButtons = supportedChains.map(chain =>
      Markup.button.callback(chain.name, `source_${chain.name}`)
    );

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('👜 Check Balance', 'wallet')],
      ...chainButtons.map(button => [button]),
      [Markup.button.callback('Back to Main Menu ⬅️', 'back_to_main')]
    ]);

    await ctx.reply('Select source chain:', keyboard);
  });

  // Source chain selection handlers
  supportedChains.forEach(chain => {
    bot.action(`source_${chain.name}`, async (ctx) => {
      if (!ctx.from) return;

      const userState = getUserState(ctx.from.id.toString());
      userState.sourceChain = chain;
      userState.waitingForAmount = false;

      const keyboard = Markup.inlineKeyboard(
        supportedChains
          .filter(c => c.name !== chain.name)
          .map(c => [Markup.button.callback(c.name, `dest_${c.name}`)])
      );

      try {
        await ctx.editMessageText(`Source: ${chain.name}\nSelect destination chain:`, keyboard);
      } catch (error) {
        await ctx.reply(`Source: ${chain.name}\nSelect destination chain:`, keyboard);
      }
    });
  });

  // Destination chain selection handlers
  supportedChains.forEach(chain => {
    bot.action(`dest_${chain.name}`, async (ctx) => {
      if (!ctx.from) return;

      const userState = getUserState(ctx.from.id.toString());
      userState.destChain = chain;
      userState.waitingForAmount = true;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('👜 Check Balance', 'wallet')],
        [Markup.button.callback('🔄 Start Over', 'refuel')],
        [Markup.button.callback('Back to Main Menu', 'back_to_main')]
      ]);

      const message =
        `Source: ${userState.sourceChain?.name}\n` +
        `Destination: ${chain.name}\n\n` +
        `Bridging will take 1-3 minutes\n` +
        `Please enter amount in USD (minimum $2):`;

      try {
        await ctx.editMessageText(message, keyboard);
      } catch (error) {
        await ctx.reply(message, keyboard);
      }
    });
  });

  // Handle text messages for amount input
  bot.hears(/^\d+\.?\d*$/, async (ctx) => {
    if (!ctx.from) return;

    const userState = getUserState(ctx.from.id.toString());
    if (!userState.waitingForAmount || !userState.sourceChain || !userState.destChain) {
      return;
    }

    const amountUsd = parseFloat(ctx.message.text);

    if (amountUsd < 2) {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('👜 Check Balance', 'wallet')],
        [Markup.button.callback('🔄 Try Again', 'refuel')]
      ]);
      await ctx.reply('Minimum bridge amount is $2.', keyboard);
      return;
    }

    // Reset waiting state
    userState.waitingForAmount = false;

    await ctx.reply('Processing your transaction. This will take 1-3 minutes...');

    try {
      await performRefuel(ctx, amountUsd);

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Start Another Refuel', 'refuel')],
        [Markup.button.callback('👜 Check Balance', 'wallet')],
        [Markup.button.callback('Back to Main Menu', 'back_to_main')]
      ]);
      await ctx.reply('Would you like to make another transaction?', keyboard);

    } catch (error) {
      console.error('Error in refuel:', error);

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Try Again', 'refuel')],
        [Markup.button.callback('👜 Check Balance', 'wallet')],
        [Markup.button.callback('Back to Main Menu', 'back_to_main')]
      ]);

      await ctx.reply(
        'Failed to process the transaction. Please check your wallet balance and try again.',
        keyboard
      );

      // Reset state on error
      userState.sourceChain = null;
      userState.destChain = null;
      userState.waitingForAmount = false;
    }
  });
};


async function performRefuel(ctx: MyContext, amountUsd: number) {
  try {
    if (!ctx.from) {
      throw new Error('Unable to identify user');
    }

    const userState = getUserState(ctx.from.id.toString());
    const sourceChain = userState.sourceChain;
    const destChain = userState.destChain;

    if (!sourceChain || !destChain) {
      throw new Error('Source or destination chain not selected');
    }

    console.log(`Starting refuel from ${sourceChain.name} to ${destChain.name} for ${amountUsd} USD`);

    const telegramId = ctx.from.id.toString();
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

    const sourcePriceBN = new BigNumber(sourcePrice);
    const amountUsdBN = new BigNumber(amountUsd);
    let amountInSourceToken: string;

    if (sourceChain.name === "Solana") {
      const solAmount = amountUsdBN.dividedBy(sourcePriceBN);
      amountInSourceToken = solAmount.toString();
      console.log(`Amount in SOL: ${solAmount.toFixed(9)}`);
    } else {
      const ethAmount = amountUsdBN.dividedBy(sourcePriceBN);
      amountInSourceToken = ethAmount.toString();
      console.log(`Amount in ETH: ${ethAmount.toFixed(18)}`);
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
      throw new Error('Failed to prepare wallet information');
    }

    console.log('Sender details:', {
      chain: sourceChain.name,
      address: senderStuff.address,
      signerType: typeof senderStuff.signer
    });

    console.log('Receiver details:', {
      chain: destChain.name,
      address: receiverStuff.address,
      signerType: typeof receiverStuff.signer
    });

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

    // Format the receipt for display
    const formattedReceipt = {
      sourceChain: sourceChain.name,
      destinationChain: destChain.name,
      amount: `$${amountUsd}`,
      status: 'Completed',
      timestamp: new Date().toISOString()
    };

    await ctx.reply(
      '✅ Transfer completed successfully!\n\n' +
      `From: ${formattedReceipt.sourceChain}\n` +
      `To: ${formattedReceipt.destinationChain}\n` +
      `Amount: ${formattedReceipt.amount}\n` +
      `Status: ${formattedReceipt.status}\n` +
      `Time: ${new Date(formattedReceipt.timestamp).toLocaleString()}`
    );

  } catch (error) {
    console.error('Error in refuel:', error);
    if (error instanceof Error) {
      await ctx.reply(`❌ Error: ${error.message}`);
    } else {
      await ctx.reply('❌ An unknown error occurred. Please try again.');
    }
    throw error; // Re-throw to be handled by the calling function
  }
}