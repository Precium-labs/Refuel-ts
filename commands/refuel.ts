import { Telegraf, Markup } from 'telegraf';
import { MyContext } from '../index';
import { ethers } from 'ethers';
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { Wormhole, Network, Chain, routes, ChainContext, TokenId } from "@wormhole-foundation/sdk-connect";
import { getStuff, TransferStuff } from "../utils";
import axios from 'axios';
import { ChainInfo, getUserState, performRefuel, wh } from '../helper_functions/refuel';



const supportedChains: ChainInfo[] = [
  { name: "Ethereum", chain: wh.getChain("Ethereum") },
  { name: "Solana", chain: wh.getChain("Solana") },
  { name: "Base", chain: wh.getChain("Base") },
  { name: "Optimism", chain: wh.getChain("Optimism") },
  { name: "Arbitrum", chain: wh.getChain("Arbitrum") }
];



// Helper function to get or create user state




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
        [Markup.button.callback('Back to Main Menu ⬅️', 'back_to_main')]
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
        [Markup.button.callback('Back to Main Menu ⬅️', 'back_to_main')]
      ]);
      await ctx.reply('Would you like to make another transaction?', keyboard);

    } catch (error) {
      console.error('Error in refuel:', error);

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Try Again', 'refuel')],
        [Markup.button.callback('👜 Check Balance', 'wallet')],
        [Markup.button.callback('Back to Main Menu ⬅️', 'back_to_main')]
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
