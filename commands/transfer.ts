import { Telegraf, Markup } from 'telegraf';
import { ethers } from 'ethers';
import { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, Keypair, clusterApiUrl, Message } from '@solana/web3.js';
import axios from 'axios';
import { MyContext } from '../index';
import dotenv from "dotenv"
import { isNumType } from '@wormhole-foundation/sdk-connect';

dotenv.config();

const API_KEY = process.env.ALCHEMY_API

const SUPPORTED_CHAINS = ['SOL', 'ETH', 'BASE', 'ARB', 'OPTIMISM'];

interface WalletData {
    address: string;
    private_key: string;
}

interface UserWalletData {
    evm_wallet: WalletData;
    solana_wallet: WalletData;
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

interface TransferResult {
    success: boolean;
    txHash: string;
    explorerLink: string;
    errorReason?: string;
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

module.exports = (bot: Telegraf<MyContext>) => {
    // Debug handler for ALL messages
    bot.use((ctx, next) => {
        console.log('=== New Message ===');
        console.log('Update type:', ctx.updateType);
        console.log('Message:', ctx.message);
        return next();
    });

    // Specific handler for numeric inputs
    // Updated handler for numeric inputs with optional $ prefix
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

    // Handle text messages (for addresses)
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

    // Transfer command handler
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

            await ctx.reply(`Selected chain: ${chain}\n\nPlease enter amount (e.g. $15):`, keyboard);
        });
    });
});

    // Add transfer functions
    async function initiateTransfer(ctx: MyContext, selectedChain: string, amountUSD: number, recipientAddress: string) {
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) throw new Error('Telegram ID not found');
            const providers = setupProviders();
            const prices = await fetchPrices();

            const response = await axios.get(`https://refuel-gux8.onrender.com/api/refuel/wallet/${telegramId}`);
            const userWalletData: UserWalletData = response.data;

            let fromAddress: string, privateKey: string;
            if (selectedChain === 'SOL') {
                fromAddress = userWalletData.solana_wallet.address;
                privateKey = userWalletData.solana_wallet.private_key;
            } else {
                fromAddress = userWalletData.evm_wallet.address;
                privateKey = userWalletData.evm_wallet.private_key;
            }

            let nativeAmount: number;
            if (selectedChain === 'SOL') {
                nativeAmount = amountUSD / prices.sol;
            } else {
                nativeAmount = amountUSD / prices.eth;
            }

            nativeAmount = Number(nativeAmount.toFixed(18));

            const balances = await fetchBalances(providers, userWalletData.evm_wallet, userWalletData.solana_wallet);
            const userBalance = getBalanceForChain(balances, selectedChain);

            if (userBalance < nativeAmount) {
                await ctx.reply(`Insufficient balance. You have ${userBalance.toFixed(6)} ${selectedChain} but are trying to send ${nativeAmount.toFixed(6)} ${selectedChain}.`);
                return;
            }

            const result = await performTransfer(selectedChain, fromAddress, recipientAddress, nativeAmount, privateKey, providers);

            if (result.success) {
                await ctx.reply(`Transfer successful!\nFrom: ${fromAddress}\nTo: ${recipientAddress}\nAmount: $${amountUSD} (${nativeAmount.toFixed(6)} ${selectedChain})\nTransaction Hash: ${result.txHash}\nExplorer Link: ${result.explorerLink}`);
            } else {
                await ctx.reply(`Transfer failed.\nReason: ${result.errorReason}\nExplorer Link (if applicable): ${result.explorerLink}`);
            }
        } catch (error) {
            console.error('Error in initiateTransfer:', error);
            await ctx.reply('An error occurred while initiating the transfer. Please try again later.');
        }
    }


function isValidAddress(address: string, chain: string): boolean {
    if (chain === 'SOL') {
        try {
            new PublicKey(address);
            return true;
        } catch {
            return false;
        }
    } else {
        return ethers.isAddress(address);
    }
}

async function performTransfer(chain: string, from: string, to: string, amount: number, privateKey: string, providers: any): Promise<TransferResult> {
    switch (chain) {
        case 'SOL':
            return await transferSOL(from, to, amount, privateKey, providers.sol);
        case 'ETH':
            return await transferEVM(from, to, amount, privateKey, providers.eth, 'https://etherscan.io/tx/');
        case 'BASE':
            return await transferEVM(from, to, amount, privateKey, providers.base, 'https://basescan.org/tx/');
        case 'ARB':
            return await transferEVM(from, to, amount, privateKey, providers.arb, 'https://arbiscan.io/tx/');
        case 'OPTIMISM':
            return await transferEVM(from, to, amount, privateKey, providers.opt, 'https://optimistic.etherscan.io/tx/');
        default:
            throw new Error('Unsupported chain');
    }
}

async function transferSOL(from: string, to: string, amount: number, privateKey: string, connection: Connection): Promise<TransferResult> {
    try {
        const privateKeyUint8Array = new Uint8Array(Buffer.from(privateKey, 'hex'));
        const fromKeypair = Keypair.fromSecretKey(privateKeyUint8Array);
        const fromPublicKey = new PublicKey(from);
        const toPublicKey = new PublicKey(to);
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: fromPublicKey,
                toPubkey: toPublicKey,
                lamports: Math.round(amount * 1e9), // Convert SOL to lamports
            })
        );
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [fromKeypair]
        );
        return {
            success: true,
            txHash: signature,
            explorerLink: `https://explorer.solana.com/tx/${signature}`
        };
    } catch (error) {
        console.error('Error in transferSOL:', error);
        return {
            success: false,
            txHash: '',
            explorerLink: '',
            errorReason: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}

async function transferEVM(from: string, to: string, amount: number, privateKey: string, provider: ethers.JsonRpcProvider, explorerBaseUrl: string): Promise<TransferResult> {
    try {
        const wallet = new ethers.Wallet(privateKey, provider);

        const roundedAmount = Number(amount.toFixed(18));

        const tx = await wallet.sendTransaction({
            to: to,
            value: ethers.parseEther(roundedAmount.toString())
        });
        const receipt = await tx.wait();

        if (receipt && receipt.status === 1) {
            return {
                success: true,
                txHash: tx.hash,
                explorerLink: `${explorerBaseUrl}${tx.hash}`
            };
        } else {
            throw new Error('Transaction failed');
        }
    } catch (error) {
        console.error('Error in transferEVM:', error);
        let errorReason = 'Unknown error occurred';
        if (error instanceof Error) {
            if (error.message.includes('insufficient funds')) {
                errorReason = 'Insufficient funds for transfer';
            } else {
                errorReason = error.message;
            }
        }
        return {
            success: false,
            txHash: '',
            explorerLink: '',
            errorReason: errorReason
        };
    }
}

function getBalanceForChain(balances: Balances, chain: string): number {
    switch (chain) {
        case 'SOL':
            return balances.sol / 1e9; // Convert lamports to SOL
        case 'ETH':
            return parseFloat(ethers.formatEther(balances.eth));
        case 'BASE':
            return parseFloat(ethers.formatEther(balances.base));
        case 'ARB':
            return parseFloat(ethers.formatEther(balances.arb));
        case 'OPTIMISM':
            return parseFloat(ethers.formatEther(balances.opt));
        default:
            throw new Error('Unsupported chain');
    }
}
}

export { };