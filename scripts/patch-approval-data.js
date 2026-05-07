#!/usr/bin/env node

/**
 * Patch existing MessageApproval account with required data
 * This uses Anchor's built-in transaction signing without needing to rebuild
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

async function main() {
  const messageApprovalStr = process.argv[2];
  if (!messageApprovalStr) {
    console.error("❌ Usage: node scripts/patch-approval-data.js <message_approval_pubkey>");
    console.error("   Example: node scripts/patch-approval-data.js 8jA36Uhb3MTiw1vX4mu2DDGKX6QqNvD3nUadgQDwntJi");
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
      console.error("❌ Keypair not found at ~/.config/solana/");
      process.exit(1);
    }

    const messageApprovalPubkey = new PublicKey(messageApprovalStr);
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    console.log(`🔧 Patching MessageApproval account data...`);
    console.log(`   Pubkey: ${messageApprovalPubkey.toBase58()}`);
    console.log(`   Payer: ${payer.publicKey.toBase58()}\n`);

    // Check if account exists
    const account = await connection.getAccountInfo(messageApprovalPubkey);
    if (!account) {
      console.error("❌ Account does not exist!");
      process.exit(1);
    }

    console.log(`📊 Current account:`);
    console.log(`   Owner: ${account.owner.toBase58()}`);
    console.log(`   Size: ${account.data.length} bytes`);
    console.log(`   Lamports: ${account.lamports}\n`);

    // Build patch data (only the parts we need to write)
    const dwalletId = "ika-dwallet-btc-demo-001";
    const now = Math.floor(Date.now() / 1000);

    // Create full 49-byte data buffer
    const newData = Buffer.alloc(49);
    
    // Offset 8-39: dwallet_id
    Buffer.from(dwalletId).copy(newData, 8);
    
    // Offset 40-47: approved_at (i64 LE)
    newData.writeBigInt64LE(BigInt(now), 40);
    
    // Offset 48: is_signed = 1
    newData[48] = 1;

    console.log(`📝 New data structure:`);
    console.log(`   dWallet ID: "${dwalletId}"`);
    console.log(`   Timestamp: ${now}`);
    console.log(`   is_signed: 1`);
    console.log(`   Size: 49 bytes\n`);

    // Unfortunately, we can't patch the existing account without a program instruction
    // We need to close it and recreate it with proper data
    // OR deploy a new contract instruction to handle initialization

    console.log(`⚠️  Account data cannot be patched without a program instruction.`);
    console.log(`\n📋 You have two options:\n`);
    
    console.log(`Option 1 (RECOMMENDED): Rebuild & deploy with new instruction`);
    console.log(`  • Follow HANDOFF.md Step 1-10 to set up WSL`);
    console.log(`  • Run: bash scripts/deploy-devnet.sh`);
    console.log(`  • Then: node scripts/initialize-message-approval.js ${messageApprovalStr}\n`);
    
    console.log(`Option 2: Close & recreate account with proper initialization`);
    console.log(`  • Close old account (reclaim ~0.0010 SOL)`);
    console.log(`  • Create new account with data`);
    console.log(`  • This requires a program update or custom instruction\n`);

    console.log(`⏭️  For now, proceed to test if the account data is readable as-is:`);
    console.log(`  1. Refresh http://localhost:3000`);
    console.log(`  2. Try Step 2 "Verify Proof" - you'll see what error we get`);
    console.log(`  3. If it fails, we'll know for sure we need to patch the data\n`);

  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
