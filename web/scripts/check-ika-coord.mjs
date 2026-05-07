import { Connection, PublicKey } from "@solana/web3.js";

const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const ika = new PublicKey("87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY");

const [coord] = PublicKey.findProgramAddressSync(
  [Buffer.from("dwallet_coordinator")],
  ika,
);
console.log("DWalletCoordinator PDA:", coord.toBase58());
const ci = await conn.getAccountInfo(coord);
if (!ci) {
  console.log("  → DOES NOT EXIST on devnet");
} else {
  console.log(
    "  → exists, owner:",
    ci.owner.toBase58(),
    "data len:",
    ci.data.length,
  );
}

const ikaInfo = await conn.getAccountInfo(ika);
console.log(
  "Ika dWallet program account:",
  ikaInfo
    ? `exists, executable=${ikaInfo.executable}`
    : "DOES NOT EXIST",
);
