#!/usr/bin/env node

/**
 * Create MessageApproval account on devnet with proper data initialization
 * This version writes the account as System-owned (mutable) for testing
 * Usage: node scripts/create-approval-v3.js
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
} = require("@solana/web3.js");
const { sendAndConfirmTransaction } = require("@solana/web3.js");

// Mock dWallet ID (32 bytes, left-padded string)
const MOCK_DWALLET_ID = (() => {
  const s = "ika-dwallet-btc-demo-001";
  const buf = Buffer.alloc(32);
  buf.write(s, 0, s.length);
  return buf;
})();

async function main() {
  try {
    console.log("🔧 Creating MessageApproval account on devnet...\n");

    // Find keypair
    const possiblePaths = [
      path.join(os.homedir(), ".config", "solana", "lendguard-devnet.json"),
      path.join(os.homedir(), ".config", "solana", "id.json"),
    ];

    let payer = null;
    let keyPath = null;
    
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        try {
          const keyData = JSON.parse(fs.readFileSync(p, "utf-8"));
          if (Array.isArray(keyData) && keyData.length === 64) {
            payer = Keypair.fromSecretKey(Buffer.from(keyData));
            keyPath = p;
            break;
          }
        } catch (e) {
          // Continue
        }
      }
    }

    if (!payer) {
      console.error("❌ Could not find keypair file\n");
      process.exit(1);
    }

    console.log(`✓ Loaded keypair from: ${keyPath}`);
    console.log(`✓ Payer: ${payer.publicKey.toBase58()}`);

    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    const balance = await connection.getBalance(payer.publicKey);
    const solBalance = balance / 1e9;
    console.log(`✓ Balance: ${solBalance.toFixed(3)} SOL\n`);

    if (balance < 5_000_000) {
      console.error("❌ Insufficient balance (need 0.005 SOL)");
      process.exit(1);
    }

    // Generate MessageApproval keypair
    const approvalKp = Keypair.generate();
    const approvalPubkey = approvalKp.publicKey;

    console.log(`📍 MessageApproval pubkey:`);
    console.log(`   ${approvalPubkey.toBase58()}\n`);

    // Build MessageApproval data (49 bytes)
    const approvedAt = Math.floor(Date.now() / 1000);
    const data = Buffer.alloc(49);
    
    // Offset 0-7: discriminator (zeros)
    // Offset 8-39: dwallet_id
    MOCK_DWALLET_ID.copy(data, 8);
    // Offset 40-47: approved_at (i64 LE)
    data.writeBigInt64LE(BigInt(approvedAt), 40);
    // Offset 48: is_signed = 1
    data.writeUInt8(1, 48);

    const lamports = await connection.getMinimumBalanceForRentExemption(data.length);
    console.log(`💰 Cost: ${(lamports / 1e9).toFixed(6)} SOL`);
    console.log(`⏳ Creating account...\n`);

    // Step 1: Create account as System-owned (allows us to write data)
    const createTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: approvalPubkey,
        lamports,
        space: data.length,
        programId: SystemProgram.programId, // Owner: System (mutable)
      })
    );

    let sig = await sendAndConfirmTransaction(connection, createTx, [payer, approvalKp], {
      commitment: "confirmed",
    });

    console.log(`✅ Account created!`);
    console.log(`📋 Tx: ${sig}\n`);

    const created = await connection.getAccountInfo(approvalPubkey);
    const bytes8to40 = created?.data?.subarray(8, 40);
    const isAllZero = bytes8to40
      ? Buffer.from(bytes8to40).toString("hex") === "0".repeat(64)
      : true;

    console.log("⚠️  IMPORTANT");
    console.log("This script only creates an empty account.");
    console.log("It cannot write MessageApproval bytes using SystemProgram.");
    console.log("");
    console.log(`Account bytes[8..40] zero check: ${isAllZero ? "ALL ZEROS (invalid for verify)" : "NON-ZERO"}`);
    console.log(`Expected data hex (for reference only): ${data.toString("hex")}`);
    console.log("");
    console.log("❌ Not updating web/.env to avoid false success.");
    console.log("Use a real Ika-generated MessageApproval pubkey for verify_custody_proof.");
    console.log("");
    console.log("Explorer:");
    console.log(`https://explorer.solana.com/address/${approvalPubkey.toBase58()}?cluster=devnet`);
    process.exit(2);

  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
