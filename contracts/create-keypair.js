#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Keypair } = require('@solana/web3.js');

// Generate a new keypair
const keypair = Keypair.generate();

// Create config directory if it doesn't exist
const configDir = path.join(os.homedir(), '.config', 'solana');
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Write keypair in Solana CLI format (array of numbers)
const keypairPath = path.join(configDir, 'lendguard-devnet.json');
const secretArray = Array.from(keypair.secretKey);

fs.writeFileSync(keypairPath, JSON.stringify(secretArray), 'utf8');

console.log(`\n✅ Keypair generated successfully!`);
console.log(`📁 Location: ${keypairPath}`);
console.log(`🔑 Public Key: ${keypair.publicKey.toString()}`);
console.log(`\n⚡ Next Steps:`);
console.log(`1. Fund this wallet on devnet with faucet`);
console.log(`   Visit: https://faucet.solana.com`);
console.log(`   Paste: ${keypair.publicKey.toString()}`);
console.log(`\n2. Build the contract:`);
console.log(`   cd contracts`);
console.log(`   anchor build`);
console.log(`\n3. Deploy to devnet:`);
console.log(`   anchor deploy --provider.cluster devnet`);
