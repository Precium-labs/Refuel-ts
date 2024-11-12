import { Telegraf, Markup } from 'telegraf';
import { MyContext } from '../index.mts';
import axios from 'axios';
import { ethers } from 'ethers';
import { Keypair, Connection, clusterApiUrl, PublicKey } from '@solana/web3.js';

import dotenv from "dotenv"

dotenv.config();

const API_KEY = process.env.ALCHEMY_API

interface UserSettings {
    telegramId: string;
    language: string;
}

interface Prices {
    eth: number;
    sol: number;
}

interface Balances {
    eth: bigint;
    arb: bigint;
    base: bigint;
    opt: bigint;
    sol: number;
}

interface WalletData {
    address: string;
    private_key: string;
    seed_phrase?: string;
}

function setupProviders() {
    return {
        eth: new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${API_KEY}`),
        arb: new ethers.JsonRpcProvider(`https://arb-mainnet.g.alchemy.com/v2/${API_KEY}`),
        base: new ethers.JsonRpcProvider(`https://base-mainnet.g.alchemy.com/v2/${API_KEY}`),
        opt: new ethers.JsonRpcProvider(`https://opt-mainnet.g.alchemy.com/v2/${API_KEY}`),
        sol: new Connection(clusterApiUrl('mainnet-beta'), 'confirmed')
    };
}

