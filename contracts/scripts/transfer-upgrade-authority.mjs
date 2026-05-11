// Transfer the LendGuard program's upgrade authority to a multisig (or any
// new pubkey). Usage:
//
//   LENDGUARD_AUTHORITY_KEYPAIR=/path/to/current.json \
//   LENDGUARD_NEW_AUTHORITY=<base58 pubkey of multisig> \
//   LENDGUARD_RPC=https://api.devnet.solana.com \
//   node contracts/scripts/transfer-upgrade-authority.mjs
//
// This wraps the BPF Loader Upgradeable program's `SetAuthority` instruction
// (variant 4) so we don't depend on the local Solana CLI being installed.
//
// HARD STOP: once a multisig owns the program, this script can no longer
// transfer it back. Verify the new authority pubkey *before* running.

import fs from 'node:fs';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('GQia1ewyLgtkgX7HSfuttJ42qNPpYJhUbxeyCPXtcJFR');
const BPF_LOADER_UPGRADEABLE = new PublicKey(
  'BPFLoaderUpgradeab1e11111111111111111111111',
);

const RPC = process.env.LENDGUARD_RPC ?? 'https://api.devnet.solana.com';
const KEYPAIR_PATH = process.env.LENDGUARD_AUTHORITY_KEYPAIR;
const NEW_AUTHORITY = process.env.LENDGUARD_NEW_AUTHORITY;
const DRY_RUN = process.env.LENDGUARD_DRY_RUN === '1';

if (!KEYPAIR_PATH) {
  console.error('LENDGUARD_AUTHORITY_KEYPAIR env var is required.');
  process.exit(1);
}
if (!NEW_AUTHORITY) {
  console.error('LENDGUARD_NEW_AUTHORITY env var is required.');
  process.exit(1);
}

const secret = Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8')));
const current = Keypair.fromSecretKey(secret);
const newAuthority = new PublicKey(NEW_AUTHORITY);

const connection = new Connection(RPC, 'confirmed');

// programdata address: PDA([program_id], BPF_LOADER_UPGRADEABLE)
const [programDataAddress] = PublicKey.findProgramAddressSync(
  [PROGRAM_ID.toBuffer()],
  BPF_LOADER_UPGRADEABLE,
);

console.log('--- transfer-upgrade-authority ---');
console.log({
  programId: PROGRAM_ID.toBase58(),
  programDataAddress: programDataAddress.toBase58(),
  currentAuthority: current.publicKey.toBase58(),
  newAuthority: newAuthority.toBase58(),
  rpc: RPC,
  dryRun: DRY_RUN,
});

// Verify current ProgramData on-chain has the expected authority before
// signing anything.
const info = await connection.getAccountInfo(programDataAddress, 'confirmed');
if (!info) throw new Error('ProgramData account not found');
// ProgramData layout: 4 (state) + 8 (slot) + 1 (option<pubkey>) + 32 (pubkey)
const declaredAuthority = info.data[12] === 1
  ? new PublicKey(info.data.subarray(13, 45))
  : null;
if (!declaredAuthority || !declaredAuthority.equals(current.publicKey)) {
  throw new Error(
    `Current on-chain upgrade authority is ${declaredAuthority?.toBase58() ?? 'NONE'}, ` +
      `but our keypair signs as ${current.publicKey.toBase58()}.`,
  );
}
console.log('preflight OK: current keypair matches on-chain upgrade authority.');

// SetAuthority for BPF Loader Upgradeable = variant 4 (1 byte).
const ix = new TransactionInstruction({
  programId: BPF_LOADER_UPGRADEABLE,
  keys: [
    { pubkey: programDataAddress, isSigner: false, isWritable: true },
    { pubkey: current.publicKey, isSigner: true, isWritable: false },
    { pubkey: newAuthority, isSigner: false, isWritable: false },
  ],
  data: Buffer.from([4]),
});

if (DRY_RUN) {
  console.log('LENDGUARD_DRY_RUN=1 set — not sending. Instruction prepared:');
  console.log(JSON.stringify({
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((k) => ({
      pubkey: k.pubkey.toBase58(),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    dataHex: ix.data.toString('hex'),
  }, null, 2));
  process.exit(0);
}

const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [current], {
  commitment: 'confirmed',
});

console.log(`set_authority confirmed: ${sig}`);
console.log('Verify: solana program show ' + PROGRAM_ID.toBase58() + ' --url ' + RPC);
