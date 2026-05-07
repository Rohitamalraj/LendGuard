#!/usr/bin/env node

/**
 * Verify MessageApproval account data
 */

const { Connection, PublicKey } = require("@solana/web3.js");

async function main() {
  const pubkeyStr = process.argv[2] || "Hh1YsCow3j4Ch311LaraLP8yLwoM6Kdc1AtHbgkopTGX";
  const expectedDwalletId = process.argv[3] || "ika-dwallet-btc-demo-001";

  console.log("🔍 Verifying MessageApproval account...\n");
  console.log(`   Pubkey: ${pubkeyStr}`);
  console.log(`   Expected dWallet ID: ${expectedDwalletId}\n`);

  try {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");
    const pubkey = new PublicKey(pubkeyStr);
    
    const account = await connection.getAccountInfo(pubkey);
    
    if (!account) {
      console.error("❌ Account does not exist on devnet");
      process.exit(1);
    }

    console.log(`✓ Account exists`);
    console.log(`✓ Data length: ${account.data.length} bytes`);
    console.log(`✓ Owner: ${account.owner.toBase58()}\n`);

    if (account.data.length < 49) {
      console.error("❌ Invalid data length (expected >= 49 bytes)");
      process.exit(1);
    }

    // Parse the data
    const dwalletIdBytes = account.data.subarray(8, 40);
    const dwalletIdText = Buffer.from(dwalletIdBytes).toString("utf8").replace(/\0+$/, "");
    const dwalletIdHex = Buffer.from(dwalletIdBytes).toString("hex");
    
    const approvedAt = Number(account.data.readBigInt64LE(40));
    const isSigned = account.data[48];
    
    const now = Math.floor(Date.now() / 1000);
    const age = now - approvedAt;

    console.log("📋 Account Data:");
    console.log(`   dWallet ID (text): "${dwalletIdText}"`);
    console.log(`   dWallet ID (hex): ${dwalletIdHex}`);
    console.log(`   Approved at: ${approvedAt} (${new Date(approvedAt * 1000).toISOString()})`);
    console.log(`   Age: ${age} seconds`);
    console.log(`   is_signed: ${isSigned} ${isSigned === 1 ? "✓" : "✗"}\n`);

    // Validation
    let valid = true;
    
    if (dwalletIdText !== expectedDwalletId) {
      console.error(`❌ dWallet ID mismatch!`);
      console.error(`   Expected: "${expectedDwalletId}"`);
      console.error(`   Got: "${dwalletIdText}"`);
      valid = false;
    } else {
      console.log(`✓ dWallet ID matches: "${expectedDwalletId}"`);
    }

    if (isSigned !== 1) {
      console.error(`❌ is_signed is ${isSigned} (expected 1)`);
      valid = false;
    } else {
      console.log(`✓ is_signed = 1`);
    }

    if (age > 600) {
      console.warn(`⚠️  Account is stale (${age}s old, max 600s)`);
      console.warn(`   You may need to create a fresh account for Step 2`);
      valid = false;
    } else {
      console.log(`✓ Account is fresh (${age}s old, max 600s)`);
    }

    console.log();
    if (valid) {
      console.log("✅ MessageApproval account is valid and ready to use!\n");
    } else {
      console.log("❌ MessageApproval account has validation issues\n");
      process.exit(1);
    }

  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

main();
