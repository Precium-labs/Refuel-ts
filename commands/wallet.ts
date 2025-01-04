import axios from 'axios';
import { Markup, Telegraf, Context } from 'telegraf';
import { ethers } from 'ethers';
import { Keypair, PublicKey, Connection, clusterApiUrl } from '@solana/web3.js';
import { Balances, Prices, UserWalletData, WalletData } from '../helper_functions/interfaces';
import setupProviders from '../helper_functions/providers';
import fetchBalances, { fetchPrices } from '../helper_functions/fetchBalances';
import { createNewEVMWallet, createNewSolanaWallet, fetchWalletData, generateWalletMessage } from '../helper_functions/wallets';


// Function to generate wallet info message
async function generateWalletInfo(walletData: UserWalletData) {
    const providers = setupProviders();
    const balances = await fetchBalances(providers, walletData.evm_wallet, walletData.solana_wallet);
    const prices = await fetchPrices();
  
    // Convert formatted balances from string to number for arithmetic operations
    const ethBalance = parseFloat(ethers.formatEther(balances.eth));
    const arbBalance = parseFloat(ethers.formatEther(balances.arb));
    const baseBalance = parseFloat(ethers.formatEther(balances.base));
    const optBalance = parseFloat(ethers.formatEther(balances.opt));
    const solBalance = balances.sol / 1e9; // Convert lamports to SOL (Solana's base unit)
  
    return `Your current wallets:\n\n` +
           `EVM Wallet:\n` +
           `Address: \`${walletData.evm_wallet.address}\`\n` +
           `Private Key: \`${walletData.evm_wallet.private_key}\`\n\n` +
           `Solana Wallet:\n` +
           `Address: \`${walletData.solana_wallet.address}\`\n` +
           `Private Key: \`${walletData.solana_wallet.private_key}\`\n\n` +
           `Balances:\n` +
           `ETH: \`${ethBalance}\` ETH ($${(ethBalance * prices.eth).toFixed(2)})\n` +
           `ARB: \`${arbBalance}\` ETH ($${(arbBalance * prices.eth).toFixed(2)})\n` +
           `BASE: \`${baseBalance}\` ETH ($${(baseBalance * prices.eth).toFixed(2)})\n` +
           `OPT: \`${optBalance}\` ETH ($${(optBalance * prices.eth).toFixed(2)})\n` +
           `SOL: \`${solBalance}\` SOL ($${(solBalance * prices.sol).toFixed(2)})\n`;
  }
  



// Function to offer creating new wallets
function offerCreateWallets(ctx: Context) {
  const message = "You don't have any wallets set up yet. Would you like to create a new wallet?";
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Create EVM Wallet', 'create_evm_wallet')],
    [Markup.button.callback('Create Solana Wallet', 'create_solana_wallet')],
    [Markup.button.callback('No, go back', 'back_to_main')]
  ]);
  return ctx.editMessageText(message, keyboard);
}

module.exports = (bot: Telegraf<Context>) => {
  bot.action('wallet', async (ctx) => {
    try {
      await ctx.answerCbQuery('Wallet');
      
      const telegramId = ctx.from.id.toString();
      const userWalletData = await fetchWalletData(telegramId);
      
      if (!userWalletData || !userWalletData.evm_wallet || !userWalletData.solana_wallet) {
        // No wallet data found, offer to create new wallets
        return offerCreateWallets(ctx);
      }
      
      // Display current wallet info and options
      const message = await generateWalletInfo(userWalletData);
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Create New EVM Wallet', 'create_evm_wallet')],
        [Markup.button.callback('Create New Solana Wallet', 'create_solana_wallet')],
        [Markup.button.callback('Back to Main Menu', 'back_to_main')]
      ]);
      
      await ctx.reply(message, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
      console.error('Error handling Wallet button:', error);
      const err = error as Error; // Type assertion
      ctx.reply(`Error processing the request: ${err.message}`);
    }
  });

  bot.action('create_evm_wallet', async (ctx) => {
    await ctx.answerCbQuery();
    const warningMessage = "⚠️ Warning: Creating a new EVM wallet will replace your current EVM wallet. Are you sure you want to proceed?";
    const confirmKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Yes, create new EVM wallet', 'confirm_create_evm_wallet')],
      [Markup.button.callback('No, keep my current wallet', 'wallet')],
      [Markup.button.callback('Back to Main Menu', 'back_to_main')]
    ]);
    await ctx.editMessageText(warningMessage, confirmKeyboard);
  });

  bot.action('create_solana_wallet', async (ctx) => {
    await ctx.answerCbQuery();
    const warningMessage = "⚠️ Warning: Creating a new Solana wallet will replace your current Solana wallet. Are you sure you want to proceed?";
    const confirmKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Yes, create new Solana wallet', 'confirm_create_solana_wallet')],
      [Markup.button.callback('No, keep my current wallet', 'wallet')],
      [Markup.button.callback('Back to Main Menu', 'back_to_main')]
    ]);
    await ctx.editMessageText(warningMessage, confirmKeyboard);
  });

  bot.action('confirm_create_evm_wallet', async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id.toString();
    const { address } = await createNewEVMWallet(telegramId);
    await ctx.editMessageText(`A new EVM wallet has been created. Your new wallet address is: \`${address}\``, { parse_mode: 'Markdown' });
  });

  bot.action('confirm_create_solana_wallet', async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id.toString();
    const { address } = await createNewSolanaWallet(telegramId);
    await ctx.editMessageText(`A new Solana wallet has been created. Your new wallet address is: \`${address}\``, { parse_mode: 'Markdown' });
  });

  bot.action('back_to_main', async (ctx) => {
    try {
      await ctx.answerCbQuery('Returning to main menu');
      
      const firstName = ctx.from.username || 'User';
      const telegramId = ctx.from.id.toString();
  
      const Homekeyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(`⛽Refuel`, 'refuel'),
          Markup.button.callback(`👜Wallet`, 'wallet'),
          Markup.button.callback(`Transfer`, 'transfer'),
        ],
        [
          Markup.button.callback(`🆘Help`, 'help'),
          Markup.button.callback(`⚙️Settings`, 'settings'),
        ],
        [
          Markup.button.callback(`👥Refer Friends`, 'referral'),
        ],
        [
          Markup.button.callback(`♻️Refresh`, 'refresh'),
        ],
      ]);
  
      // Fetch wallet data
      const userWalletData = await fetchWalletData(telegramId);
  
      if (!userWalletData || !userWalletData.evm_wallet || !userWalletData.solana_wallet) {
        throw new Error('Invalid wallet data');
      }
  
      const evmWallet = userWalletData.evm_wallet;
      const solanaWallet = userWalletData.solana_wallet;
  
      const providers = setupProviders();
      const balances = await fetchBalances(providers, evmWallet, solanaWallet);
      const prices = await fetchPrices();
  
      const message = generateWalletMessage(firstName, evmWallet, solanaWallet, balances, prices);
  
      // Use editMessageText if we're responding to a callback query
      if (ctx.callbackQuery) {
        await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: Homekeyboard.reply_markup });
      } else {
        // If it's not a callback query (e.g., called directly), use reply
        await ctx.reply(message, { parse_mode: 'Markdown', ...Homekeyboard });
      }
    } catch (error) {
      console.error('Error in back_to_main handler:', error);
      const err = error as Error; // Type assertion
      await ctx.reply(`Error returning to main menu: ${err.message}`);
    }
  });
};


