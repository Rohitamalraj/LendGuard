#!/usr/bin/env node

/**
 * Create a working MessageApproval account by using the LendGuard program
 * This uses the initialize_test_message_approval instruction with correct discriminator
 */

const fs = require("fs");
const path = require("path");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");
const crypto = require("crypto");

const LENDGUARD_PROGRAM_ID = new PublicKey("FymmJAKSLcadQTjyiGjQW1iyegKLMdHhSND1bDjgZg1X");
const IKA_PROGRAM_ID = new PublicKey("87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY");
const DEFAULT_DWALLET_ID = "ika-dwallet-btc-demo-001";

// Base58 decoder
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

async function main() {
  const dwalletId = process.argv[2] || DEFAULT_DWALLET_ID;

  console.log("🔧 Creating and initializing MessageApproval account...\n");

  try {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");
    
    // Load payer
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
      console.error("❌ SOLANA_PRIVATE_KEY not found");
      process.exit(1);
    }
    
    const secretKey = bs58.decode(privateKey);
    payerKeypair = Keypair.fromSecretKey(secretKey);

    console.log(`✓ Payer: ${payerKeypair.publicKey.toBase58()}`);

    const balance = await connection.getBalance(payerKeypair.publicKey);
    console.log(`✓ Balance: ${(balance / 1e9).toFixed(4)} SOL\n`);

    // Step 1: Create the account
    const approvalKeypair = Keypair.generate();
    const lamports = await connection.getMinimumBalanceForRentExemption(49);

    console.log(`📝 Creating account: ${approvalKeypair.publicKey.toBase58()}`);
    
    const createTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payerKeypair.publicKey,
        newAccountPubkey: approvalKeypair.publicKey,
        lamports,
        space: 49,
        programId: IKA_PROGRAM_ID,
      })
    );

    const createSig = await sendAndConfirmTransaction(connection, createTx, [
      payerKeypair,
      approvalKeypair,
    ]);
    
    console.log(`✓ Account created: ${createSig.slice(0, 16)}...\n`);

    // Step 2: Initialize with LendGuard program
    console.log(`📝 Initializing account data with dWallet ID: ${dwalletId}`);
    
    const dwalletIdPadded = Buffer.alloc(32);
    Buffer.from(dwalletId).copy(dwalletIdPadded);

    // Calculate Anchor discriminator for initialize_test_message_approval
    // Anchor uses: sighash("global", "initialize_test_message_approval")
    const preimage = `global:initialize_test_message_approval`;
    const discriminatorHash = crypto.createHash("sha256").update(preimage).digest();
    const discriminator = discriminatorHash.slice(0, 8);

    console.log(`   Discriminator: ${discriminator.toString("hex")}`);

    const instructionData = Buffer.concat([discriminator, dwalletIdPadded]);

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
    
    console.log(`⏳ Sending initialization transaction...`);
    
    try {
      const initSig = await sendAndConfirmTransaction(connection, initTx, [payerKeypair], {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      
      console.log(`✓ Initialized: ${initSig.slice(0, 16)}...\n`);
    } catch (err) {
      console.error(`❌ Initialization failed: ${err.message}`);
      if (err.logs) {
        console.error("\nTransaction logs:");
        err.logs.forEach(log => console.error(`   ${log}`));
      }
      console.error("\n⚠️  The account was created but initialization failed.");
      console.error("   This might be because:");
      console.error("   1. The LendGuard program needs to be redeployed");
      console.error("   2. The discriminator calculation is incorrect");
      console.error("   3. The instruction doesn't exist in the deployed program\n");
      
      console.error("📍 Account pubkey (created but uninitialized):");
      console.error(`   ${approvalKeypair.publicKey.toBase58()}\n`);
      
      console.error("💡 Workaround: Use this pubkey and modify the demo to skip validation");
      process.exit(1);
    }

    // Verify the account
    console.log("🔍 Verifying account data...");
    const accountInfo = await connection.getAccountInfo(approvalKeypair.publicKey);
    
    if (accountInfo && accountInfo.data.length >= 49) {
      const dwalletIdBytes = accountInfo.data.subarray(8, 40);
      const dwalletIdText = Buffer.from(dwalletIdBytes).toString("utf8").replace(/\0+$/, "");
      const approvedAt = Number(accountInfo.data.readBigInt64LE(40));
      const isSigned = accountInfo.data[48];
      
      console.log(`   dWallet ID: "${dwalletIdText}"`);
      console.log(`   Approved at: ${approvedAt}`);
      console.log(`   is_signed: ${isSigned}\n`);
      
      if (dwalletIdText === dwalletId && isSigned === 1) {
        console.log("✅ Account successfully initialized!\n");
      } else {
        console.warn("⚠️  Account data doesn't match expected values\n");
      }
    }

    // Update .env
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
      console.log(`✓ Updated web/.env\n`);
    }

    console.log(`📍 MessageApproval pubkey:`);
    console.log(`   ${approvalKeypair.publicKey.toBase58()}\n`);
    
    console.log(`🔗 Explorer:`);
    console.log(`   https://explorer.solana.com/address/${approvalKeypair.publicKey.toBase58()}?cluster=devnet\n`);
    
    console.log(`📋 Next steps:`);
    console.log(`   1. Restart your dev server (if running)`);
    console.log(`   2. Refresh the demo page`);
    console.log(`   3. Run Step 2 (Verify Custody Proof)\n`);

  } catch (err) {
    console.error("❌ Error:", err.message);
    if (err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
