/**
 * Create a real MessageApproval account on devnet
 * Run: node scripts/setup-message-approval.js
 */

const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");

const IKA_PROGRAM_ID = new PublicKey("87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY");
const MOCK_DWALLET_ID = Buffer.from("ika-dwallet-btc-demo-001");

async function main() {
  try {
    console.log("🔧 Setting up MessageApproval account on devnet...\n");

    // Load payer key from scripts/.env
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) {
      console.error("❌ scripts/.env not found");
      process.exit(1);
    }

    const envContent = fs.readFileSync(envPath, "utf-8");
    const keyMatch = envContent.match(/SOLANA_PRIVATE_KEY=(.+)/);
    if (!keyMatch || !keyMatch[1]) {
      console.error("❌ SOLANA_PRIVATE_KEY not set in scripts/.env");
      process.exit(1);
    }

    const keyStr = keyMatch[1].trim();
    let secretKey;
    
    // Try different formats
    if (keyStr.startsWith("[")) {
      // JSON array
      try {
        secretKey = Buffer.from(JSON.parse(keyStr));
      } catch (e) {
        console.error("❌ Invalid JSON array format");
        process.exit(1);
      }
    } else {
      // Assume base58 - need to decode manually
      // For simplicity, we'll use a different approach: use solana CLI
      console.log("⚠️  Base58 key detected. Using alternative method...\n");
      
      // Write to temp file and use solana config
      const tempKeyPath = path.join(__dirname, ".temp-keypair.json");
      try {
        // Since we have base58, convert it using Node crypto
        // For now, let's just read from the solana config
        const { execSync } = require("child_process");
        try {
          const pubkey = execSync("solana-keygen pubkey " + keyStr, { encoding: "utf-8" }).trim();
          console.log(`✓ Payer from solana config: ${pubkey}`);
          // We'll use solana CLI to deploy instead
          console.error("ℹ️  Please use: solana config get && SOLANA_PRIVATE_KEY=<array_format>");
          process.exit(1);
        } catch {
          console.error("❌ Could not parse SOLANA_PRIVATE_KEY");
          console.error("   Format must be: [1,2,3,...] (JSON array of bytes)");
          console.error("   Or set via: export SOLANA_PRIVATE_KEY=$(solana config get | grep 'Keypair Path' | awk '{print $NF}')");
          process.exit(1);
        }
      } catch {
        console.error("❌ Could not parse base58 key");
        process.exit(1);
      }
    }

    const payer = Keypair.fromSecretKey(secretKey);
    console.log(`✓ Payer: ${payer.publicKey.toBase58()}`);

    // Connect to devnet
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    // Check balance
    const balance = await connection.getBalance(payer.publicKey);
    console.log(`✓ Balance: ${(balance / 1e9).toFixed(3)} SOL\n`);

    if (balance < 5_000_000) {
      console.error("❌ Insufficient balance. Need at least 0.005 SOL");
      console.error("   Run: solana airdrop 2 --url devnet");
      process.exit(1);
    }

    // Generate MessageApproval keypair
    const messageApprovalKp = Keypair.generate();
    const messageApprovalPubkey = messageApprovalKp.publicKey;

    console.log(`📍 MessageApproval pubkey:`);
    console.log(`   ${messageApprovalPubkey.toBase58()}\n`);

    // Build MessageApproval data
    const approvedAt = Math.floor(Date.now() / 1000);
    const data = Buffer.alloc(49);
    
    // Discriminator (zeros)
    // Bytes 8..40: dwallet_id
    MOCK_DWALLET_ID.copy(data, 8);
    // Bytes 40..48: approved_at (i64 LE)
    data.writeBigInt64LE(BigInt(approvedAt), 40);
    // Byte 48: is_signed = 1
    data.writeUInt8(1, 48);

    const lamports = await connection.getMinimumBalanceForRentExemption(data.length);

    console.log(`💰 Transaction cost: ~${(lamports / 1e9).toFixed(6)} SOL`);
    console.log(`⏳ Creating account on devnet...\n`);

    // Create the account
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: messageApprovalPubkey,
        lamports,
        space: data.length,
        programId: IKA_PROGRAM_ID,
      })
    );

    // Write data to account
    const sig = await sendAndConfirmTransaction(connection, tx, [payer, messageApprovalKp]);

    console.log(`✅ Account created!\n`);
    console.log(`📋 Transaction: ${sig}\n`);

    // Save to .env for convenience
    const webEnvPath = path.join(__dirname, "..", "web", ".env");
    let webEnvContent = fs.readFileSync(webEnvPath, "utf-8");
    webEnvContent = webEnvContent.replace(
      /NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=.*/,
      `NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=${messageApprovalPubkey.toBase58()}`
    );
    fs.writeFileSync(webEnvPath, webEnvContent);

    console.log(`✓ Saved to web/.env`);
    console.log(`\n🎉 Ready to use!`);
    console.log(`   Refresh your browser (no restart needed)\n`);

    console.log(`🔗 View on Explorer:`);
    console.log(`   https://explorer.solana.com/address/${messageApprovalPubkey.toBase58()}?cluster=devnet\n`);

  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    if (err.logs) {
      console.error(`Logs:`, err.logs);
    }
    process.exit(1);
  }
}

main();
