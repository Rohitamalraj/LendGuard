/**
 * Simple setup: generate pubkey and save to env
 * Run: node scripts/simple-setup.js
 */

const fs = require("fs");
const path = require("path");
const { Keypair } = require("@solana/web3.js");

// Generate a random MessageApproval pubkey
const approvalKp = Keypair.generate();
const pubkey = approvalKp.publicKey.toBase58();

console.log("\n📍 MessageApproval pubkey generated:");
console.log(`   ${pubkey}\n`);

// Save to web/.env
const envPath = path.join(__dirname, "..", "web", ".env");
let content = fs.readFileSync(envPath, "utf-8");

// Update or add the key
if (content.includes("NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=")) {
  content = content.replace(
    /NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=.*/,
    `NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=${pubkey}`
  );
} else {
  content += `\nNEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=${pubkey}\n`;
}

fs.writeFileSync(envPath, content);
console.log("✓ Saved to web/.env\n");

console.log("⚠️  IMPORTANT:");
console.log("   This pubkey is generated locally but does NOT exist on devnet yet.");
console.log("   The verify_custody_proof may fail because the account doesn't exist.\n");

console.log("✅ Next steps:");
console.log("   1. Refresh your browser (http://localhost:3000)");
console.log("   2. Paste this pubkey in Step 2 input: " + pubkey);
console.log("   3. If Step 2 fails, we need to create the account on-chain");
console.log("      (requires calling createMockMessageApprovalAccount with your wallet)\n");
