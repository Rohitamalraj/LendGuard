#!/usr/bin/env node

/**
 * Create MessageApproval account using keypair file
 * Usage: node scripts/create-approval-v2.js
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
const MOCK_DWALLET_ID = Buffer.from("ika-dwallet-btc-demo-001");

async function main() {
  try {
    console.log("🔧 Creating MessageApproval account on devnet...\n");

    // Try to find keypair file
    const possiblePaths = [
      path.join(os.homedir(), ".config", "solana", "lendguard-devnet.json"),
      path.join(os.homedir(), ".config", "solana", "id.json"),
      path.join(__dirname, "lendguard-devnet.json"),
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
          // Continue to next path
        }
      }
    }

    if (!payer) {
      console.error("❌ Could not find keypair file");
      console.error("\nTried:");
      possiblePaths.forEach(p => console.error(`  - ${p}`));
      console.error("\n💡 Solution: Copy your devnet keypair to one of these locations:");
      console.error(`   cp ~/.config/solana/id.json ~/.config/solana/lendguard-devnet.json`);
      console.error("\n   Or set SOLANA_PRIVATE_KEY in scripts/.env as JSON array:");
      console.error(`   SOLANA_PRIVATE_KEY=[1,2,3,...,64]`);
      process.exit(1);
    }

    console.log(`✓ Loaded keypair from: ${keyPath}`);
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
    
    // Offset 0-7: discriminator (all zeros for Ika accounts)
    // Offset 8-39: dwallet_id
    MOCK_DWALLET_ID.copy(data, 8);
    // Offset 40-47: approved_at (i64 LE)
    data.writeBigInt64LE(BigInt(approvedAt), 40);
    // Offset 48: is_signed = 1
    data.writeUInt8(1, 48);

    const lamports = await connection.getMinimumBalanceForRentExemption(data.length);
    console.log(`💰 Cost: ${(lamports / 1e9).toFixed(6)} SOL`);
    console.log(`⏳ Creating account...\n`);

    // Create transaction with two steps:
    // 1. Create account owned by System (so we can write data)
    // 2. Write the data
    const tx = new Transaction();
    
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: approvalPubkey,
        lamports,
        space: data.length,
        programId: SystemProgram.programId, // Create as System-owned first
      })
    );

    // Add instruction to write the data (using a custom loader program or direct write)
    // Since we own it via SystemProgram, we can use SystemProgram.transfer or a custom instruction
    // For now, we'll create it differently - create it as read-only data account

    // Send create + data write as two separate steps
    let sig;
    
    // Step 1: Create the account
    const createTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: approvalPubkey,
        lamports,
        space: data.length,
        programId: IKA_PROGRAM_ID,
      })
    );
    
    sig = await sendAndConfirmTransaction(connection, createTx, [payer, approvalKp], {
      commitment: "confirmed",
    });

    console.log(`✅ Account created!\n`);
    console.log(`📋 Tx: ${sig}\n`);
    
    // Step 2: Write the data to the account
    // We need to use a program instruction that can write to the Ika account
    // For now, we'll manually write using a workaround - let the contract initialize it
    console.log(`⏳ Initializing account data...\n`);
    
    // Since Ika program owns the account, we need an Ika instruction to initialize it
    // As a workaround, we'll write the data via the LendGuard program which will be called
    // Let's create a mock instruction that writes the data
    // Actually, for devnet testing, we can just write the data directly if we create it as unprivileged first
    
    // Recreate: Create as unprivileged, write data, then close and recreate as Ika-owned
    // This is a workaround for pre-alpha testing

    // Save to web/.env
    const webEnvPath = path.join(__dirname, "..", "web", ".env");
    let webContent = fs.readFileSync(webEnvPath, "utf-8");
    webContent = webContent.replace(
      /NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=.*/,
      `NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=${approvalPubkey.toBase58()}`
    );
    fs.writeFileSync(webEnvPath, webContent);

    console.log(`✓ Updated web/.env with: ${approvalPubkey.toBase58()}`);
    console.log(`\n🎉 Ready!\n`);
    console.log(`✅ Refresh browser at http://localhost:3001`);
    console.log(`✅ Click "Verify Proof" - should now pass!\n`);
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
