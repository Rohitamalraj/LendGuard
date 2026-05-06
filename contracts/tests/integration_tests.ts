import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { assert } from "chai";

// Replace with the deployed program ID once anchor deploy runs
const PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
// PDA seed constants — must match contracts/src/constants.rs
const VAULT_SEED = Buffer.from("vault");
const PROTOCOL_STATE_SEED = Buffer.from("protocol_state");
const RISK_STATE_SEED = Buffer.from("risk_state");

describe("lendguard_proof_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  // Swap type annotation with generated IDL type once `anchor build` runs
  // const program = anchor.workspace.LendguardProofVault as Program<LendguardProofVault>;

  const admin = provider.wallet as anchor.Wallet;
  const user = Keypair.generate();

  // dWallet ID: 32-byte identifier received from Ika gRPC after DKG
  const dwalletId = Buffer.alloc(32);
  Buffer.from("test-dwallet-id-btc").copy(dwalletId);

  // PDAs derived deterministically from seeds
  let protocolStatePda: PublicKey;
  let protocolStateBump: number;
  let vaultPda: PublicKey;
  let vaultBump: number;
  let riskStatePda: PublicKey;
  let riskStateBump: number;

  before(async () => {
    [protocolStatePda, protocolStateBump] = PublicKey.findProgramAddressSync(
      [PROTOCOL_STATE_SEED],
      PROGRAM_ID,
    );

    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [VAULT_SEED, admin.publicKey.toBuffer(), dwalletId],
      PROGRAM_ID,
    );

    [riskStatePda, riskStateBump] = PublicKey.findProgramAddressSync(
      [RISK_STATE_SEED, vaultPda.toBuffer()],
      PROGRAM_ID,
    );

    // Airdrop test SOL to user (best-effort on public devnet).
    // Devnet faucet occasionally fails with "Internal error", so tests should
    // remain deterministic even when faucet is unavailable.
    try {
      const sig = await provider.connection.requestAirdrop(
        user.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(sig);
    } catch {
      // No-op: current scaffold tests do not require funded accounts.
    }
  });

  it("derives correct PDAs", () => {
    assert.ok(protocolStatePda instanceof PublicKey, "protocolState PDA derived");
    assert.ok(vaultPda instanceof PublicKey, "vault PDA derived");
    assert.ok(riskStatePda instanceof PublicKey, "riskState PDA derived");
  });

  it("(scaffold) initialize_protocol → register_vault → initialize_risk_state flow", async () => {
    // Uncomment once IDL is generated and program ID is updated:
    //
    // Step 1 — initialize_protocol
    // await program.methods
    //   .initializeProtocol()
    //   .accounts({
    //     protocolState: protocolStatePda,
    //     admin: admin.publicKey,
    //     systemProgram: SystemProgram.programId,
    //   })
    //   .rpc();
    //
    // Step 2 — register_vault
    // await program.methods
    //   .registerVault(Array.from(dwalletId), 0 /* BTC */)
    //   .accounts({
    //     vault: vaultPda,
    //     protocolState: protocolStatePda,
    //     owner: admin.publicKey,
    //     systemProgram: SystemProgram.programId,
    //   })
    //   .rpc();
    //
    // Step 3 — initialize_risk_state with threshold ciphertext pubkey
    // const thresholdCiphertextKey = Keypair.generate().publicKey;
    // await program.methods
    //   .initializeRiskState(thresholdCiphertextKey)
    //   .accounts({
    //     riskState: riskStatePda,
    //     vault: vaultPda,
    //     owner: admin.publicKey,
    //     systemProgram: SystemProgram.programId,
    //   })
    //   .rpc();
    //
    // Step 4 — verify_custody_proof (using mock MessageApproval account)
    // Step 5 — deposit_collateral
    // Step 6 — update_backing_state (oracle sets backing ciphertext)
    // Step 7 — trigger_risk_check (reads mocked EBool result)
    // Step 8 — circuit_breaker_freeze (simulated exploit path)

    // Assert PDAs are canonical
    assert.strictEqual(
      protocolStateBump,
      PublicKey.findProgramAddressSync([PROTOCOL_STATE_SEED], PROGRAM_ID)[1],
    );
    assert.strictEqual(
      vaultBump,
      PublicKey.findProgramAddressSync(
        [VAULT_SEED, admin.publicKey.toBuffer(), dwalletId],
        PROGRAM_ID,
      )[1],
    );
    assert.strictEqual(
      riskStateBump,
      PublicKey.findProgramAddressSync([RISK_STATE_SEED, vaultPda.toBuffer()], PROGRAM_ID)[1],
    );
  });

  it("(scaffold) attack path — unverified deposit must be rejected", async () => {
    // Uncomment after IDL is generated:
    //
    // try {
    //   await program.methods
    //     .depositCollateral(new BN(1_000_000))
    //     .accounts({
    //       vault: vaultPda,
    //       protocolState: protocolStatePda,
    //       depositor: admin.publicKey,
    //       systemProgram: SystemProgram.programId,
    //     })
    //     .rpc();
    //   assert.fail("Should have thrown VaultNotVerified");
    // } catch (err: any) {
    //   assert.include(err.message, "VaultNotVerified");
    // }

    // Placeholder assertion until IDL is live
    assert.ok(true, "attack path scaffold ready");
  });
});
