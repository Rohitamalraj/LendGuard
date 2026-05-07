#!/usr/bin/env node

/**
 * Request airdrop from devnet faucet
 * Usage: node scripts/airdrop.js
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");

async function main() {
  try {
    // Find keypair
    const possiblePaths = [
      path.join(os.homedir(), ".config", "solana", "lendguard-devnet.json"),
      path.join(os.homedir(), ".config", "solana", "id.json"),
    ];

    let payer = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        try {
          const keyData = JSON.parse(fs.readFileSync(p, "utf-8"));
          if (Array.isArray(keyData) && keyData.length === 64) {
            payer = Keypair.fromSecretKey(Buffer.from(keyData));
            break;
          }
        } catch {}
      }
    }

    if (!payer) {
      console.error("❌ Keypair not found");
      process.exit(1);
    }

    console.log(`💰 Requesting airdrop...`);
    console.log(`   Wallet: ${payer.publicKey.toBase58()}`);

    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    // Request 2 SOL
    try {
      const sig = await connection.requestAirdrop(payer.publicKey, 2 * 1e9);
      console.log(`⏳ Waiting for confirmation...\n`);
      
      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        "confirmed"
      );

      const balance = await connection.getBalance(payer.publicKey);
      console.log(`✅ Airdrop successful!`);
      console.log(`✓ New balance: ${(balance / 1e9).toFixed(3)} SOL\n`);

      console.log(`🎉 Now run:`);
      console.log(`   node scripts/create-approval-v2.js\n`);
    } catch (err) {
      console.error(`❌ Airdrop failed: ${err.message}`);
      console.error(`\n💡 Alternative: Go to https://faucet.solana.com and paste:`);
      console.error(`   ${payer.publicKey.toBase58()}\n`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
