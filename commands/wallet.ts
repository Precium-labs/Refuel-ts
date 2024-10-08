import axios from 'axios';
import { Markup, Telegraf, Context } from 'telegraf';
import { ethers } from 'ethers';
import { Keypair, PublicKey, Connection, clusterApiUrl } from '@solana/web3.js';

interface WalletData {
  address: string;
  private_key: string;
  seed_phrase?: string;
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

// Function to set up providers
function setupProviders() {
  return {
    eth: new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
    arb: new ethers.JsonRpcProvider(`https://arb-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
    base: new ethers.JsonRpcProvider(`https://base-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
    opt: new ethers.JsonRpcProvider(`https://opt-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
    sol: new Connection(clusterApiUrl('mainnet-beta'), 'confirmed')
  };
}

// Function to fetch balances
async function fetchBalances(providers: any, evmWallet: WalletData, solanaWallet: WalletData) {
  try {
    const [ethBalance, arbBalance, baseBalance, optBalance, solBalance] = await Promise.all([
      providers.eth.getBalance(evmWallet.address),
      providers.arb.getBalance(evmWallet.address),
      providers.base.getBalance(evmWallet.address),
      providers.opt.getBalance(evmWallet.address),
      providers.sol.getBalance(new PublicKey(solanaWallet.address))
    ]);

    return { eth: ethBalance, arb: arbBalance, base: baseBalance, opt: optBalance, sol: solBalance };
  } catch (error) {
    console.error('Error fetching balances:', error);
    throw error;
  }
}

// Function to fetch current prices
async function fetchPrices() {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum,solana&vs_currencies=usd');
    return {
      eth: response.data.ethereum.usd,
      sol: response.data.solana.usd
    };
  } catch (error) {
    console.error('Error fetching prices:', error);
    return { eth: 0, sol: 0 };
  }
}

// Function to fetch wallet data
async function fetchWalletData(telegramId: string) {
  try {
    const response = await axios.get(`https://refuel-gux8.onrender.com/api/refuel/wallet/${telegramId}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching wallet data:', error);
    throw new Error('Failed to fetch wallet details');
  }
}

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
  

// Function to create new EVM wallet
async function createNewEVMWallet(telegramId: string) {
  const evmWallet = ethers.Wallet.createRandom();
  const newWallet = {
    telegram_id: telegramId,
    address: evmWallet.address,
    private_key: evmWallet.privateKey,
    seed_phrase: evmWallet.mnemonic?.phrase || "No mnemonic available" // Handle null mnemonic case
  };

  try {
    await axios.post('https://refuel-gux8.onrender.com/api/refuel/wallet/evm', newWallet);
    return { address: newWallet.address };
  } catch (error) {
    console.error('Error creating EVM wallet:', error);
    throw new Error('Failed to create EVM wallet');
  }
}

// Function to create new Solana wallet
async function createNewSolanaWallet(telegramId: string) {
  const solanaWallet = Keypair.generate();
  const newWallet = {
    telegram_id: telegramId,
    address: solanaWallet.publicKey.toString(),
    private_key: Buffer.from(solanaWallet.secretKey).toString('hex'),
    seed_phrase: "Not applicable for Solana" // Solana doesn't use seed phrases in the same way
  };

  try {
    await axios.post('https://refuel-gux8.onrender.com/api/refuel/wallet/solana', newWallet);
    return { address: newWallet.address };
  } catch (error) {
    console.error('Error creating Solana wallet:', error);
    throw new Error('Failed to create Solana wallet');
  }
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

function generateWalletMessage(
  firstName: string,
  evmWallet: WalletData,
  solanaWallet: WalletData,
  balances: Balances,
  prices: Prices
): string {
  // Convert formatted balances from string to number for arithmetic operations
  const ethBalance = parseFloat(ethers.formatEther(balances.eth));
  const arbBalance = parseFloat(ethers.formatEther(balances.arb));
  const baseBalance = parseFloat(ethers.formatEther(balances.base));
  const optBalance = parseFloat(ethers.formatEther(balances.opt));
  const solBalance = balances.sol / 1e9; // Convert lamports to SOL

  return (
    `Hello, ${firstName}!\n\n` +
    `Here are your current wallet details:\n\n` +
    `EVM Wallet: \`${evmWallet.address}\`\n` +
    `Solana Wallet: \`${solanaWallet.address}\`\n\n` +
    `Balances:\n` +
    `ETH: \`${ethBalance}\` ETH ($${(ethBalance * prices.eth).toFixed(2)})\n` +
    `ARB: \`${arbBalance}\` ETH ($${(arbBalance * prices.eth).toFixed(2)})\n` +
    `BASE: \`${baseBalance}\` ETH ($${(baseBalance * prices.eth).toFixed(2)})\n` +
    `OPT: \`${optBalance}\` ETH ($${(optBalance * prices.eth).toFixed(2)})\n` +
    `SOL: \`${solBalance}\` SOL ($${(solBalance * prices.sol).toFixed(2)})\n`
  );
}
