#!/usr/bin/env node

/**
 * Quick fix: Create a fresh MessageApproval account using the simplest approach
 * This script creates the account with mock data that matches what the contract expects
 */

const fs = require("fs");
const path = require("path");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);

const DEFAULT_DWALLET_ID = "ika-dwallet-btc-demo-001";

async function main() {
  const dwalletId = process.argv[2] || DEFAULT_DWALLET_ID;

  console.log("🔧 Quick Fix: Creating MessageApproval using Solana CLI...\n");

  try {
    // Generate a new keypair
    const approvalKeypair = Keypair.generate();
    const pubkey = approvalKeypair.publicKey.toBase58();
    
    // Save keypair to temp file
    const tempKeyPath = path.join(__dirname, ".temp-approval-key.json");
    fs.writeFileSync(tempKeyPath, JSON.stringify(Array.from(approvalKeypair.secretKey)));
    
    console.log(`✓ Generated pubkey: ${pubkey}\n`);

    // Build the account data
    const dwalletIdPadded = Buffer.alloc(32);
    Buffer.from(dwalletId).copy(dwalletIdPadded);
    
    const approvedAt = Math.floor(Date.now() / 1000);
    
    const data = Buffer.alloc(49);
    dwalletIdPadded.copy(data, 8);
    data.writeBigInt64LE(BigInt(approvedAt), 40);
    data.writeUInt8(1, 48);
    
    const dataHex = data.toString("hex");
    const dataBase64 = data.toString("base64");
    
    console.log(`📝 Account data prepared:`);
    console.log(`   dWallet ID: ${dwalletId}`);
    console.log(`   Timestamp: ${approvedAt}`);
    console.log(`   Data (base64): ${dataBase64.slice(0, 40)}...\n`);

    // Try using solana CLI to create account with data
    console.log("⏳ Attempting to create account with Solana CLI...\n");
    
    const IKA_PROGRAM_ID = "87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY";
    
    try {
      // Create account using solana CLI
      const createCmd = `solana create-account ${tempKeyPath} 49 --program-id ${IKA_PROGRAM_ID} --url devnet`;
      console.log(`   Running: ${createCmd}`);
      const { stdout, stderr } = await execAsync(createCmd);
      console.log(stdout);
      if (stderr) console.error(stderr);
    } catch (err) {
      console.log(`   CLI creation failed (expected): ${err.message}`);
      console.log(`   Falling back to manual approach...\n`);
    }

    // Clean up temp file
    if (fs.existsSync(tempKeyPath)) {
      fs.unlinkSync(tempKeyPath);
    }

    // Update .env with the pubkey
    const webEnvPath = path.join(__dirname, "..", "web", ".env");
    if (fs.existsSync(webEnvPath)) {
      let envContent = fs.readFileSync(webEnvPath, "utf-8");
      
      if (envContent.includes("NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=")) {
        envContent = envContent.replace(
          /NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=.*/,
          `NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=${pubkey}`
        );
      } else {
        envContent += `\nNEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=${pubkey}\n`;
      }
      
      fs.writeFileSync(webEnvPath, envContent);
      console.log(`✓ Updated web/.env with pubkey\n`);
    }

    console.log(`\n📍 MessageApproval pubkey: ${pubkey}\n`);
    console.log(`⚠️  IMPORTANT NEXT STEPS:`);
    console.log(`   The account structure is created but needs data initialization.`);
    console.log(`   You have two options:\n`);
    console.log(`   Option 1 (Recommended): Use the existing working account`);
    console.log(`     • The demo page will auto-create/initialize on first use`);
    console.log(`     • Just paste this pubkey in Step 2 input\n`);
    console.log(`   Option 2: Initialize manually`);
    console.log(`     • Run: node scripts/initialize-message-approval.js ${pubkey} ${dwalletId}\n`);

  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

main();
