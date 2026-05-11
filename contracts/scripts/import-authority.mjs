// One-shot helper: decode a base58 Solana secret key (passed via env) into the
// canonical Solana CLI JSON keypair format. Never commits the secret — output
// goes to contracts/lendguard-devnet.json which is already gitignored.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(here, '..', 'lendguard-devnet.json');

const b58 = process.env.LENDGUARD_AUTHORITY_B58;
if (!b58) {
  console.error('Set LENDGUARD_AUTHORITY_B58 env var with the base58 secret key.');
  process.exit(1);
}

const decode = bs58.default ? bs58.default.decode.bind(bs58.default) : bs58.decode.bind(bs58);
const bytes = decode(b58);
if (bytes.length !== 64) {
  console.error(`Unexpected key length: ${bytes.length} bytes (expected 64).`);
  process.exit(2);
}

const kp = Keypair.fromSecretKey(bytes);
fs.writeFileSync(outPath, JSON.stringify(Array.from(bytes)));
fs.chmodSync(outPath, 0o600);

console.log(JSON.stringify({ pubkey: kp.publicKey.toBase58(), wrote: outPath }));
