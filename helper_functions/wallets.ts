import { Keypair } from "@solana/web3.js";
import axios from "axios";
import { ethers } from "ethers";
import { Balances, Prices, WalletData } from "./interfaces";

// Function to fetch wallet data
export async function fetchWalletData(telegramId: string) {
    try {
      const response = await axios.get(`https://refuel-gux8.onrender.com/api/refuel/wallet/${telegramId}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching wallet data:', error);
      throw new Error('Failed to fetch wallet details');
    }
  }

// Function to create new EVM wallet
export async function createNewEVMWallet(telegramId: string) {
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
export async function createNewSolanaWallet(telegramId: string) {
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

export function generateWalletMessage(
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