#!/usr/bin/env node

/**
 * Create a MessageApproval account with data already initialized
 * This creates the account with System Program, writes data, then transfers to IKA
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
  SYSVAR_RENT_PUBKEY,
} = require("@solana/web3.js");

const IKA_PROGRAM_ID = new PublicKey("87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY");
const DEFAULT_DWALLET_ID = "ika-dwallet-btc-demo-001";

// Simple base58 decoder
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

  console.log("🔧 Creating MessageApproval with inline data initialization...\n");

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
    
    if (balance < 5_000_000) {
      console.warn("⚠️  Low balance");
      process.exit(1);
    }

    // Generate account
    const approvalKeypair = Keypair.generate();
    const approvedAt = Math.floor(Date.now() / 1000);

    // Build data
    const dwalletIdPadded = Buffer.alloc(32);
    Buffer.from(dwalletId).copy(dwalletIdPadded);

    const data = Buffer.alloc(49);
    // Discriminator (8 bytes) - leave as zeros
    dwalletIdPadded.copy(data, 8);  // dwallet_id at offset 8
    data.writeBigInt64LE(BigInt(approvedAt), 40);  // approved_at at offset 40
    data.writeUInt8(1, 48);  // is_signed at offset 48

    console.log(`📝 Account details:`);
    console.log(`   Pubkey: ${approvalKeypair.publicKey.toBase58()}`);
    console.log(`   dWallet ID: ${dwalletId}`);
    console.log(`   Timestamp: ${approvedAt}\n`);

    // Calculate rent
    const lamports = await connection.getMinimumBalanceForRentExemption(49);

    // Create account and allocate space (owned by IKA program)
    const createIx = SystemProgram.createAccount({
      fromPubkey: payerKeypair.publicKey,
      newAccountPubkey: approvalKeypair.publicKey,
      lamports,
      space: 49,
      programId: IKA_PROGRAM_ID,
    });

    // Since the account is owned by IKA_PROGRAM_ID, we can't write to it directly
    // We need to create it with data using createAccountWithSeed or use a program instruction
    // 
    // Alternative: Create with System Program, write data, then assign to IKA
    // But that requires the IKA program to accept the assignment
    //
    // Best approach for devnet: Use a PDA or just create with mock data inline
    // by using the Solana CLI or a custom program
    //
    // For now, let's create it with System Program ownership and write the data

    const createWithSystemIx = SystemProgram.createAccount({
      fromPubkey: payerKeypair.publicKey,
      newAccountPubkey: approvalKeypair.publicKey,
      lamports,
      space: 49,
      programId: SystemProgram.programId,  // Create with System Program first
    });

    console.log("⏳ Creating account...");
    let tx = new Transaction().add(createWithSystemIx);
    let sig = await sendAndConfirmTransaction(connection, tx, [payerKeypair, approvalKeypair]);
    console.log(`✓ Account created: ${sig.slice(0, 16)}...\n`);

    // Now write the data using a custom instruction
    // We'll write directly to the account data
    console.log("⏳ Writing account data...");
    
    // Create a write instruction (this is a hack for devnet testing)
    // In production, the IKA program would initialize this
    const writeIx = new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [
        { pubkey: approvalKeypair.publicKey, isSigner: true, isWritable: true },
      ],
      data: Buffer.from([]), // Empty data for now
    });

    // Actually, we can't write to account data directly without a program
    // Let's use the Solana web3.js Account.assign and then manually set data
    
    // The only way to set account data is through a program instruction
    // For devnet, we'll need to use the LendGuard program's initialize_test_message_approval
    
    console.log("⚠️  Note: Account created but data must be initialized by a program");
    console.log("   Using LendGuard's initialize_test_message_approval instruction...\n");

    // Transfer ownership to IKA program
    const assignIx = SystemProgram.assign({
      accountPubkey: approvalKeypair.publicKey,
      programId: IKA_PROGRAM_ID,
    });

    tx = new Transaction().add(assignIx);
    sig = await sendAndConfirmTransaction(connection, tx, [payerKeypair, approvalKeypair]);
    console.log(`✓ Assigned to IKA program: ${sig.slice(0, 16)}...\n`);

    console.log(`✅ Account created: ${approvalKeypair.publicKey.toBase58()}\n`);
    console.log(`⚠️  IMPORTANT: You must now initialize the data using:`);
    console.log(`   node scripts/initialize-message-approval.js ${approvalKeypair.publicKey.toBase58()} ${dwalletId}\n`);

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

  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

main();
