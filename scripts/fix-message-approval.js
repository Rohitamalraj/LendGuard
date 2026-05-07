#!/usr/bin/env node

/**
 * Fix MessageApproval: Create a NEW properly initialized account
 * This bypasses the uninitialized account issue by creating a fresh one
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
const DEFAULT_DWALLET_ID = "ika-dwallet-btc-demo-001";

async function main() {
  const dwalletId = process.argv[2] || DEFAULT_DWALLET_ID;

  console.log("🔧 Creating NEW MessageApproval account with proper initialization...\n");

  try {
    // Load connection
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");
    
    // Load payer from env
    const envPaths = [
      path.join(__dirname, ".env"),
      path.join(__dirname, "..", ".env"),
      path.join(__dirname, "..", "web", ".env"),
    ];
    
    let payerKeypair;
    let privateKey;
    
    for (const envPath of envPaths) {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        const match = content.match(/SOLANA_PRIVATE_KEY=(.+)/);
        if (match && match[1]?.trim()) {
          privateKey = match[1].trim();
          break;
        }
      }
    }
    
    if (!privateKey) {
      console.error("❌ SOLANA_PRIVATE_KEY not found in .env files");
      process.exit(1);
    }
    
    // Parse the private key (base58 format)
    try {
      // The key is in base58 format, use Keypair.fromSecretKey with decoded bytes
      // For base58 strings, we need to decode them first
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
      
      const secretKey = bs58.decode(privateKey);
      payerKeypair = Keypair.fromSecretKey(secretKey);
    } catch (err) {
      console.error("❌ Could not parse SOLANA_PRIVATE_KEY:", err.message);
      console.error("   Expected base58 string format");
      process.exit(1);
    }

    console.log(`✓ Payer: ${payerKeypair.publicKey.toBase58()}`);

    // Check balance
    const balance = await connection.getBalance(payerKeypair.publicKey);
    console.log(`✓ Balance: ${(balance / 1e9).toFixed(4)} SOL\n`);
    
    if (balance < 5_000_000) {
      console.warn("⚠️  Low balance. Run: solana airdrop 2 --url devnet");
      process.exit(1);
    }

    // Generate NEW MessageApproval account
    const approvalKeypair = Keypair.generate();
    const approvedAt = Math.floor(Date.now() / 1000);

    // Pad dwallet_id to 32 bytes
    const dwalletIdPadded = Buffer.alloc(32);
    Buffer.from(dwalletId).copy(dwalletIdPadded);

    // Build account data (49 bytes)
    // Offset 0-7: discriminator (zeros for mock)
    // Offset 8-39: dwallet_id (32 bytes)
    // Offset 40-47: approved_at (i64 LE)
    // Offset 48: is_signed (1 = signed)
    const data = Buffer.alloc(49);
    dwalletIdPadded.copy(data, 8);
    data.writeBigInt64LE(BigInt(approvedAt), 40);
    data.writeUInt8(1, 48);

    const lamports = await connection.getMinimumBalanceForRentExemption(data.length);

    console.log(`📝 Creating account:`);
    console.log(`   Pubkey: ${approvalKeypair.publicKey.toBase58()}`);
    console.log(`   dWallet ID: ${dwalletId}`);
    console.log(`   Timestamp: ${approvedAt}`);
    console.log(`   Cost: ${(lamports / 1e9).toFixed(6)} SOL\n`);

    // Create the account with data
    // We need to use a custom instruction to write data after account creation
    // Since we can't write data directly with SystemProgram.createAccount,
    // we'll use the account's data field after creation
    
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payerKeypair.publicKey,
        newAccountPubkey: approvalKeypair.publicKey,
        lamports,
        space: data.length,
        programId: IKA_PROGRAM_ID,
      })
    );

    console.log("⏳ Sending create account transaction...");
    const sig = await sendAndConfirmTransaction(connection, tx, [
      payerKeypair,
      approvalKeypair,
    ]);
    
    console.log("✓ Account created, now writing data...\n");
    
    // Now we need to write the data using a custom instruction
    // Since the account is owned by IKA_PROGRAM_ID, we need to use that program
    // to write data. For devnet testing, we'll use a workaround:
    // Create a new account with the data already set using a different approach
    
    // Actually, let's use the LendGuard program's initialize_test_message_approval instruction
    const crypto = require("crypto");
    const instructionName = "initialize_test_message_approval";
    const discriminatorHash = crypto.createHash("sha256").update(`global:${instructionName}`).digest();
    const discriminator = discriminatorHash.slice(0, 8);
    
    const instructionData = Buffer.concat([discriminator, dwalletIdPadded]);
    
    const { TransactionInstruction } = require("@solana/web3.js");
    const LENDGUARD_PROGRAM_ID = new PublicKey("FymmJAKSLcadQTjyiGjQW1iyegKLMdHhSND1bDjgZg1X");
    
    const initInstruction = new TransactionInstruction({
      programId: LENDGUARD_PROGRAM_ID,
      keys: [
        {
          pubkey: approvalKeypair.publicKey,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: payerKeypair.publicKey,
          isSigner: true,
          isWritable: false,
        },
      ],
      data: instructionData,
    });
    
    const initTx = new Transaction().add(initInstruction);
    const latestBlockhash = await connection.getLatestBlockhash();
    initTx.feePayer = payerKeypair.publicKey;
    initTx.recentBlockhash = latestBlockhash.blockhash;
    
    console.log("⏳ Sending initialize data transaction...");
    const initSig = await sendAndConfirmTransaction(connection, initTx, [payerKeypair]);

    console.log(`\n✅ MessageApproval created successfully!\n`);
    console.log(`📍 NEW MessageApproval pubkey:`);
    console.log(`   ${approvalKeypair.publicKey.toBase58()}\n`);
    
    console.log(`🔗 Explorer:`);
    console.log(`   https://explorer.solana.com/address/${approvalKeypair.publicKey.toBase58()}?cluster=devnet\n`);
    
    console.log(`✅ Transaction: ${sig}\n`);

    // Update web/.env
    const webEnvPath = path.join(__dirname, "..", "web", ".env");
    if (fs.existsSync(webEnvPath)) {
      let envContent = fs.readFileSync(webEnvPath, "utf-8");
      
      if (envContent.includes("NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=")) {
        envContent = envContent.replace(
          /NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=.*/,
          `NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=${approvalKeypair.publicKey.toBase58()}`
        );
      } else {
        envContent += `\nNEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=${approvalKeypair.publicKey.toBase58()}\n`;
      }
      
      fs.writeFileSync(webEnvPath, envContent);
      console.log(`✓ Updated web/.env with new pubkey\n`);
    }

    console.log(`📋 Next steps:`);
    console.log(`   1. Restart your dev server (if running)`);
    console.log(`   2. Refresh the demo page`);
    console.log(`   3. Run Step 2 (Verify Custody Proof)\n`);
    
    console.log(`💡 Or paste this pubkey directly in Step 2 input:`);
    console.log(`   ${approvalKeypair.publicKey.toBase58()}\n`);

  } catch (err) {
    console.error("❌ Error:", err.message);
    if (err.logs) {
      console.error("\nLogs:", err.logs);
    }
    process.exit(1);
  }
}

main();
