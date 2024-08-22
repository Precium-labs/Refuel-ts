import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

// Example Hexadecimal private key
const hexPrivateKey = '160310839e4c7545079ee75dd836b5aa74d0aa743043b3416baa9e4cf55a7ead2c214259e772645397af3f991f07de8312426eac268be99d092ad1ad63560428';

// Convert hex to buffer
const privateKeyBuffer = Buffer.from(hexPrivateKey, 'hex');

// Convert buffer to Base58
const base58PrivateKey = bs58.encode(privateKeyBuffer);

console.log(`Base58 Private Key: ${base58PrivateKey}`);
