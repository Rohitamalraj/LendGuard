#!/usr/bin/env node

/**
 * Initialize MessageApproval account with test data via the LendGuard program
 * Usage: node scripts/initialize-message-approval.js <message_approval_pubkey> [dwallet_id]
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } = require("@solana/web3.js");

const LENDGUARD_PROGRAM_ID = new PublicKey("FymmJAKSLcadQTjyiGjQW1iyegKLMdHhSND1bDjgZg1X");
const DEFAULT_DWALLET_ID = "ika-dwallet-btc-demo-001";

async function main() {
  const messageApprovalStr = process.argv[2];
  const dwalletId = process.argv[3] || DEFAULT_DWALLET_ID;

  if (!messageApprovalStr) {
    console.error("❌ Usage: node scripts/initialize-message-approval.js <message_approval_pubkey> [dwallet_id]");
    console.error("   Example: node scripts/initialize-message-approval.js 8jA36Uhb3MTiw1vX4mu2DDGKX6QqNvD3nUadgQDwntJi");
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
      console.error("❌ Keypair not found at ~/.config/solana/lendguard-devnet.json or ~/.config/solana/id.json");
      process.exit(1);
    }

    const messageApprovalPubkey = new PublicKey(messageApprovalStr);
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    console.log(`🔧 Initializing MessageApproval account...`);
    console.log(`   Pubkey: ${messageApprovalPubkey.toBase58()}`);
    console.log(`   dWallet ID: ${dwalletId}`);
    console.log(`   Payer: ${payer.publicKey.toBase58()}\n`);

    // Pad dwallet_id to 32 bytes
    const dwalletIdBytes = Buffer.alloc(32);
    Buffer.from(dwalletId).copy(dwalletIdBytes);

    // Create instruction discriminator for initialize_test_message_approval
    // This is the first 8 bytes of the sha256 hash of "global:initialize_test_message_approval"
    const instructionName = "initialize_test_message_approval";
    const discriminatorHash = crypto.createHash("sha256").update(`global:${instructionName}`).digest();
    const discriminator = discriminatorHash.slice(0, 8);

    // Build instruction data
    const instructionData = Buffer.concat([
      discriminator,
      dwalletIdBytes, // 32 bytes
    ]);

    // Create the instruction
    const instruction = new TransactionInstruction({
      programId: LENDGUARD_PROGRAM_ID,
      keys: [
        {
          pubkey: messageApprovalPubkey,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: payer.publicKey,
          isSigner: true,
          isWritable: false,
        },
      ],
      data: instructionData,
    });

    // Create and send transaction
    const latestBlockhash = await connection.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: payer.publicKey,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    });
    tx.add(instruction);

    console.log(`⏳ Sending transaction...`);
    const signature = await connection.sendTransaction(tx, [payer], {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    console.log(`⏳ Waiting for confirmation...\n`);
    await connection.confirmTransaction(
      {
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      "confirmed"
    );

    console.log(`✅ MessageApproval initialized!`);
    console.log(`📋 Tx: ${signature}`);
    console.log(`🔗 Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet\n`);

    // Verify
    const accountData = await connection.getAccountInfo(messageApprovalPubkey);
    if (accountData && accountData.data.length >= 49) {
      const isSignedByte = accountData.data[48];
      console.log(`✓ Account data verified: is_signed = ${isSignedByte}`);
      console.log(`✓ Ready for Step 2!\n`);
    }
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
