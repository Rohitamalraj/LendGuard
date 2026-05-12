#!/usr/bin/env node
/**
 * Fetch a MessageApproval account from Solana and print the `approved_at` timestamp
 * Usage:
 *   node web/scripts/read_message_approval_time.js <MESSAGE_APPROVAL_PUBKEY> [RPC_URL]
 * Environment:
 *   SOLANA_RPC_URL or NEXT_PUBLIC_SOLANA_RPC_URL can be used as default RPC
 */

const { Connection, PublicKey } = require('@solana/web3.js');

async function main() {
  const defaultPubkey = process.env.NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL || 'Hh1YsCow3j4Ch311LaraLP8yLwoM6Kdc1AtHbgkopTGX';
  const pubkeyArg = process.argv[2] || defaultPubkey;
  const rpcArg = process.argv[3] || process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';

  console.log('RPC:', rpcArg);
  console.log('MessageApproval pubkey:', pubkeyArg);

  const connection = new Connection(rpcArg, 'confirmed');
  const pubkey = new PublicKey(pubkeyArg);

  const info = await connection.getAccountInfo(pubkey);
  if (!info) {
    console.error('Account not found on chain');
    process.exit(2);
  }

  const data = info.data;
  console.log('Account owner:', info.owner.toBase58());
  console.log('Data length:', data.length);

  if (data.length < 49) {
    console.warn('Account data shorter than expected (49 bytes). Parsing may fail.');
  }

  // dwallet_id is stored at bytes [8..40) (32 bytes)
  const dwalletBytes = data.slice(8, 40);
  let dwalletId = null;
  try {
    dwalletId = new PublicKey(dwalletBytes).toBase58();
  } catch (e) {
    // not a pubkey; show hex instead
    dwalletId = Buffer.from(dwalletBytes).toString('hex');
  }

  // approved_at is i64 LE at offset 40
  let approvedAt = null;
  try {
    // Node Buffer supports readBigInt64LE
    const raw = data.readBigInt64LE(40);
    // assume seconds since epoch
    approvedAt = Number(raw);
  } catch (e) {
    console.warn('Could not read approved_at as i64 LE:', e.message);
  }

  // is_signed flag at offset 48 (1 byte)
  const isSigned = data.length > 48 ? data[48] === 1 : null;

  console.log('dwallet_id:', dwalletId);
  console.log('is_signed:', isSigned === null ? 'unknown' : isSigned);

  if (approvedAt !== null && !Number.isNaN(approvedAt)) {
    const ms = approvedAt > 1e12 ? approvedAt : approvedAt * 1000; // handle seconds or ms
    const date = new Date(ms);
    console.log('approved_at (raw):', approvedAt);
    console.log('approved_at (ISO):', date.toISOString());
    console.log('approved_at (now delta seconds):', Math.floor((Date.now() - date.getTime()) / 1000));
  } else {
    console.log('approved_at: not available');
  }
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
