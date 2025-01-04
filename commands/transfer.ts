import { Telegraf, Markup } from 'telegraf';
import { ethers } from 'ethers';
import { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, Keypair, clusterApiUrl, Message } from '@solana/web3.js';
import axios from 'axios';
import { MyContext } from '../index';
import { isNumType } from '@wormhole-foundation/sdk-connect';
import setupProviders from '../helper_functions/providers';
import fetchBalances, { fetchPrices } from '../helper_functions/fetchBalances';
import { Balances, TransferResult, UserWalletData } from '../helper_functions/interfaces';
import { initiateTransfer } from '../helper_functions/transfer';
import { isValidAddress } from '../helper_functions/walletValidator';


const SUPPORTED_CHAINS = ['SOL', 'ETH', 'BASE', 'ARB', 'OPTIMISM'];


// Store user states in a map using telegram user ID as key
const userStates = new Map<string, {
    selectedChain: string | null;
    waitingForAmount: boolean;
    waitingForAddress: boolean;
    amountUSD?: number;
}>();

// Helper function to get or create user state
function getUserState(userId: string) {
    if (!userStates.has(userId)) {
        userStates.set(userId, {
            selectedChain: null,
            waitingForAmount: false,
            waitingForAddress: false
        });
    }
    return userStates.get(userId)!;
}


module.exports = (bot: Telegraf<MyContext>) => {
    // Debug handler
    bot.use((ctx, next) => {
        console.log('=== New Message ===');
        console.log('Update type:', ctx.updateType);
        console.log('Message:', ctx.message);
        return next();
    });

    // Handler for numeric inputs with $ prefix
    bot.hears(/^\$?\d+\.?\d*$/, async (ctx) => {
        console.log('=== Numeric Handler ===');
        if (!ctx.from) return;

        const userState = getUserState(ctx.from.id.toString());
        console.log('User state in numeric handler:', userState);

        if (userState.waitingForAmount && userState.selectedChain) {
            // Remove $ sign if present and parse the amount
            const amountStr = ctx.message.text.replace('$', '');
            const amount = parseFloat(amountStr);
            console.log('Parsed amount:', amount);

            if (isNaN(amount) || amount < 1) {
                await ctx.reply('Please enter a valid amount (minimum $1).');
                return;
            }

            userState.amountUSD = amount;
            userState.waitingForAmount = false;
            userState.waitingForAddress = true;

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('Cancel Transfer', 'transfer')]
            ]);

            await ctx.reply('Please enter the recipient address:', keyboard);
        }
    });

    // Fixed text message handler for addresses
    bot.on('text', async (ctx) => {
        console.log('=== Text Message Handler ===');
        if (!ctx.from) return;

        const userState = getUserState(ctx.from.id.toString());
        console.log('User state in text handler:', userState);

        // Skip if it's a numeric input (already handled by the other handler)
        if (ctx.message.text.match(/^\$?\d+\.?\d*$/)) {
            return;
        }

        // Only process if we're waiting for an address and have both chain and amount
        if (userState.waitingForAddress && userState.selectedChain && userState.amountUSD) {
            const address = ctx.message.text;
            console.log('Processing address:', address);

            if (!isValidAddress(address, userState.selectedChain)) {
                await ctx.reply('Invalid address. Please enter a valid address.');
                return;
            }

            await ctx.reply('Processing your transfer. This will take a moment...');

            try {
                await initiateTransfer(ctx, userState.selectedChain, userState.amountUSD, address);

                // Add a keyboard after successful transfer
                const keyboard = Markup.inlineKeyboard([
                    [Markup.button.callback('Make Another Transfer', 'transfer')],
                    [Markup.button.callback('Check Balance', 'wallet')],
                    [Markup.button.callback('Back to Main Menu ⬅️', 'back_to_main')]
                ]);

                await ctx.reply('Would you like to make another transfer?', keyboard);

            } catch (error) {
                console.error('Transfer error:', error);
                const keyboard = Markup.inlineKeyboard([
                    [Markup.button.callback('Try Again', 'transfer')],
                    [Markup.button.callback('Back to Main Menu ⬅️', 'back_to_main')]
                ]);
                await ctx.reply('Transfer failed. Please try again.', keyboard);
            }

            // Reset user state after transfer attempt
            userState.selectedChain = null;
            userState.waitingForAmount = false;
            userState.waitingForAddress = false;
            userState.amountUSD = undefined;
        }
    });

    // Original transfer action handler
    bot.action('transfer', async (ctx) => {
        if (!ctx.from) return;
        console.log('=== Transfer Action ===');

        const userState = getUserState(ctx.from.id.toString());
        // Reset state when starting new transfer
        userState.selectedChain = null;
        userState.waitingForAmount = false;
        userState.waitingForAddress = false;
        userState.amountUSD = undefined;

        const chainButtons = SUPPORTED_CHAINS.map(chain =>
            Markup.button.callback(chain, `select_chain_${chain}`)
        );

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('👜 Check Balance', 'wallet')],
            ...chainButtons.map(button => [button]),
            [Markup.button.callback('Back to Main Menu ⬅️', 'back_to_main')]
        ]);

        await ctx.reply('Select chain to transfer from:', keyboard);
    });

    // Chain selection handlers
    SUPPORTED_CHAINS.forEach(chain => {
        bot.action(`select_chain_${chain}`, async (ctx) => {
            if (!ctx.from) return;
            console.log('=== Chain Selection ===');
            console.log(`Chain ${chain} selected for user ${ctx.from.id}`);

            const userState = getUserState(ctx.from.id.toString());
            userState.selectedChain = chain;
            userState.waitingForAmount = true;
            userState.waitingForAddress = false;
            userState.amountUSD = undefined;

            console.log('Updated state after chain selection:', userState);

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('Cancel', 'transfer')]
            ]);

            await ctx.reply(`Selected chain: ${chain}\n\nPlease enter amount In this from $amount(e.g. $15):`, keyboard);
            await ctx.answerCbQuery();
        });
    });

}

export { };