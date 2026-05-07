#!/usr/bin/env node

/**
 * Generate a contract-valid MessageApproval account for local dev/demo.
 *
 * Flow:
 * 1) Create a 49-byte account owned by LendGuard program
 * 2) Call initialize_test_message_approval(dwallet_id)
 * 3) Write pubkey to web/.env as NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL
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
const RPC_URL = "https://api.devnet.solana.com";
const DEFAULT_DWALLET_ID = "ika-dwallet-btc-demo-001";

function findKeypair() {
  const possiblePaths = [
    path.join(os.homedir(), ".config", "solana", "lendguard-devnet.json"),
    path.join(os.homedir(), ".config", "solana", "id.json"),
  ];
  for (const p of possiblePaths) {
    if (!fs.existsSync(p)) continue;
    try {
      const keyData = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (Array.isArray(keyData) && keyData.length === 64) {
        return { keypair: Keypair.fromSecretKey(Buffer.from(keyData)), path: p };
      }
    } catch {}
  }
  return null;
}

function decodeBase58(str) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const map = {};
  for (let i = 0; i < alphabet.length; i += 1) map[alphabet[i]] = i;
  const bytes = [0];
  for (const ch of str) {
    const val = map[ch];
    if (val === undefined) throw new Error("Non-base58 character");
    let carry = val;
    for (let j = 0; j < bytes.length; j += 1) {
      const x = bytes[j] * 58 + carry;
      bytes[j] = x & 0xff;
      carry = x >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of str) {
    if (ch === "1") bytes.push(0);
    else break;
  }
  return Buffer.from(bytes.reverse());
}

function keypairFromWebEnv() {
  const envPath = path.join(__dirname, "..", "web", ".env");
  if (!fs.existsSync(envPath)) return null;
  const content = fs.readFileSync(envPath, "utf-8");
  const match = content.match(/^SOLANA_PRIVATE_KEY=(.+)$/m);
  if (!match || !match[1]) return null;
  const raw = match[1].trim();
  if (!raw) return null;
  if (raw.startsWith("[")) {
    const arr = JSON.parse(raw);
    return Keypair.fromSecretKey(Buffer.from(arr));
  }
  const decoded = decodeBase58(raw);
  if (decoded.length !== 64) throw new Error(`SOLANA_PRIVATE_KEY decoded length ${decoded.length}, expected 64`);
  return Keypair.fromSecretKey(decoded);
}

function ixDiscriminator(name) {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function bytes32(text) {
  const out = Buffer.alloc(32);
  Buffer.from(text, "utf8").copy(out);
  return out;
}

async function main() {
  const dwalletId = process.argv[2] || DEFAULT_DWALLET_ID;
  const found = findKeypair();
  const fromEnv = keypairFromWebEnv();
  if (!found && !fromEnv) {
    console.error("No keypair found in ~/.config/solana/* or web/.env SOLANA_PRIVATE_KEY");
    process.exit(1);
  }

  const payer = found ? found.keypair : fromEnv;
  const connection = new Connection(RPC_URL, "confirmed");
  const balance = await connection.getBalance(payer.publicKey);
  if (balance < 5_000_000) {
    console.error("Low balance. Airdrop some devnet SOL first.");
    process.exit(1);
  }

  const approval = Keypair.generate();
  const space = 49;
  const lamports = await connection.getMinimumBalanceForRentExemption(space);

  console.log(`Payer: ${payer.publicKey.toBase58()}`);
  console.log(`dWallet ID: ${dwalletId}`);
  console.log(`Creating MessageApproval account: ${approval.publicKey.toBase58()}`);

  const createTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: approval.publicKey,
      lamports,
      space,
      programId: LENDGUARD_PROGRAM_ID,
    }),
  );

  const createSig = await sendAndConfirmTransaction(connection, createTx, [payer, approval], {
    commitment: "confirmed",
  });
  console.log(`Create tx: ${createSig}`);

  const initData = Buffer.concat([
    ixDiscriminator("initialize_test_message_approval"),
    bytes32(dwalletId),
  ]);
  const initIx = new TransactionInstruction({
    programId: LENDGUARD_PROGRAM_ID,
    keys: [
      { pubkey: approval.publicKey, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    ],
    data: initData,
  });
  const initTx = new Transaction().add(initIx);
  const initSig = await sendAndConfirmTransaction(connection, initTx, [payer], {
    commitment: "confirmed",
  });
  console.log(`Init tx: ${initSig}`);

  const acct = await connection.getAccountInfo(approval.publicKey, "confirmed");
  if (!acct || acct.data.length < 49) {
    console.error("Validation failed: account missing or data too short");
    process.exit(1);
  }
  const dwalletHex = Buffer.from(acct.data.subarray(8, 40)).toString("hex");
  const isSigned = acct.data[48];
  console.log(`Validated dwallet_id hex: ${dwalletHex}`);
  console.log(`Validated is_signed: ${isSigned}`);

  const envPath = path.join(__dirname, "..", "web", ".env");
  let envContent = fs.readFileSync(envPath, "utf-8");
  if (/^NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=.*$/m.test(envContent)) {
    envContent = envContent.replace(
      /^NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=.*$/m,
      `NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=${approval.publicKey.toBase58()}`
    );
  } else {
    envContent += `\nNEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=${approval.publicKey.toBase58()}\n`;
  }
  fs.writeFileSync(envPath, envContent);

  console.log(`\nNEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=${approval.publicKey.toBase58()}`);
  console.log("Updated web/.env");
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
