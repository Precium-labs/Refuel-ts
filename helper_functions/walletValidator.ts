import { PublicKey } from "@solana/web3.js";
import { ethers } from "ethers";

export function isValidAddress(address: string, chain: string): boolean {
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