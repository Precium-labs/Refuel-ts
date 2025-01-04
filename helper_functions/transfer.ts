import axios from "axios";
import fetchBalances, { fetchPrices } from "./fetchBalances";
import { Balances, TransferResult, UserWalletData } from "./interfaces";
import setupProviders from "./providers";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction } from "@solana/web3.js";
import { ethers } from "ethers";
import { MyContext } from "..";



    // Add transfer functions
export async function initiateTransfer(ctx: MyContext, selectedChain: string, amountUSD: number, recipientAddress: string) {
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
    
export async function performTransfer(chain: string, from: string, to: string, amount: number, privateKey: string, providers: any): Promise<TransferResult> {
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
    
export async function transferSOL(from: string, to: string, amount: number, privateKey: string, connection: Connection): Promise<TransferResult> {
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
    
export async function transferEVM(from: string, to: string, amount: number, privateKey: string, provider: ethers.JsonRpcProvider, explorerBaseUrl: string): Promise<TransferResult> {
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

export function getBalanceForChain(balances: Balances, chain: string): number {
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