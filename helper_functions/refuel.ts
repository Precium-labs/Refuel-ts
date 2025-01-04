import { getStuff, TransferStuff } from "../utils";
import BigNumber from 'bignumber.js';
import bs58 from 'bs58';
import { MyContext } from "..";
import { Chain, ChainContext, Network, routes, TokenId, Wormhole } from "@wormhole-foundation/sdk-connect";
import { EvmPlatform } from "@wormhole-foundation/sdk-evm";
import { SolanaPlatform } from "@wormhole-foundation/sdk-solana";
import { MayanRoute } from "../mayan_route/index";
import { ReferrerAddresses } from '@mayanfinance/swap-sdk';
import axios from "axios";

export interface ChainInfo {
    name: string;
    chain: ChainContext<Network, Chain>;
  }

  const chainToNativeToken: { [key: string]: string } = {
    "Ethereum": "ethereum",
    "Solana": "solana",
    "Base": "ethereum",
    "Optimism": "ethereum",
    "Arbitrum": "ethereum"
  };

// Store user states in a map using telegram user ID as key
const userStates = new Map<string, {
    sourceChain: ChainInfo | null;
    destChain: ChainInfo | null;
    waitingForAmount: boolean;
  }>();

export function getUserState(userId: string) {
    if (!userStates.has(userId)) {
      userStates.set(userId, {
        sourceChain: null,
        destChain: null,
        waitingForAmount: false
      });
    }
    return userStates.get(userId)!;
  }
  
  async function getUsdPrice(chainName: string): Promise<number> {
    try {
      const tokenSymbol = chainToNativeToken[chainName];
      if (!tokenSymbol) {
        throw new Error(`Unknown chain: ${chainName}`);
      }
      const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${tokenSymbol}&vs_currencies=usd`);
      return response.data[tokenSymbol].usd;
    } catch (error) {
      console.error('Error fetching price:', error);
      return 0;
    }
  }


class MayanRefRoute<N extends Network> extends MayanRoute<N> {
  override referrerAddress(): ReferrerAddresses | undefined {
    return {
      solana: "EFFkREkW7DjubGzkXAYt3xCqz4rWuLJjY1L2yD9Mtuym",
      evm: "0x9319b3c6B01df3e375abdB3Be42DA19C558D3E69"
    };
  }
}

async function getUserWalletData(telegramId: string) {
    const response = await axios.get(`https://refuel-gux8.onrender.com/api/refuel/wallet/${telegramId}`);
    return response.data;
  }

// Setup Wormhole
export const wh = new Wormhole("Mainnet", [EvmPlatform, SolanaPlatform]);
const resolver = wh.resolver([MayanRefRoute]);

export async function performRefuel(ctx: MyContext, amountUsd: number) {
    try {
      if (!ctx.from) {
        throw new Error('Unable to identify user');
      }
  
      const userState = getUserState(ctx.from.id.toString());
      const sourceChain = userState.sourceChain;
      const destChain = userState.destChain;
  
      if (!sourceChain || !destChain) {
        throw new Error('Source or destination chain not selected');
      }
  
      console.log(`Starting refuel from ${sourceChain.name} to ${destChain.name} for ${amountUsd} USD`);
  
      const telegramId = ctx.from.id.toString();
      const userWalletData = await getUserWalletData(telegramId);
      console.log('User wallet data retrieved');
  
      // Define source and destination tokens
      const source: TokenId = { chain: sourceChain.chain.chain, address: "native" };
      const destination: TokenId = { chain: destChain.chain.chain, address: "native" };
  
      const sourcePrice = await getUsdPrice(sourceChain.name);
      console.log(`Price for ${sourceChain.name}: ${sourcePrice} USD`);
  
      if (sourcePrice === 0) {
        throw new Error(`Unable to fetch price for ${sourceChain.name}`);
      }
  
      const sourcePriceBN = new BigNumber(sourcePrice);
      const amountUsdBN = new BigNumber(amountUsd);
      let amountInSourceToken: string;
  
      if (sourceChain.name === "Solana") {
        const solAmount = amountUsdBN.dividedBy(sourcePriceBN);
        amountInSourceToken = solAmount.toString();
        console.log(`Amount in SOL: ${solAmount.toFixed(9)}`);
      } else {
        const ethAmount = amountUsdBN.dividedBy(sourcePriceBN);
        amountInSourceToken = ethAmount.toString();
        console.log(`Amount in ETH: ${ethAmount.toFixed(18)}`);
      }
  
      console.log(`Amount in source token: ${amountInSourceToken}`);
  
      const tr = await routes.RouteTransferRequest.create(wh, {
        source,
        destination,
      });
  
      console.log('Route transfer request created');
  
      const foundRoutes = await resolver.findRoutes(tr);
      console.log(`Found ${foundRoutes.length} routes`);
  
      const bestRoute = foundRoutes[0]!;
      console.log('Selected best route');
  
      const transferParams = {
        amount: amountInSourceToken,
        options: bestRoute.getDefaultOptions(),
      };
  
      console.log('Transfer params:', transferParams);
  
      let validated = await bestRoute.validate(tr, transferParams);
      if (!validated.valid) {
        throw new Error(validated.error.message);
      }
      console.log('Route validated');
  
      const quote = await bestRoute.quote(tr, validated.params);
      if (!quote.success) {
        throw new Error(`Error fetching a quote: ${quote.error.message}`);
      }
      console.log('Quote received:', quote);
  
      // Get the user's signer and address
      let senderStuff: TransferStuff<Network, Chain>;
      let receiverStuff: TransferStuff<Network, Chain>;
  
      try {
        if (sourceChain.name === "Solana") {
          const privateKey = userWalletData.solana_wallet.private_key;
          const privateKeyBuffer = Buffer.from(privateKey, 'hex');
          const senderPrivateKey = bs58.encode(privateKeyBuffer);
          senderStuff = await getStuff(sourceChain.chain, senderPrivateKey);
        } else {
          senderStuff = await getStuff(sourceChain.chain, userWalletData.evm_wallet.private_key);
        }
  
        if (destChain.name === "Solana") {
          const privateKey = userWalletData.solana_wallet.private_key;
          const privateKeyBuffer = Buffer.from(privateKey, 'hex');
          const receiverPrivateKey = bs58.encode(privateKeyBuffer);
          receiverStuff = await getStuff(destChain.chain, receiverPrivateKey);
        } else {
          receiverStuff = await getStuff(destChain.chain, userWalletData.evm_wallet.private_key);
        }
      } catch (error) {
        console.error('Error preparing wallet stuff:', error);
        throw new Error('Failed to prepare wallet information');
      }
  
      console.log('Sender details:', {
        chain: sourceChain.name,
        address: senderStuff.address,
        signerType: typeof senderStuff.signer
      });
  
      console.log('Receiver details:', {
        chain: destChain.name,
        address: receiverStuff.address,
        signerType: typeof receiverStuff.signer
      });
  
      // Initiate the transfer
      const receipt = await bestRoute.initiate(
        tr,
        senderStuff.signer,
        quote,
        receiverStuff.address
      );
      console.log("Initiated transfer with receipt: ", receipt);
  
      // Check and complete the transfer
      await routes.checkAndCompleteTransfer(
        bestRoute,
        receipt,
        receiverStuff.signer,
        15 * 60 * 1000
      );
  
      console.log('Transfer completed');
  
      // Format the receipt for display
      const formattedReceipt = {
        sourceChain: sourceChain.name,
        destinationChain: destChain.name,
        amount: `$${amountUsd}`,
        status: 'Completed',
        timestamp: new Date().toISOString()
      };
  
      await ctx.reply(
        '✅ Transfer completed successfully!\n\n' +
        `From: ${formattedReceipt.sourceChain}\n` +
        `To: ${formattedReceipt.destinationChain}\n` +
        `Amount: ${formattedReceipt.amount}\n` +
        `Status: ${formattedReceipt.status}\n` +
        `Time: ${new Date(formattedReceipt.timestamp).toLocaleString()}`
      );
  
    } catch (error) {
      console.error('Error in refuel:', error);
      if (error instanceof Error) {
        await ctx.reply(`❌ Error: ${error.message}`);
      } else {
        await ctx.reply('❌ An unknown error occurred. Please try again.');
      }
      throw error; // Re-throw to be handled by the calling function
    }
  }