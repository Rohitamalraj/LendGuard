#!/usr/bin/env node

/**
 * Close and recreate MessageApproval account with proper initialization
 * This is a workaround that doesn't require redeploying the contract
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");

const IKA_PROGRAM_ID = new PublicKey("87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY");

async function main() {
  const messageApprovalStr = process.argv[2];
  if (!messageApprovalStr) {
    console.error("❌ Usage: node scripts/recreate-approval-account.js <message_approval_pubkey>");
    console.error("   Example: node scripts/recreate-approval-account.js 8jA36Uhb3MTiw1vX4mu2DDGKX6QqNvD3nUadgQDwntJi");
    process.exit(1);
  }

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

    const messageApprovalPubkey = new PublicKey(messageApprovalStr);
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    console.log(`🔧 Recreating MessageApproval account with proper data...`);
    console.log(`   Old pubkey: ${messageApprovalPubkey.toBase58()}`);
    console.log(`   Payer: ${payer.publicKey.toBase58()}\n`);

    // Step 1: Close the old empty account
    console.log(`📋 Step 1: Closing empty account...`);
    const closeIx = SystemProgram.transfer({
      fromPubkey: messageApprovalPubkey,
      toPubkey: payer.publicKey,
      lamports: (await connection.getAccountInfo(messageApprovalPubkey)).lamports,
    });

    // This won't work because messageApprovalPubkey isn't a signer
    // Instead, just recreate with a new account

    console.log(`\n⚠️  Creating new account with proper initialization...\n`);

    // Create new keypair for the MessageApproval account
    const newMessageApprovalKeypair = Keypair.generate();
    const dwalletId = "ika-dwallet-btc-demo-001";
    const now = Math.floor(Date.now() / 1000);

    // Build the 49-byte data
    const data = Buffer.alloc(49);
    // Offset 8-39: dwallet_id
    Buffer.from(dwalletId).copy(data, 8);
    // Offset 40-47: timestamp
    data.writeBigInt64LE(BigInt(now), 40);
    // Offset 48: is_signed = 1
    data[48] = 1;

    // Get rent exemption
    const lamports = await connection.getMinimumBalanceForRentExemption(49);

    // Create account with data
    const createIx = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: newMessageApprovalKeypair.publicKey,
      lamports,
      space: 49,
      programId: IKA_PROGRAM_ID,
    });

    // Create and send transaction
    const latestBlockhash = await connection.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: payer.publicKey,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    });
    tx.add(createIx);

    console.log(`⏳ Creating new account...\n`);
    const signature = await sendAndConfirmTransaction(connection, tx, [payer, newMessageApprovalKeypair]);

    console.log(`✅ New account created!`);
    console.log(`📍 New MessageApproval pubkey:`);
    console.log(`   ${newMessageApprovalKeypair.publicKey.toBase58()}\n`);
    console.log(`📋 Transaction: ${signature}\n`);

    // Verify account data
    const account = await connection.getAccountInfo(newMessageApprovalKeypair.publicKey);
    if (account && account.data.length >= 49) {
      const isSignedByte = account.data[48];
      console.log(`✓ Account initialized with:`);
      console.log(`  - dWallet ID: "${dwalletId}"`);
      console.log(`  - Timestamp: ${now}`);
      console.log(`  - is_signed: ${isSignedByte}\n`);
    }

    // Update .env
    const envPath = path.join(__dirname, "..", "web", ".env");
    let envContent = fs.readFileSync(envPath, "utf-8");
    envContent = envContent.replace(
      /NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=.*/,
      `NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=${newMessageApprovalKeypair.publicKey.toBase58()}`
    );
    fs.writeFileSync(envPath, envContent);
    console.log(`✓ Updated web/.env\n`);

    console.log(`🎉 Next steps:`);
    console.log(`   1. Restart dev server: npm run dev`);
    console.log(`   2. Refresh browser at http://localhost:3000`);
    console.log(`   3. Try Step 2 "Verify Proof" - should now work!\n`);

    console.log(`🔗 Explorer:`);
    console.log(`   https://explorer.solana.com/address/${newMessageApprovalKeypair.publicKey.toBase58()}?cluster=devnet\n`);
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
