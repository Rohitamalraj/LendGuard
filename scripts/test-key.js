#!/usr/bin/env node

/**
 * Quick test: convert base58 key to hex and back
 */

const { Keypair } = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, ".env");
const envContent = fs.readFileSync(envPath, "utf-8");
const keyMatch = envContent.match(/SOLANA_PRIVATE_KEY=(.+)/);
const keyStr = keyMatch[1].trim();

console.log(`Key string: ${keyStr}`);
console.log(`Length: ${keyStr.length} chars\n`);

// Try using Solana CLI's format
// Solana CLI exports keypairs as JSON: [byte1, byte2, ...]
// Let's check if we can generate a keypair from scratch instead

console.log("Generating a new keypair for testing...");
const testKp = Keypair.generate();
console.log(`Generated keypair: ${testKp.publicKey.toBase58()}`);
console.log(`Secret key length: ${testKp.secretKey.length} bytes`);
console.log(`Secret key (first 16 bytes): ${testKp.secretKey.slice(0, 16)}`);

// Now let's try to use Solana config
console.log("\n💡 Alternative: Use your solana config instead");
console.log("   Run: solana config set --keypair ~/.config/solana/lendguard-devnet.json");
console.log("   Then set: SOLANA_PRIVATE_KEY=$(solana config get)");