async function fetchPrices(): Promise<Prices> {
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

function generateWalletMessage(
    firstName: string,
    evmWallet: WalletData,
    solanaWallet: WalletData,
    balances: Balances,
    prices: Prices
): string {
    const formatBalance = (balance: bigint, decimals = 18): string => {
        if (!balance || balance === 0n) return '0';
        return (Number(balance) / Math.pow(10, decimals)).toFixed(decimals);
    };

    const evmAddress = `<code>${evmWallet.address}</code>`;
    const solanaAddress = `<code>${solanaWallet.address}</code>`;

    const ethBalance = parseFloat(ethers.formatEther(balances.eth));
    const arbBalance = parseFloat(ethers.formatEther(balances.arb));
    const baseBalance = parseFloat(ethers.formatEther(balances.base));
    const optBalance = parseFloat(ethers.formatEther(balances.opt));
    const solBalance = balances.sol / 1e9; // Convert lamports to SOL (Solana's base unit)

    return `@${firstName} <b>Welcome</b> to <b>Refuel Bot</b> ⛽️\n\n` +
        `The <b>Fastest</b>⚡ and most <b>Reliable</b>🛡️ way to get <b>Gas</b> into your wallet \n<b>Leveraging on Wormhole Technologies</b> \n\n` +
        `<b>🔗These are your wallets and their Balance:</b>\n\n` +
        `<b>EVM Wallet</b>\n` +
        `Address: ${evmAddress}\n\n` +
        `<b>Solana Wallet</b>\n` +
        `Address: ${solanaAddress}\n\n` +
        `<b>Wallet Balance</b>\n` +
        `ETH: <code>${ethBalance}</code> ETH ($${(parseFloat(formatBalance(balances.eth)) * prices.eth).toFixed(2)})\n` +
        `Arbitrum: <code>${arbBalance}</code> ETH ($${(parseFloat(formatBalance(balances.arb)) * prices.eth).toFixed(2)})\n` +
        `Base: <code>${baseBalance}</code> ETH ($${(parseFloat(formatBalance(balances.base)) * prices.eth).toFixed(2)})\n` +
        `Optimism: <code>${optBalance}</code> ETH ($${(parseFloat(formatBalance(balances.opt)) * prices.eth).toFixed(2)})\n` +
        `Solana: <code>${solBalance}</code> SOL ($${((balances.sol / 1e9) * prices.sol).toFixed(2)})\n\n` +
        `<b>Current Prices:</b>\n` +
        `ETH: $${prices.eth}\n` +
        `SOL: $${prices.sol}\n\n` +
        `<b>Supported Chains:</b>\n` +
        `<b>ETH</b>-<b>SOL</b>-<b>BASE</b>-<b>OPTIMISM</b>-<b>ARBITRUM</b>\n`;
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

async function getUserSettings(telegramId: string): Promise<UserSettings> {
    try {
        const response = await axios.get(`https://refuel-gux8.onrender.com/api/refuel/settings/${telegramId}`);
        return response.data;
    } catch (error) {
        console.error('Error fetching user settings:', error);
        return {
            telegramId,
            language: 'en',
        };
    }
}

async function updateUserSettings(settings: UserSettings): Promise<void> {
    try {
        await axios.post('https://refuel-gux8.onrender.com/api/refuel/settings', settings);
    } catch (error) {
        console.error('Error updating user settings:', error);
        throw new Error('Failed to update settings. Please try again later.');
    }
}

module.exports = (bot: Telegraf<MyContext>) => {
    bot.action('settings', async (ctx) => {
        const telegramId = ctx.from?.id.toString() || '';
        const settings = await getUserSettings(telegramId);

        const settingsKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback(`Language: ${settings.language}`, 'change_language')],
            [Markup.button.callback('Coming Soon Features', 'coming_soon')],
            [Markup.button.callback('Back to Main Menu', 'back_to_main')],
        ]);

        await ctx.editMessageText('Settings:', settingsKeyboard);
    });

    bot.action('change_language', async (ctx) => {
        const languageKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback('English', 'set_lang_en')],
            [Markup.button.callback('Español', 'set_lang_es')],
            [Markup.button.callback('Back to Settings', 'settings')],
        ]);

        await ctx.editMessageText('Choose your language:', languageKeyboard);
    });

    bot.action(/^set_lang_(.+)$/, async (ctx) => {
        const telegramId = ctx.from?.id.toString() || '';
        const newLang = ctx.match[1];
        const settings = await getUserSettings(telegramId);
        settings.language = newLang;
        await updateUserSettings(settings);
        await ctx.answerCbQuery(`Language set to ${newLang}`);
        await ctx.editMessageText('Settings updated. Returning to settings menu...');

        // Use a timeout to simulate a delay, then call the settings action
        setTimeout(async () => {
            await ctx.answerCbQuery(); // Clear any pending callback query
            await handleSettingsAction(ctx);
        }, 1500);
    });

    // Define a separate function to handle the settings action
    async function handleSettingsAction(ctx: MyContext) {
        const telegramId = ctx.from?.id.toString() || '';
        const settings = await getUserSettings(telegramId);

        const settingsKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback(`Language: ${settings.language}`, 'change_language')],
            [Markup.button.callback('Coming Soon Features', 'coming_soon')],
            [Markup.button.callback('Back to Main Menu', 'back_to_main')],
        ]);

        await ctx.editMessageText('Settings:', settingsKeyboard);
    }

    // Modify the existing settings action to use the new function
    bot.action('settings', handleSettingsAction);

    bot.action('back_to_main', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString() || '';
            const firstName = ctx.from?.username || 'User';

            const response = await axios.get(`https://refuel-gux8.onrender.com/api/refuel/wallet/${telegramId}`);
            const userWalletData = response.data;
            const evmWalletData = userWalletData.evm_wallet;
            const solanaWalletData = userWalletData.solana_wallet;

            const providers = setupProviders();
            const balances = await fetchBalances(providers, evmWalletData, solanaWalletData);
            const prices = await fetchPrices();

            const message = generateWalletMessage(firstName, evmWalletData, solanaWalletData, balances, prices);

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

            await ctx.editMessageText(message, { parse_mode: 'HTML', ...Homekeyboard });
        } catch (error) {
            console.error('Error returning to main menu:', error);
            await ctx.answerCbQuery('Error returning to main menu. Please try again.');
        }
    });
};

export { getUserSettings, updateUserSettings };