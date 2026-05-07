#!/usr/bin/env node

/**
 * Create a mock MessageApproval account on devnet for demo usage.
 * Outputs the pubkey so you can paste it into the demo page.
 *
 * Usage:
 *   node scripts/create-message-approval.js
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

const IKA_PROGRAM_ID = new PublicKey(
  "87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY"
);

// Mock dWallet ID (same as demo uses)
const MOCK_DWALLET_ID = Buffer.from("ika-dwallet-btc-demo-001");
const dwalletIdPadded = Buffer.alloc(32);
MOCK_DWALLET_ID.copy(dwalletIdPadded);

// Simple base58 decoder (inline to avoid dependency)
const bs58 = (() => {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const ALPHABET_MAP = {};
  for (let i = 0; i < ALPHABET.length; i++) {
    ALPHABET_MAP[ALPHABET[i]] = i;
  }
  
  return {
    decode: (str) => {
      if (str.length === 0) return Buffer.alloc(0);
      const bytes = [0];
      for (let i = 0; i < str.length; i++) {
        const value = ALPHABET_MAP[str[i]];
        if (value === undefined) throw new Error('Invalid base58 character');
        for (let j = 0; j < bytes.length; j++) {
          bytes[j] *= 58;
        }
        bytes[0] += value;
        let carry = 0;
        for (let j = 0; j < bytes.length; j++) {
          bytes[j] += carry;
          carry = bytes[j] >> 8;
          bytes[j] &= 0xff;
        }
        while (carry > 0) {
          bytes.push(carry & 0xff);
          carry >>= 8;
        }
      }
      for (let i = 0; i < str.length && str[i] === '1'; i++) {
        bytes.push(0);
      }
      return Buffer.from(bytes.reverse());
    }
  };
})();

async function createMessageApproval() {
  try {
    console.log("📝 Creating mock MessageApproval account on devnet...\n");

    // Load connection + payer
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");
    
    // Try to load payer from env (check multiple locations)
    let payerKeypair;
    const possibleEnvPaths = [
      path.join(__dirname, ".env"), // scripts/.env
      path.join(__dirname, "..", ".env"), // root .env
      path.join(__dirname, "..", "web", ".env"), // web/.env
    ];
    
    let envContent = null;
    let usedPath = null;
    for (const envPath of possibleEnvPaths) {
      try {
        if (fs.existsSync(envPath)) {
          envContent = fs.readFileSync(envPath, "utf-8");
          usedPath = envPath;
          break;
        }
      } catch (e) {
        // ignore
      }
    }
    
    if (!envContent) {
      console.error("❌ Could not find .env file (checked scripts/.env, .env, web/.env)");
      process.exit(1);
    }
    
    const privateKeyMatch = envContent.match(/SOLANA_PRIVATE_KEY=(.+)/);
    
    if (privateKeyMatch && privateKeyMatch[1]?.trim()) {
      try {
        const keyStr = privateKeyMatch[1].trim();
        let secretKey;
        
        // Try JSON array first
        try {
          secretKey = Buffer.from(JSON.parse(keyStr));
        } catch {
          // Try base58 (using inline decoder)
          secretKey = bs58.decode(keyStr);
        }
        
        payerKeypair = Keypair.fromSecretKey(secretKey);
        console.log(`✓ Loaded payer from: ${usedPath}`);
        console.log(`✓ Payer address: ${payerKeypair.publicKey.toBase58()}\n`);
      } catch (err) {
        console.error("❌ Could not parse SOLANA_PRIVATE_KEY from .env");
        console.error(`   File: ${usedPath}`);
        console.error(`   Error: ${err.message}`);
        console.error("\n   Key must be in one of these formats:");
        console.error("     1. Base58 string (58 chars): 31f1tJSDbu46NoNZ4UwtVnUn4w2S2SYHS88gYEnSPUL...");
        console.error("     2. JSON array: [1,2,3,...]");
        console.error("\n   Get your key from: solana config get");
        process.exit(1);
      }
    } else {
      console.error("❌ SOLANA_PRIVATE_KEY not set in .env");
      console.error(`   Checked: ${possibleEnvPaths.join(", ")}`);
      console.error("   Set SOLANA_PRIVATE_KEY=<your_keypair> first");
      process.exit(1);
    }

    // Check balance
    const balance = await connection.getBalance(payerKeypair.publicKey);
    if (balance < 5_000_000) {
      console.warn(
        `⚠️  Low balance: ${(balance / 1e9).toFixed(2)} SOL. Need at least 0.005 SOL.`
      );
      console.warn("   Run: solana airdrop 2 --url devnet");
      process.exit(1);
    }

    // Generate the MessageApproval account
    const approvalKeypair = Keypair.generate();
    const approvedAt = Math.floor(Date.now() / 1000);

    // Build account data (mimics mock-message-approval.ts)
    const data = Buffer.alloc(49);
    dwalletIdPadded.slice(0, 32).forEach((b, i) => data.writeUInt8(b, 8 + i));
    data.writeBigInt64LE(BigInt(approvedAt), 40);
    data.writeUInt8(1, 48); // is_signed = 1

    const lamports = await connection.getMinimumBalanceForRentExemption(data.length);

    // Create the transaction
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payerKeypair.publicKey,
        newAccountPubkey: approvalKeypair.publicKey,
        lamports,
        space: data.length,
        programId: IKA_PROGRAM_ID,
      })
    );

    console.log(`   Creating account: ${approvalKeypair.publicKey.toBase58()}`);
    console.log(`   Cost: ${(lamports / 1e9).toFixed(6)} SOL\n`);

    // Send transaction
    const sig = await sendAndConfirmTransaction(connection, tx, [
      payerKeypair,
      approvalKeypair,
    ]);

    console.log(`✓ Account created!\n`);
    console.log(`📍 MessageApproval pubkey:`);
    console.log(`   ${approvalKeypair.publicKey.toBase58()}\n`);
    
    console.log(`📝 To use in demo:\n`);
    console.log(`   Option A (one-time, no restart needed):`);
    console.log(`     • Paste pubkey into Step 2 input on /demo page\n`);
    
    console.log(`   Option B (persistent, requires restart):`);
    console.log(`     • Add to web/.env:`);
    console.log(`       NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=${approvalKeypair.publicKey.toBase58()}\n`);
    console.log(`     • Restart: npm run dev\n`);

    console.log(`🔗 View on Explorer:`);
    console.log(`   https://explorer.solana.com/address/${approvalKeypair.publicKey.toBase58()}?cluster=devnet\n`);

    console.log(`✓ Transaction: ${sig}`);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

createMessageApproval();
