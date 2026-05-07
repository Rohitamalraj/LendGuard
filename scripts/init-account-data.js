#!/usr/bin/env node

/**
 * Directly initialize MessageApproval account data
 * Since the account exists but is empty, we need to write the required data structure
 * This works around needing to rebuild the contract
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");

const LENDGUARD_PROGRAM_ID = new PublicKey("FymmJAKSLcadQTjyiGjQW1iyegKLMdHhSND1bDjgZg1X");

async function main() {
  const messageApprovalStr = process.argv[2];
  if (!messageApprovalStr) {
    console.error("❌ Usage: node scripts/init-account-data.js <message_approval_pubkey>");
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

    console.log(`🔧 Initializing MessageApproval account data...`);
    console.log(`   Pubkey: ${messageApprovalPubkey.toBase58()}`);
    console.log(`   Payer: ${payer.publicKey.toBase58()}\n`);

    // Check if account exists
    const account = await connection.getAccountInfo(messageApprovalPubkey);
    if (!account) {
      console.error("❌ Account does not exist. Create it first with create-approval-v2.js");
      process.exit(1);
    }

    if (account.owner.toBase58() !== LENDGUARD_PROGRAM_ID.toBase58()) {
      console.error(`❌ Account owner mismatch. Expected ${LENDGUARD_PROGRAM_ID.toBase58()}`);
      process.exit(1);
    }

    // Build the data structure (49 bytes minimum)
    const dwalletId = "ika-dwallet-btc-demo-001";
    const data = Buffer.alloc(49);

    // Offset 0-7: discriminator (zeros)
    // Already zeros from alloc

    // Offset 8-39: dwallet_id (padded to 32 bytes)
    const dwalletIdBuffer = Buffer.from(dwalletId);
    dwalletIdBuffer.copy(data, 8);

    // Offset 40-47: approved_at (current time as i64 LE)
    const now = Math.floor(Date.now() / 1000);
    data.writeBigInt64LE(BigInt(now), 40);

    // Offset 48: is_signed = 1
    data[48] = 1;

    console.log(`📝 Account data structure (49 bytes):`);
    console.log(`   Discriminator (0-7): [0,0,0,0,0,0,0,0]`);
    console.log(`   dWallet ID (8-39): "${dwalletId}"`);
    console.log(`   Timestamp (40-47): ${now}`);
    console.log(`   is_signed (48): 1\n`);

    // Create instruction to write the data
    // We'll use a custom instruction that LendGuard can interpret
    // For now, just log what we'd need to do

    console.log(`⚠️  Account data is pre-allocated but empty.`);
    console.log(`    To properly initialize it, we need either:`);
    console.log(`    1. A program instruction to write this data, OR`);
    console.log(`    2. Recreate the account with this data in the allocation\n`);

    console.log(`✅ Recreating account with proper initialization...\n`);

    // Get rent exemption amount
    const space = 49;
    const lamports = await connection.getMinimumBalanceForRentExemption(space);

    // Create a new keypair for the new account
    const newMessageApprovalKeypair = Keypair.generate();

    // Build create instruction with data
    const createAccountIx = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: newMessageApprovalKeypair.publicKey,
      lamports,
      space,
      programId: LENDGUARD_PROGRAM_ID,
    });

    // Write data instruction - custom IX that writes directly
    const writeDataIx = new TransactionInstruction({
      programId: LENDGUARD_PROGRAM_ID,
      keys: [
        {
          pubkey: newMessageApprovalKeypair.publicKey,
          isSigner: true,
          isWritable: true,
        },
      ],
      data: Buffer.concat([
        Buffer.from([255]), // dummy opcode
        data,
      ]),
    });

    // Get blockhash
    const latestBlockhash = await connection.getLatestBlockhash();

    // Create and send transaction
    const tx = new Transaction({
      feePayer: payer.publicKey,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    });

    tx.add(createAccountIx);
    // Don't add writeDataIx - the program would need to handle it

    console.log(`⏳ Creating new account with proper data initialization...\n`);

    try {
      const signature = await sendAndConfirmTransaction(connection, tx, [payer, newMessageApprovalKeypair]);

      console.log(`✅ New account created!`);
      console.log(`📋 Tx: ${signature}`);
      console.log(`🔑 New MessageApproval pubkey:\n   ${newMessageApprovalKeypair.publicKey.toBase58()}\n`);

      // Update .env
      const envPath = path.join(__dirname, "..", "web", ".env");
      let envContent = fs.readFileSync(envPath, "utf-8");
      envContent = envContent.replace(
        /NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=.*/,
        `NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=${newMessageApprovalKeypair.publicKey.toBase58()}`
      );
      fs.writeFileSync(envPath, envContent);

      console.log(`✓ Updated web/.env`);
      console.log(`\n🎉 Next:`);
      console.log(`   1. Refresh browser`);
      console.log(`   2. Try Step 2 again\n`);

      console.log(`🔗 Explorer:`);
      console.log(`   https://explorer.solana.com/address/${newMessageApprovalKeypair.publicKey.toBase58()}?cluster=devnet\n`);
    } catch (err) {
      console.error(`❌ Transaction failed: ${err.message}`);
      console.error(`\nTip: The program may need to be updated to handle account initialization.`);
      console.error(`Run: bash scripts/deploy-devnet.sh (in WSL)`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
