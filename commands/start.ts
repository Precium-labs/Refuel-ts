import axios from 'axios';
import { Markup, Telegraf } from 'telegraf';
import { Message } from 'telegraf/types';
import { ethers } from 'ethers';
import { Keypair, Connection, clusterApiUrl, PublicKey } from '@solana/web3.js';
import { MyContext } from '../index'

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

interface UserWalletData {
  evm_wallet: WalletData;
  solana_wallet: WalletData;
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

 function setupProviders() {
  return {
    eth: new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
    arb: new ethers.JsonRpcProvider(`https://arb-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
    base: new ethers.JsonRpcProvider(`https://base-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
    opt: new ethers.JsonRpcProvider(`https://opt-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`),
    sol: new Connection(clusterApiUrl('mainnet-beta'), 'confirmed')
  };
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
  bot.start(async (ctx) => {
    try {
      const firstName = ctx.from?.username || 'User';
      const telegramId = ctx.from?.id.toString() || '';
      console.log('Telegram ID:', telegramId);

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
          Markup.button.callback(`👥Refer Friends`, 'refferal'),
        ],
        [
          Markup.button.callback(`♻️Refresh`, 'refresh'),
        ],
      ]);

      let evmWalletData: WalletData, solanaWalletData: WalletData;
      try {
        const response = await axios.get(`https://refuel-database.onrender.com/api/refuel/wallet/${telegramId}`);
        const userWalletData: UserWalletData = response.data;
        evmWalletData = userWalletData.evm_wallet;
        solanaWalletData = userWalletData.solana_wallet;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response && error.response.status === 404) {
          console.log('User not foundm  , creating new wallets...');
          try {
            const randomWallet = ethers.Wallet.createRandom();
            evmWalletData = {
              address: randomWallet.address,
              private_key: randomWallet.privateKey,
              seed_phrase: randomWallet.mnemonic?.phrase
            };
            const solanaKeypair = Keypair.generate();
            solanaWalletData = {
              address: solanaKeypair.publicKey.toString(),
              private_key: Buffer.from(solanaKeypair.secretKey).toString('hex'),
              seed_phrase: "example seed phrase for solana wallet",
            };

            const newWalletResponse = await axios.post('https://refuel-database.onrender.com/api/refuel/wallet', {
              telegram_id: telegramId,
              evm_wallet: evmWalletData,
              solana_wallet: solanaWalletData
            });

            if (newWalletResponse.status !== 200) {
              throw new Error('Failed to create new wallets');
            }
          } catch (createError) {
            console.error('Error creating new wallets:', createError);
            throw new Error('Failed to create new wallets. Please try again later or contact support.');
          }
        } else if (axios.isAxiosError(error) && error.response && error.response.status === 500) {
          console.error('Server error:', error.response.data);
          throw new Error('Server error while fetching or updating wallet information. Please try again later or contact support.');
        } else {
          console.error('Unexpected error:', error);
          throw new Error('An unexpected error occurred. Please try again later or contact support.');
        }
      }

      if (!evmWalletData || !solanaWalletData) {
        ctx.reply('Wallet setup failed. Please try again later or contact support.');
        return;
      }

      const providers = setupProviders();
      const balances = await fetchBalances(providers, evmWalletData, solanaWalletData);
      console.log('Balances:', balances);

      const prices = await fetchPrices();
      console.log('Prices:', prices);

      const message = generateWalletMessage(firstName, evmWalletData, solanaWalletData, balances, prices);
      console.log('Generated message:', message);

      await ctx.reply(message, { parse_mode: 'HTML', ...Homekeyboard });
    } catch (error) {
      console.error('Error handling /start command:', error);
      let errorMessage = 'An error occurred while processing your request. Please try again later.';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      await ctx.reply(errorMessage);
    }
  });

  bot.action('refresh', async (ctx) => {
    try {
      const telegramId = ctx.from?.id.toString() || '';
      const firstName = ctx.from?.username || 'User';
      console.log('Refreshing for Telegram ID:', telegramId);
  
      let evmWalletData: WalletData, solanaWalletData: WalletData;
      try {
        const response = await axios.get(`https://refuel-database.onrender.com/api/refuel/wallet/${telegramId}`);
        const userWalletData: UserWalletData = response.data;
        evmWalletData = userWalletData.evm_wallet;
        solanaWalletData = userWalletData.solana_wallet;
      } catch (error) {
        console.error('Error fetching wallet data:', error);
        throw new Error('Failed to retrieve wallet information. Please try again later or contact support.');
      }
  
      if (!evmWalletData || !solanaWalletData) {
        throw new Error('Failed to retrieve wallet information. Please try again later or contact support.');
      }
  
      const providers = setupProviders();
      const balances = await fetchBalances(providers, evmWalletData, solanaWalletData);
      console.log('Balances:', balances);
  
      const prices = await fetchPrices();
      console.log('Prices:', prices);
  
      const message = generateWalletMessage(firstName, evmWalletData, solanaWalletData, balances, prices);
      console.log('Generated message:', message);
  
      await ctx.answerCbQuery('Refreshed successfully');
  
      if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
        const originalMessage = ctx.callbackQuery.message as Message.TextMessage;
        if (originalMessage && originalMessage.reply_markup) {
          await ctx.editMessageText(message, { 
            parse_mode: 'HTML', 
            reply_markup: originalMessage.reply_markup 
          });
        } else {
          await ctx.editMessageText(message, { parse_mode: 'HTML' });
        }
      } else {
        await ctx.reply(message, { parse_mode: 'HTML' });
      }
    } catch (error) {
      console.error('Error in refresh handler:', error);
      let errorMessage = 'An error occurred while refreshing. Please try again later.';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      await ctx.answerCbQuery(errorMessage);
    }
  });
};
// start.ts
export { setupProviders, fetchBalances, fetchPrices, generateWalletMessage } 


