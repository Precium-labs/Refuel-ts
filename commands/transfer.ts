import { Telegraf, Markup } from 'telegraf';
import { ethers } from 'ethers';
import { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, Keypair, clusterApiUrl } from '@solana/web3.js';
import axios from 'axios';
import { MyContext } from '../index';

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

function setupProviders() {
    return {
        eth: new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
        arb: new ethers.JsonRpcProvider(`https://arb-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
        base: new ethers.JsonRpcProvider(`https://base-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
        opt: new ethers.JsonRpcProvider(`https://opt-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
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

let transferInProgress = false;

module.exports = (bot: Telegraf<MyContext>) => {
    let selectedChain: string | null = null;
    let amountUSD: number | null = null;
    let recipientAddress: string | null = null;

    // Start the transfer process
    bot.action('transfer', async (ctx) => {
        selectedChain = null;
        amountUSD = null;
        recipientAddress = null;
        transferInProgress = true;
    
        const chainKeyboard = Markup.inlineKeyboard(
            SUPPORTED_CHAINS.map(chain => [Markup.button.callback(`transfer_${chain}`, `select_chain_${chain}`)])
        );
    
        await ctx.reply('Transfer process started. Select the chain you want to transfer from (This is Transfer Not Bridge):', chainKeyboard);
    });

    // Handle chain selection
    SUPPORTED_CHAINS.forEach(chain => {
        bot.action(`select_chain_${chain}`, async (ctx) => {
            selectedChain = chain;
            await ctx.answerCbQuery(`${chain} selected`);
            await ctx.reply('Enter the amount you want to send in USD (format: /amount 100):');
        });
    });

    // Handle amount input
    bot.command('amount', async (ctx) => {
        if (!transferInProgress) return;

        const amount = parseFloat(ctx.message.text.split(' ')[1]);
        if (isNaN(amount) || amount <= 0) {
            await ctx.reply('Please enter a valid positive number for the amount.');
            return;
        }
        amountUSD = amount;
        await ctx.reply('Enter the recipient address (format: /address 0x...):');
    });

    // Handle address input
    bot.command('address', async (ctx) => {
        if (!transferInProgress) return;

        const address = ctx.message.text.split(' ')[1];
        if (!isValidAddress(address, selectedChain!)) {
            await ctx.reply('Invalid address. Please enter a valid address for the selected chain.');
            return;
        }
        recipientAddress = address;
        await initiateTransfer(ctx);
    });

    // Cancel transfer process
    bot.command('cancel_transfer', async (ctx) => {
        if (transferInProgress) {
            transferInProgress = false;
            selectedChain = null;
            amountUSD = null;
            recipientAddress = null;
            await ctx.reply('Transfer process cancelled.');
        } else {
            await ctx.reply('No transfer process is currently active.');
        }
    });

    async function initiateTransfer(ctx: MyContext) {
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) throw new Error('Telegram ID not found');

            const providers = setupProviders();
            const prices = await fetchPrices();

            // Fetch user's wallet data
            const response = await axios.get(`https://refuel-database.onrender.com/api/refuel/wallet/${telegramId}`);
            const userWalletData: UserWalletData = response.data;

            let fromAddress: string, privateKey: string;
            if (selectedChain === 'SOL') {
                fromAddress = userWalletData.solana_wallet.address;
                privateKey = userWalletData.solana_wallet.private_key;
            } else {
                fromAddress = userWalletData.evm_wallet.address;
                privateKey = userWalletData.evm_wallet.private_key;
            }

            // Convert USD to native token amount
            let nativeAmount: number;
            if (selectedChain === 'SOL') {
                nativeAmount = amountUSD! / prices.sol;
            } else {
                nativeAmount = amountUSD! / prices.eth;
            }

            // Check if user has sufficient balance
            const balances = await fetchBalances(providers, userWalletData.evm_wallet, userWalletData.solana_wallet);
            const userBalance = getBalanceForChain(balances, selectedChain!);
            if (userBalance < nativeAmount) {
                await ctx.reply(`Insufficient balance. You have ${userBalance.toFixed(6)} ${selectedChain} but are trying to send ${nativeAmount.toFixed(6)} ${selectedChain}.`);
                return;
            }

            // Perform the transfer
            const txHash = await performTransfer(selectedChain!, fromAddress, recipientAddress!, nativeAmount, privateKey, providers);

            await ctx.reply(`Transfer initiated!\nFrom: ${fromAddress}\nTo: ${recipientAddress}\nAmount: $${amountUSD} (${nativeAmount.toFixed(6)} ${selectedChain})\nTransaction Hash: ${txHash}`);

        } catch (error) {
            console.error('Error in initiateTransfer:', error);
            await ctx.reply('An error occurred while initiating the transfer. Please try again later.');
        }

        // Reset the state
        selectedChain = null;
        amountUSD = null;
        recipientAddress = null;
        transferInProgress = false;
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

    async function performTransfer(chain: string, from: string, to: string, amount: number, privateKey: string, providers: any): Promise<string> {
        switch (chain) {
            case 'SOL':
                return await transferSOL(from, to, amount, privateKey, providers.sol);
            case 'ETH':
                return await transferEVM(from, to, amount, privateKey, providers.eth);
            case 'BASE':
                return await transferEVM(from, to, amount, privateKey, providers.base);
            case 'ARB':
                return await transferEVM(from, to, amount, privateKey, providers.arb);
            case 'OPTIMISM':
                return await transferEVM(from, to, amount, privateKey, providers.opt);
            default:
                throw new Error('Unsupported chain');
        }
    }

    async function transferSOL(from: string, to: string, amount: number, privateKey: string, connection: Connection): Promise<string> {
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

        return signature;
    }

    async function transferEVM(from: string, to: string, amount: number, privateKey: string, provider: ethers.JsonRpcProvider): Promise<string> {
        const wallet = new ethers.Wallet(privateKey, provider);

        const tx = await wallet.sendTransaction({
            to: to,
            value: ethers.parseEther(amount.toString())
        });

        await tx.wait();
        return tx.hash;
    }

    function getBalanceForChain(balances: any, chain: string): number {
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
};

export {};
