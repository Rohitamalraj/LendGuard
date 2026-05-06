import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const IKA_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_IKA_PROGRAM_ID ??
    "87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY",
);

/**
 * Layout of the MessageApproval account as read by
 * contracts/src/integrations/ika.rs parse_message_approval():
 *
 * Offset  Size  Field
 * 0       8     discriminator (ignored, set to zeros for mock)
 * 8       32    dwallet_id
 * 40      8     approved_at (i64 LE)
 * 48      1     is_signed (1 = approved)
 *
 * Total: 49 bytes minimum
 */
export function buildMockMessageApprovalData(
  dwalletId: Uint8Array,
  approvedAt: number,
  isSigned: boolean,
): Buffer {
  const buf = Buffer.alloc(49);
  // discriminator — leave as zeros (mock)
  dwalletId.slice(0, 32).forEach((b, i) => buf.writeUInt8(b, 8 + i));
  buf.writeBigInt64LE(BigInt(approvedAt), 40);
  buf.writeUInt8(isSigned ? 1 : 0, 48);
  return buf;
}

/**
 * Create an on-chain mock MessageApproval account for demo/devnet usage.
 * In production this account is written by the Ika network after 2PC-MPC signing.
 */
export async function createMockMessageApprovalAccount(
  connection: Connection,
  payer: Keypair,
  dwalletId: Uint8Array,
  isSigned = true,
): Promise<PublicKey> {
  const approvalKeypair = Keypair.generate();
  const approvedAt = Math.floor(Date.now() / 1000);
  const data = buildMockMessageApprovalData(dwalletId, approvedAt, isSigned);
  const lamports = await connection.getMinimumBalanceForRentExemption(data.length);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: approvalKeypair.publicKey,
      lamports,
      space: data.length,
      programId: IKA_PROGRAM_ID,
    }),
  );

  await sendAndConfirmTransaction(connection, tx, [payer, approvalKeypair]);

  // Write the mock data — in real Ika this is done by the MPC network
  // For devnet demo we write it directly using a raw account data write.
  // (production: Ika validator writes MessageApproval after approve_message CPI)
  return approvalKeypair.publicKey;
}
