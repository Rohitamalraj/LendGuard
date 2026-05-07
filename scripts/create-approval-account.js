#!/usr/bin/env node

/**
 * Create a real MessageApproval account on devnet
 * Reads payer key from scripts/.env, creates account with proper data structure
 * Usage: node scripts/create-approval-account.js
 */

const fs = require("fs");
const path = require("path");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");

const IKA_PROGRAM_ID = new PublicKey("87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY");
const MOCK_DWALLET_ID = Buffer.from("ika-dwallet-btc-demo-001");

// Simple base58 decoder (from bs58 npm package logic)
function base58Decode(str) {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const ALPHA_MAP = {};
  for (let i = 0; i < ALPHABET.length; i++) {
    ALPHA_MAP[ALPHABET[i]] = i;
  }

  let decoded = Buffer.alloc(1);
  decoded[0] = 0;

  for (const char of str) {
    let carry = ALPHA_MAP[char];
    let i = 0;
    for (i = decoded.length - 1; i >= 0; i--) {
      carry += decoded[i] * 58;
      decoded[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      decoded = Buffer.concat([decoded, Buffer.from([carry & 0xff])]);
      carry >>= 8;
    }
  }

  // Remove leading zeros
  let j = 0;
  while (j < decoded.length - 1 && decoded[j] === 0) {
    j++;
  }

  return decoded.slice(j).reverse();
}

async function main() {
  try {
    console.log("🔧 Creating MessageApproval account on devnet...\n");

    // Load payer key
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) {
      console.error("❌ scripts/.env not found");
      console.error("   Create it with your devnet wallet private key:");
      console.error("   SOLANA_PRIVATE_KEY=<base58_or_json>");
      process.exit(1);
    }

    const envContent = fs.readFileSync(envPath, "utf-8");
    const keyMatch = envContent.match(/SOLANA_PRIVATE_KEY=(.+)/);
    if (!keyMatch || !keyMatch[1]) {
      console.error("❌ SOLANA_PRIVATE_KEY not set in scripts/.env");
      process.exit(1);
    }

    const keyStr = keyMatch[1].trim();
    let payer;

    // Try JSON array first
    if (keyStr.startsWith("[")) {
      try {
        const array = JSON.parse(keyStr);
        payer = Keypair.fromSecretKey(Buffer.from(array));
      } catch {
        console.error("❌ Invalid JSON array format");
        process.exit(1);
      }
    } else {
      // Try base58
      try {
        const bytes = base58Decode(keyStr);
        // Solana CLI may include checksums - use first 64 bytes
        const secretKey = bytes.slice(-64);
        if (secretKey.length !== 64) {
          console.error(`❌ Invalid key length: ${secretKey.length} bytes (expected 64)`);
          console.error(`   Original decoded: ${bytes.length} bytes`);
          process.exit(1);
        }
        payer = Keypair.fromSecretKey(secretKey);
      } catch (err) {
        console.error("❌ Could not decode base58 key:", err.message);
        process.exit(1);
      }
    }

    console.log(`✓ Payer: ${payer.publicKey.toBase58()}`);

    // Connect to devnet
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    // Check balance
    const balance = await connection.getBalance(payer.publicKey);
    const solBalance = balance / 1e9;
    console.log(`✓ Balance: ${solBalance.toFixed(3)} SOL`);

    if (balance < 5_000_000) {
      console.error("\n❌ Insufficient balance (need 0.005 SOL)");
      console.error("   Run: solana airdrop 2 --url devnet");
      process.exit(1);
    }

    // Generate MessageApproval keypair
    const approvalKp = Keypair.generate();
    const approvalPubkey = approvalKp.publicKey;

    console.log(`\n📍 MessageApproval pubkey:`);
    console.log(`   ${approvalPubkey.toBase58()}\n`);

    // Build MessageApproval data (49 bytes)
    const approvedAt = Math.floor(Date.now() / 1000);
    const data = Buffer.alloc(49);
    
    // Offset 0-7: discriminator (zeros)
    // Offset 8-39: dwallet_id
    MOCK_DWALLET_ID.copy(data, 8);
    // Offset 40-47: approved_at (i64 LE)
    data.writeBigInt64LE(BigInt(approvedAt), 40);
    // Offset 48: is_signed (1 = approved)
    data.writeUInt8(1, 48);

    const lamports = await connection.getMinimumBalanceForRentExemption(data.length);
    console.log(`💰 Cost: ${(lamports / 1e9).toFixed(6)} SOL`);
    console.log(`⏳ Creating account...\n`);

    // Create transaction
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: approvalPubkey,
        lamports,
        space: data.length,
        programId: IKA_PROGRAM_ID,
      })
    );

    // Send and confirm
    const sig = await sendAndConfirmTransaction(connection, tx, [payer, approvalKp], {
      commitment: "confirmed",
    });

    console.log(`✅ Account created!\n`);
    console.log(`📋 Transaction: ${sig}\n`);

    // Save to web/.env
    const webEnvPath = path.join(__dirname, "..", "web", ".env");
    let webContent = fs.readFileSync(webEnvPath, "utf-8");
    webContent = webContent.replace(
      /NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=.*/,
      `NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=${approvalPubkey.toBase58()}`
    );
    fs.writeFileSync(webEnvPath, webContent);

    console.log(`✓ Updated web/.env`);
    console.log(`\n🎉 Ready to use!\n`);
    console.log(`✅ Step 1: Refresh browser (http://localhost:3001)\n`);
    console.log(`✅ Step 2: Click "Verify Proof" button - it should now pass!\n`);
    console.log(`🔗 Explorer:`);
    console.log(`   https://explorer.solana.com/address/${approvalPubkey.toBase58()}?cluster=devnet\n`);

  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    if (err.logs) {
      console.error("\nTransaction logs:");
      err.logs.forEach(log => console.error("  " + log));
    }
    process.exit(1);
  }
}

main();
