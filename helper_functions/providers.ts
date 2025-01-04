import { clusterApiUrl, Connection } from "@solana/web3.js";
import { ethers } from "ethers";
import dotenv from "dotenv"


dotenv.config();


const API_KEY = process.env.ALCHEMY_API


function setupProviders() {
  return {
    eth: new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${API_KEY}`),
    arb: new ethers.JsonRpcProvider(`https://arb-mainnet.g.alchemy.com/v2/${API_KEY}`),
    base: new ethers.JsonRpcProvider(`https://base-mainnet.g.alchemy.com/v2/${API_KEY}`),
    opt: new ethers.JsonRpcProvider(`https://opt-mainnet.g.alchemy.com/v2/${API_KEY}`),
    sol: new Connection(clusterApiUrl('mainnet-beta'), 'confirmed')
  };
}

export default setupProviders