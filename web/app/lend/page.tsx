"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle,
  CircleDollarSign,
  Flame,
  RefreshCw,
  Shield,
  Unlock,
  Wallet,
} from "lucide-react";
import { PublicKey } from "@solana/web3.js";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button";
import {
  ASSET_BTC,
  currentDebt,
  formatBtc,
  formatLgUsd,
  formatPriceUsd,
  isLiquidatable,
  listAllBorrowPositions,
  parseLgUsd,
  readBtcVault,
  readBorrowPosition,
  readDefaultLendingPool,
  type BitcoinBalanceAttestationAccount,
  type BorrowPositionAccount,
  type BorrowPositionListing,
  type BtcVaultAccount,
  type LendingPoolAccount,
  type AdminPriceFeedAccount,
} from "@/lib/lending-client";
import {
  buildAttestBtcBalanceIx,
  buildBorrowAgainstBtcCollateralIx,
  buildDemoCreateMessageApprovalIx,
  buildRegisterBtcVaultIx,
  buildRepayBtcBorrowIx,
  buildVerifyBtcCustodyProofIx,
  buildBorrowAgainstCollateralIx,
  buildCreateAssociatedTokenAccountIx,
  buildLiquidatePositionIx,
  buildRepayBorrowIx,
  buildUnfreezeProtocolStateIx,
  buildUpdateAdminPriceIx,
  deriveAssociatedTokenAddress,
  explorerAccountUrl,
  explorerTxUrl,
  LGUSD_MINT,
  readProtocolFrozen,
  sendIx,
  TOKEN_PROGRAM_ID,
} from "@/lib/program-actions";
import {
  BTC_TESTNET_FAUCETS,
  mempoolAddressUrl,
  secp256k1PubkeyToTestnetP2WPKH,
} from "@/lib/btc-address";
import { bytesToHex, createBtcDwallet } from "@/lib/btc-dwallet";
import { PROGRAM_ID } from "@/lib/lendguard-client";
import {
  createEncryptInputs,
  FHE_TYPES,
} from "@/lib/encrypt-client";
import {
  decodeVaultAccount,
  listVaultsForOwner,
  type VaultListing,
} from "@/lib/lendguard-gate";

const DEFAULT_BTC_PRICE = 90_000_00000000n; // $90,000, 8 decimals
const CRASH_BTC_PRICE = 50_000_00000000n; // $50,000, 8 decimals

type Log = {
  status: "ok" | "warn" | "fail";
  message: string;
  tx?: string;
  account?: string;
};

interface VaultIndex {
  [vaultPda: string]: VaultListing;
}

export default function LendPage() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();

  const [poolPda, setPoolPda] = useState<string | null>(null);
  const [priceFeedPda, setPriceFeedPda] = useState<string | null>(null);
  const [pool, setPool] = useState<LendingPoolAccount | null>(null);
  const [priceFeed, setPriceFeed] = useState<AdminPriceFeedAccount | null>(null);
  const [vaults, setVaults] = useState<VaultListing[]>([]);
  const [allVaults, setAllVaults] = useState<VaultIndex>({});
  const [selectedVault, setSelectedVault] = useState<VaultListing | null>(null);
  const [position, setPosition] = useState<BorrowPositionAccount | null>(null);
  const [positionPda, setPositionPda] = useState<string | null>(null);
  const [allPositions, setAllPositions] = useState<BorrowPositionListing[]>([]);
  const [lgUsdBalance, setLgUsdBalance] = useState<bigint>(0n);
  const [amount, setAmount] = useState("25");
  const [btcIkaDwallet, setBtcIkaDwallet] = useState("");
  const [btcDwalletPubkeyHex, setBtcDwalletPubkeyHex] = useState("");
  const [btcAddress, setBtcAddress] = useState("");
  const [btcVaultInput, setBtcVaultInput] = useState("");
  const [btcMessageApproval, setBtcMessageApproval] = useState("");
  const [btcVault, setBtcVault] = useState<BtcVaultAccount | null>(null);
  const [btcVaultPda, setBtcVaultPda] = useState<PublicKey | null>(null);
  const [btcAttestation, setBtcAttestation] =
    useState<BitcoinBalanceAttestationAccount | null>(null);
  const [btcPosition, setBtcPosition] = useState<BorrowPositionAccount | null>(
    null,
  );
  const [btcBorrowAmount, setBtcBorrowAmount] = useState("25");
  const [running, setRunning] = useState(false);
  const [protocolFrozen, setProtocolFrozen] = useState<boolean | null>(null);
  const [log, setLog] = useState<Log[]>([]);

  const owner = publicKey;
  const verifiedVaults = useMemo(
    () => vaults.filter((v) => v.vault.proofStatus === 1),
    [vaults],
  );

  const liquidatablePositions = useMemo(() => {
    if (!pool || !priceFeed) return [];
    return allPositions.filter((p) => {
      const v = allVaults[p.position.vault.toBase58()];
      if (!v) return false;
      const debt = currentDebt(p.position.principal, pool.borrowIndex);
      return (
        debt > 0n &&
        isLiquidatable(
          v.vault.depositedAmount,
          priceFeed.priceUsd,
          debt,
          pool.liquidationThresholdBps,
        )
      );
    });
  }, [allPositions, allVaults, pool, priceFeed]);

  // Set of vault PDAs (base58) that already have an open BorrowPosition owned
  // by *this* wallet. Used to label vaults in the picker and to gate the
  // Borrow button so users don't try to re-init a live position PDA.
  const vaultsWithOpenDebt = useMemo(() => {
    if (!pool || !owner) return new Map<string, bigint>();
    const map = new Map<string, bigint>();
    for (const p of allPositions) {
      if (!p.position.owner.equals(owner)) continue;
      const debt = currentDebt(p.position.principal, pool.borrowIndex);
      if (debt > 0n) map.set(p.position.vault.toBase58(), debt);
    }
    return map;
  }, [allPositions, pool, owner]);

  const selectedVaultHasDebt = useMemo(() => {
    if (!selectedVault) return false;
    return vaultsWithOpenDebt.has(selectedVault.vaultPda.toBase58());
  }, [selectedVault, vaultsWithOpenDebt]);

  const addLog = useCallback((entry: Log) => {
    setLog((prev) => [entry, ...prev].slice(0, 12));
  }, []);

  const refreshLgUsdBalance = useCallback(
    async (ownerPk: PublicKey) => {
      try {
        const ata = deriveAssociatedTokenAddress(ownerPk, LGUSD_MINT);
        const info = await connection.getAccountInfo(ata, "confirmed");
        if (!info) {
          setLgUsdBalance(0n);
          return;
        }
        // SPL token account amount is at byte offset 64, u64 LE.
        const amount = info.data.readBigUInt64LE(64);
        setLgUsdBalance(amount);
      } catch {
        setLgUsdBalance(0n);
      }
    },
    [connection],
  );

  const refresh = useCallback(async () => {
    const [{ poolPda, priceFeedPda, pool, priceFeed }, frozen, allPos] = await Promise.all([
      readDefaultLendingPool(connection),
      readProtocolFrozen(connection),
      listAllBorrowPositions(connection),
    ]);
    setPoolPda(poolPda.toBase58());
    setPriceFeedPda(priceFeedPda.toBase58());
    setPool(pool);
    setPriceFeed(priceFeed);
    setProtocolFrozen(frozen);
    setAllPositions(allPos);

    if (!owner) {
      setVaults([]);
      setSelectedVault(null);
      setPosition(null);
      setPositionPda(null);
      setLgUsdBalance(0n);
      setAllVaults({});
      return;
    }

    const foundVaults = await listVaultsForOwner(connection, owner);
    setVaults(foundVaults);
    const nextVault =
      foundVaults.find((v) => v.vault.proofStatus === 1) ?? foundVaults[0] ?? null;
    setSelectedVault(nextVault);

    // Fetch any vaults referenced by liquidatable positions but not owned by
    // the connected wallet (so the liquidate panel can show details).
    const vaultsByKey: VaultIndex = {};
    for (const v of foundVaults) {
      vaultsByKey[v.vaultPda.toBase58()] = v;
    }
    const missingKeys = allPos
      .map((p) => p.position.vault)
      .filter((k) => !(k.toBase58() in vaultsByKey));
    if (missingKeys.length > 0) {
      const infos = await connection.getMultipleAccountsInfo(missingKeys);
      missingKeys.forEach((k, i) => {
        const info = infos[i];
        if (!info) return;
        try {
          const vault = decodeVaultAccount(info.data);
          if (vault) vaultsByKey[k.toBase58()] = { vaultPda: k, vault };
        } catch {
          /* ignore */
        }
      });
    }
    setAllVaults(vaultsByKey);

    void refreshLgUsdBalance(owner);
  }, [connection, owner, refreshLgUsdBalance]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Subscribe to live program logs so the dashboard reacts immediately to
  // borrow / repay / liquidate / interest-accrued events from any user, not
  // just transactions we initiated.
  useEffect(() => {
    let cancelled = false;
    const id = connection.onLogs(
      PROGRAM_ID,
      (entry) => {
        if (cancelled || entry.err) return;
        const interesting = entry.logs.find((l) =>
          l.includes("BorrowOpened") ||
          l.includes("BorrowRepaid") ||
          l.includes("PositionLiquidated") ||
          l.includes("InterestAccrued") ||
          l.includes("AdminPriceUpdated"),
        );
        if (interesting) {
          const evtName = interesting.match(/Event\s*=\s*(\w+)/)?.[1] ?? "program-event";
          addLog({
            status: "ok",
            message: `live: ${evtName} on program — refreshing state`,
            tx: entry.signature,
          });
          void refresh();
        }
      },
      "confirmed",
    );
    return () => {
      cancelled = true;
      void connection.removeOnLogsListener(id);
    };
  }, [connection, addLog, refresh]);

  useEffect(() => {
    if (!selectedVault) {
      setPositionPda(null);
      setPosition(null);
      return;
    }
    void (async () => {
      const { positionPda, position } = await readBorrowPosition(
        connection,
        selectedVault.vaultPda,
      );
      setPositionPda(positionPda.toBase58());
      setPosition(position);
    })();
  }, [connection, selectedVault]);

  // Auto-refresh the loaded BTC vault every 15s so the attestation balance
  // updates as soon as the keeper posts new satoshis. Inline the read so we
  // don't depend on the later-declared useCallback (TDZ).
  useEffect(() => {
    if (!btcVaultPda) return;
    const id = window.setInterval(() => {
      void (async () => {
        const res = await readBtcVault(connection, btcVaultPda);
        setBtcVault(res.btcVault);
        setBtcAttestation(res.btcAttestation);
        setBtcPosition(res.borrowPosition);
      })();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [btcVaultPda, connection]);

  const setPrice = async (priceUsd: bigint) => {
    if (!owner || !signTransaction) return;
    setRunning(true);
    try {
      const { ix, priceFeedPda } = await buildUpdateAdminPriceIx({
        admin: owner,
        assetType: ASSET_BTC,
        newPriceUsd: priceUsd,
      });
      const sig = await sendIx(ix, { connection, payer: owner, signTransaction });
      addLog({
        status: "ok",
        message: `BTC price updated to ${formatPriceUsd(priceUsd)}`,
        tx: sig,
        account: priceFeedPda.toBase58(),
      });
      await refresh();
    } catch (e) {
      addLog({ status: "fail", message: friendlyError(e) });
    } finally {
      setRunning(false);
    }
  };

  const unfreeze = async () => {
    if (!owner || !signTransaction) return;
    setRunning(true);
    try {
      const ix = await buildUnfreezeProtocolStateIx(owner);
      const sig = await sendIx(ix, { connection, payer: owner, signTransaction });
      addLog({ status: "ok", message: "unfreeze_protocol_state() confirmed", tx: sig });
      await refresh();
    } catch (e) {
      addLog({ status: "fail", message: friendlyError(e) });
    } finally {
      setRunning(false);
    }
  };

  const borrow = async () => {
    if (!owner || !signTransaction || !selectedVault || !pool || !priceFeed) return;
    if (vaultsWithOpenDebt.has(selectedVault.vaultPda.toBase58())) {
      addLog({
        status: "fail",
        message:
          "this vault already has an open borrow position. Repay it (use 'Repay All') before opening a new borrow against the same collateral.",
      });
      return;
    }
    setRunning(true);
    try {
      const ataAddress = deriveAssociatedTokenAddress(owner, LGUSD_MINT);
      const ataInfo = await connection.getAccountInfo(ataAddress, "confirmed");
      const ixs = [];
      if (!ataInfo) {
        const { ix: createAtaIx } = buildCreateAssociatedTokenAccountIx({
          payer: owner,
          owner,
          mint: LGUSD_MINT,
        });
        ixs.push(createAtaIx);
      }

      // Phase 2: encrypt the health factor inputs via Encrypt's pre-alpha
      // gRPC executor so they live on-chain as ciphertext PDAs. We store the
      // first ciphertext (debt) as `health_ciphertext` on the position; in
      // production an off-chain monitor recomputes the encrypted health using
      // all three ciphertexts and triggers liquidations when an EBool flips.
      let healthCiphertext: PublicKey | undefined;
      try {
        const debtBaseUnits = parseLgUsd(amount);
        const collateralValueBaseUnits =
          (selectedVault.vault.depositedAmount * priceFeed.priceUsd) /
          10n ** 9n;
        const liquidationThresholdBps = BigInt(pool.liquidationThresholdBps);
        const ids = await createEncryptInputs([
          {
            value: debtBaseUnits,
            fheType: FHE_TYPES.EUint64,
            authorizedProgram: PROGRAM_ID,
          },
          {
            value: collateralValueBaseUnits,
            fheType: FHE_TYPES.EUint64,
            authorizedProgram: PROGRAM_ID,
          },
          {
            value: liquidationThresholdBps,
            fheType: FHE_TYPES.EUint64,
            authorizedProgram: PROGRAM_ID,
          },
        ]);
        healthCiphertext = ids[0];
        addLog({
          status: "ok",
          message: "encrypted health factor: debt + collateral + threshold sealed via Encrypt FHE",
          account: ids[0].toBase58(),
        });
      } catch (encErr) {
        addLog({
          status: "warn",
          message: `Encrypt executor unreachable, falling back to plaintext gate: ${friendlyError(encErr)}`,
        });
      }

      const { ix, borrowPositionPda } = await buildBorrowAgainstCollateralIx({
        owner,
        vaultPda: selectedVault.vaultPda,
        assetType: selectedVault.vault.assetType,
        borrowAssetMint: pool.borrowAssetMint,
        poolTokenVault: pool.poolTokenVault,
        borrowerTokenAccount: ataAddress,
        amount: parseLgUsd(amount),
        healthCiphertext,
      });
      ixs.push(ix);
      const sig = await sendIx(ixs, { connection, payer: owner, signTransaction });
      addLog({
        status: "ok",
        message: `borrow_against_collateral(${amount} LGUSD) confirmed — tokens transferred to your ATA`,
        tx: sig,
        account: borrowPositionPda.toBase58(),
      });
      await refresh();
    } catch (e) {
      addLog({ status: "fail", message: friendlyError(e) });
    } finally {
      setRunning(false);
    }
  };

  // `all=true` sends u64::MAX which the program silently caps to the live
  // outstanding debt AND closes the BorrowPosition account (rent → owner).
  // Use this whenever the user's intent is "pay off and free up the vault".
  const repay = async (all: boolean = false) => {
    if (!owner || !signTransaction || !selectedVault || !position || !pool) return;
    setRunning(true);
    try {
      const ataAddress = deriveAssociatedTokenAddress(owner, LGUSD_MINT);
      const MAX_U64 = (1n << 64n) - 1n;
      let sendAmount: bigint;
      if (all) {
        sendAmount = MAX_U64;
      } else {
        const repayAmount = parseLgUsd(amount);
        const debtNow = currentDebt(position.principal, pool.borrowIndex);
        sendAmount = repayAmount > debtNow ? debtNow : repayAmount;
      }
      const { ix, borrowPositionPda } = await buildRepayBorrowIx({
        owner,
        vaultPda: selectedVault.vaultPda,
        borrowAssetMint: pool.borrowAssetMint,
        poolTokenVault: pool.poolTokenVault,
        borrowerTokenAccount: ataAddress,
        amount: sendAmount,
      });
      const sig = await sendIx(ix, { connection, payer: owner, signTransaction });
      addLog({
        status: "ok",
        message: all
          ? "repay_borrow(MAX) confirmed — position fully repaid, account closed, rent refunded"
          : "repay_borrow() confirmed — tokens returned to pool",
        tx: sig,
        account: borrowPositionPda.toBase58(),
      });
      await refresh();
    } catch (e) {
      addLog({ status: "fail", message: friendlyError(e) });
    } finally {
      setRunning(false);
    }
  };

  const liquidate = async (target: BorrowPositionListing) => {
    if (!owner || !signTransaction || !pool) return;
    setRunning(true);
    try {
      const targetVault = allVaults[target.position.vault.toBase58()];
      if (!targetVault) throw new Error("liquidator: target vault not found in cache");

      const ataAddress = deriveAssociatedTokenAddress(owner, LGUSD_MINT);
      const ataInfo = await connection.getAccountInfo(ataAddress, "confirmed");
      const ixs = [];
      if (!ataInfo) {
        const { ix: createAtaIx } = buildCreateAssociatedTokenAccountIx({
          payer: owner,
          owner,
          mint: LGUSD_MINT,
        });
        ixs.push(createAtaIx);
      }
      const { ix } = await buildLiquidatePositionIx({
        liquidator: owner,
        vaultPda: target.position.vault,
        assetType: targetVault.vault.assetType,
        borrowAssetMint: pool.borrowAssetMint,
        poolTokenVault: pool.poolTokenVault,
        liquidatorTokenAccount: ataAddress,
      });
      ixs.push(ix);
      const sig = await sendIx(ixs, { connection, payer: owner, signTransaction });
      addLog({
        status: "ok",
        message: `liquidate_position() confirmed — repaid ${formatLgUsd(target.position.principal)} LGUSD, seized collateral with bonus`,
        tx: sig,
        account: target.positionPda.toBase58(),
      });
      await refresh();
    } catch (e) {
      addLog({ status: "fail", message: friendlyError(e) });
    } finally {
      setRunning(false);
    }
  };

  // ─── BTC testnet collateral handlers ────────────────────────────────────

  const refreshBtcVault = useCallback(
    async (pdaToLoad?: PublicKey | string) => {
      const target =
        pdaToLoad instanceof PublicKey
          ? pdaToLoad
          : pdaToLoad
            ? (() => {
                try {
                  return new PublicKey(pdaToLoad);
                } catch {
                  return null;
                }
              })()
            : btcVaultPda;
      if (!target) {
        setBtcVault(null);
        setBtcAttestation(null);
        setBtcPosition(null);
        return;
      }
      const res = await readBtcVault(connection, target);
      setBtcVaultPda(target);
      setBtcVault(res.btcVault);
      setBtcAttestation(res.btcAttestation);
      setBtcPosition(res.borrowPosition);
    },
    [connection, btcVaultPda],
  );

  function hexToBytes(hex: string): Uint8Array {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0) throw new Error("hex length must be even");
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return out;
  }

  const registerBtcVault = async () => {
    if (!owner || !signTransaction) return;
    setRunning(true);
    try {
      const ikaDwallet = new PublicKey(btcIkaDwallet.trim());
      const pubkey = hexToBytes(btcDwalletPubkeyHex.trim());
      if (pubkey.length !== 33) {
        throw new Error("dWallet pubkey must be 33 bytes (66 hex chars)");
      }
      const addr = btcAddress.trim();
      if (!addr.startsWith("tb1")) {
        throw new Error("Bitcoin address must be a tb1… testnet address");
      }

      // 1. register_btc_vault — creates the BtcVaultAccount + attestation PDA.
      const { ix: registerIx, btcVaultPda: newVaultPda } =
        await buildRegisterBtcVaultIx({
          owner,
          ikaDwallet,
          dwalletPubkey: pubkey,
          bitcoinAddress: addr,
        });

      // 2. demo_create_message_approval — writes a 49-byte MessageApproval blob
      //    that the on-chain `parse_message_approval_for_btc_dwallet` parser
      //    accepts (auto-detects between real 287-byte Ika layout and the demo
      //    helper layout). Stand-in for the Ika `approve_message` CPI while
      //    Ika pre-alpha gRPC doesn't expose Secp256k1 DKG.
      const { ix: approveIx, messageApprovalPda } =
        await buildDemoCreateMessageApprovalIx({
          payer: owner,
          dwalletId: ikaDwallet.toBytes(),
          isSigned: true,
        });

      // 3. verify_btc_custody_proof — reads the freshly created MessageApproval
      //    and flips BtcVaultAccount.proof_status to Verified.
      const verifyIx = await buildVerifyBtcCustodyProofIx({
        owner,
        btcVaultPda: newVaultPda,
        messageApprovalPda,
      });

      const sig = await sendIx([registerIx, approveIx, verifyIx], {
        connection,
        payer: owner,
        signTransaction,
      });

      addLog({
        status: "ok",
        message: `register + approve + verify confirmed in one tx — tBTC vault ${newVaultPda
          .toBase58()
          .slice(0, 8)}… is verified and ready to borrow against (Bitcoin address ${addr.slice(
          0,
          12,
        )}…). Fund this address from a testnet faucet so the keeper can attest its balance.`,
        tx: sig,
        account: newVaultPda.toBase58(),
      });
      setBtcVaultInput(newVaultPda.toBase58());
      setBtcMessageApproval(messageApprovalPda.toBase58());
      await refreshBtcVault(newVaultPda);
    } catch (e) {
      addLog({ status: "fail", message: friendlyError(e) });
    } finally {
      setRunning(false);
    }
  };

  const verifyBtcVault = async () => {
    if (!owner || !signTransaction || !btcVaultPda) return;
    setRunning(true);
    try {
      const messageApproval = new PublicKey(btcMessageApproval.trim());
      const ix = await buildVerifyBtcCustodyProofIx({
        owner,
        btcVaultPda,
        messageApprovalPda: messageApproval,
      });
      const sig = await sendIx(ix, {
        connection,
        payer: owner,
        signTransaction,
      });
      addLog({
        status: "ok",
        message:
          "verify_btc_custody_proof() confirmed — Ika MessageApproval validates the Secp256k1 dWallet",
        tx: sig,
        account: btcVaultPda.toBase58(),
      });
      await refreshBtcVault();
    } catch (e) {
      addLog({ status: "fail", message: friendlyError(e) });
    } finally {
      setRunning(false);
    }
  };

  const borrowBtc = async () => {
    if (!owner || !signTransaction || !btcVaultPda || !pool) return;
    setRunning(true);
    try {
      const ataAddress = deriveAssociatedTokenAddress(owner, LGUSD_MINT);
      const ataInfo = await connection.getAccountInfo(ataAddress, "confirmed");
      const ixs = [];
      if (!ataInfo) {
        const { ix: createAtaIx } = buildCreateAssociatedTokenAccountIx({
          payer: owner,
          owner,
          mint: LGUSD_MINT,
        });
        ixs.push(createAtaIx);
      }
      const { ix, borrowPositionPda } =
        await buildBorrowAgainstBtcCollateralIx({
          owner,
          btcVaultPda,
          borrowAssetMint: pool.borrowAssetMint,
          poolTokenVault: pool.poolTokenVault,
          borrowerTokenAccount: ataAddress,
          amount: parseLgUsd(btcBorrowAmount),
        });
      ixs.push(ix);
      const sig = await sendIx(ixs, {
        connection,
        payer: owner,
        signTransaction,
      });
      addLog({
        status: "ok",
        message: `borrow_against_btc_collateral(${btcBorrowAmount} LGUSD) confirmed — backed by attested tBTC`,
        tx: sig,
        account: borrowPositionPda.toBase58(),
      });
      await refreshBtcVault();
      if (owner) void refreshLgUsdBalance(owner);
    } catch (e) {
      addLog({ status: "fail", message: friendlyError(e) });
    } finally {
      setRunning(false);
    }
  };

  const repayBtc = async (all: boolean) => {
    if (!owner || !signTransaction || !btcVaultPda || !pool || !btcPosition)
      return;
    setRunning(true);
    try {
      const ataAddress = deriveAssociatedTokenAddress(owner, LGUSD_MINT);
      const MAX_U64 = (1n << 64n) - 1n;
      let sendAmount: bigint;
      if (all) {
        sendAmount = MAX_U64;
      } else {
        const repayAmount = parseLgUsd(btcBorrowAmount);
        const debtNow = currentDebt(btcPosition.principal, pool.borrowIndex);
        sendAmount = repayAmount > debtNow ? debtNow : repayAmount;
      }
      const ix = await buildRepayBtcBorrowIx({
        owner,
        btcVaultPda,
        borrowAssetMint: pool.borrowAssetMint,
        poolTokenVault: pool.poolTokenVault,
        borrowerTokenAccount: ataAddress,
        amount: sendAmount,
      });
      const sig = await sendIx(ix, {
        connection,
        payer: owner,
        signTransaction,
      });
      addLog({
        status: "ok",
        message: all
          ? "repay_btc_borrow(MAX) confirmed — tBTC vault freed, position closed"
          : "repay_btc_borrow() confirmed",
        tx: sig,
        account: btcVaultPda.toBase58(),
      });
      await refreshBtcVault();
      if (owner) void refreshLgUsdBalance(owner);
    } catch (e) {
      addLog({ status: "fail", message: friendlyError(e) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <div className="border-b border-border/50 bg-background/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <span className="font-mono text-primary font-bold">L</span>
            </div>
            <span className="font-bold tracking-tight">LendGuard</span>
            <span className="text-muted-foreground text-sm font-mono">/ lend</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/demo" className="text-xs text-muted-foreground hover:text-foreground">
              Security demo
            </Link>
            <Badge variant="outline" className="font-mono text-xs">
              devnet
            </Badge>
            <ConnectWalletButton />
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-6 py-10 space-y-8">
        <section className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-semibold tracking-tight">
              Native Bridgeless Lending
            </h1>
            <Badge className="bg-green-500/15 text-green-300 border-green-500/40 font-mono text-[10px]">
              LIVE · LGUSD POOL
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">
            LendGuard as its own native lending protocol: a real LGUSD SPL mint
            governed by the program, real token transfers on borrow / repay,
            permissionless liquidations with a bonus, and rate-model fields
            ready for utilisation-based interest in the next upgrade.
          </p>
        </section>

        <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-6">
          <section className="rounded-xl border border-border bg-card p-6 space-y-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <CircleDollarSign className="w-4 h-4 text-green-400" />
                <h2 className="font-semibold text-sm">LGUSD Lending Pool</h2>
              </div>
              <Button variant="outline" size="sm" onClick={() => void refresh()} className="gap-2 text-xs">
                <RefreshCw className="w-3 h-3" /> Refresh
              </Button>
            </div>

            {!pool ? (
              <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-4 text-xs text-yellow-200">
                Pool is not initialized on this program. Run{" "}
                <code className="font-mono">node contracts/scripts/bootstrap-devnet.mjs</code>{" "}
                from the repo with the admin keypair to bootstrap LGUSD + the
                lending pool.
              </div>
            ) : (
              <div className="grid sm:grid-cols-3 gap-3">
                <Metric label="liquidity" value={`${formatLgUsd(pool.totalLiquidity)} LGUSD`} />
                <Metric label="borrowed" value={`${formatLgUsd(pool.totalBorrowed)} LGUSD`} />
                <Metric
                  label="available"
                  value={`${formatLgUsd(pool.totalLiquidity - pool.totalBorrowed)} LGUSD`}
                />
                <Metric label="BTC price" value={priceFeed ? formatPriceUsd(priceFeed.priceUsd) : "—"} />
                <Metric label="LTV" value={`${pool.ltvBasisPoints / 100}%`} />
                <Metric label="liq threshold" value={`${pool.liquidationThresholdBps / 100}%`} />
                <Metric label="liq bonus" value={`+${pool.liquidationBonusBps / 100}%`} />
                <Metric label="base APR" value={`${pool.baseRateBps / 100}%`} />
                <Metric label="rate slope" value={`+${pool.rateSlopeBps / 100}%`} />
              </div>
            )}

            {poolPda && (
              <div className="flex flex-wrap gap-3 text-[10px] font-mono">
                <a
                  href={explorerAccountUrl(poolPda)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  pool {poolPda.slice(0, 10)}...
                </a>
                <a
                  href={explorerAccountUrl(LGUSD_MINT.toBase58())}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  mint {LGUSD_MINT.toBase58().slice(0, 10)}...
                </a>
                {pool && (
                  <a
                    href={explorerAccountUrl(pool.poolTokenVault.toBase58())}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    pool vault {pool.poolTokenVault.toBase58().slice(0, 10)}...
                  </a>
                )}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-400" />
              <h2 className="font-semibold text-sm">Protocol Controls</h2>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between font-mono">
                <span className="text-muted-foreground">protocol.frozen</span>
                <span className={protocolFrozen ? "text-red-300" : "text-green-300"}>
                  {String(protocolFrozen)}
                </span>
              </div>
              <div className="flex justify-between font-mono">
                <span className="text-muted-foreground">your LGUSD</span>
                <span className="flex items-center gap-1 text-foreground">
                  <Wallet className="w-3 h-3" />
                  {formatLgUsd(lgUsdBalance)}
                </span>
              </div>
              {priceFeedPda && (
                <div className="flex justify-between gap-2 font-mono">
                  <span className="text-muted-foreground">price_feed</span>
                  <span className="truncate">{priceFeedPda}</span>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Button variant="outline" size="sm" disabled={!connected || running} onClick={unfreeze} className="gap-2 text-xs">
                <Unlock className="w-3 h-3" /> Unfreeze
              </Button>
              <Button variant="outline" size="sm" disabled={!connected || running || !priceFeed} onClick={() => void setPrice(DEFAULT_BTC_PRICE)} className="text-xs">
                BTC $90k
              </Button>
              <Button variant="outline" size="sm" disabled={!connected || running || !priceFeed} onClick={() => void setPrice(CRASH_BTC_PRICE)} className="text-xs border-red-500/40 text-red-300">
                Crash to $50k
              </Button>
            </div>
          </section>
        </div>

        {/* ─── BTC testnet collateral (Ika Secp256k1) ──────────────────── */}
        <section className="rounded-xl border border-orange-500/30 bg-gradient-to-br from-orange-500/5 via-card to-card p-6 space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <CircleDollarSign className="w-4 h-4 text-orange-400" />
              <h2 className="font-semibold text-sm">
                Bitcoin testnet collateral
              </h2>
              <Badge className="bg-orange-500/15 text-orange-300 border-orange-500/30 text-[10px]">
                Ika Secp256k1
              </Badge>
            </div>
            <div className="text-[10px] font-mono text-muted-foreground">
              real tBTC custody · BIP143 sighash · 0 wrapping
            </div>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Deposit real Bitcoin testnet BTC into an Ika-controlled dWallet,
            borrow LGUSD against an off-chain balance attestation, and liquidate
            via a real Bitcoin testnet transaction signed through Ika.
            Pre-alpha mock signer; tBTC has zero value, so the demo is safe.
          </p>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* Register flow */}
            <div className="rounded-lg border border-border bg-background/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase font-mono text-muted-foreground">
                  1. Register a BTC vault
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-[10px] h-7"
                  disabled={running}
                  onClick={async () => {
                    try {
                      const bundle = await createBtcDwallet();
                      setBtcIkaDwallet(bundle.ikaDwallet.toBase58());
                      setBtcDwalletPubkeyHex(
                        bytesToHex(bundle.compressedPubkey),
                      );
                      setBtcAddress(bundle.bitcoinAddress);
                      addLog({
                        status: "ok",
                        message:
                          bundle.source === "real-ika"
                            ? `Real Ika Secp256k1 dWallet created: ${bundle.ikaDwallet
                                .toBase58()
                                .slice(0, 8)}… → ${bundle.bitcoinAddress.slice(
                                0,
                                12,
                              )}…`
                            : `Synthetic Secp256k1 dWallet generated (${
                                bundle.fallbackReason ?? "Ika pre-alpha gap"
                              }). dWallet PDA, pubkey, and tb1q… address have all been filled in below — you can now fund the address from a faucet and click register_btc_vault().`,
                      });
                    } catch (e) {
                      addLog({ status: "fail", message: friendlyError(e) });
                    }
                  }}
                  title="One-click: generate a Secp256k1 keypair, derive the Ika dWallet PDA + tb1q… P2WPKH address, fill all three inputs below."
                >
                  Generate dWallet ⚡
                </Button>
              </div>
              <input
                placeholder="Ika dWallet account pubkey (base58)"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[11px] font-mono"
                value={btcIkaDwallet}
                onChange={(e) => setBtcIkaDwallet(e.target.value)}
              />
              <input
                placeholder="Compressed Secp256k1 pubkey (66 hex chars, starts with 02/03)"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[11px] font-mono"
                value={btcDwalletPubkeyHex}
                onChange={(e) => setBtcDwalletPubkeyHex(e.target.value)}
              />
              <div className="flex gap-2">
                <input
                  placeholder="tb1q… testnet P2WPKH address"
                  className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-[11px] font-mono"
                  value={btcAddress}
                  onChange={(e) => setBtcAddress(e.target.value)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="text-[10px]"
                  onClick={() => {
                    try {
                      const bytes = hexToBytes(btcDwalletPubkeyHex.trim());
                      setBtcAddress(secp256k1PubkeyToTestnetP2WPKH(bytes));
                    } catch (e) {
                      addLog({ status: "fail", message: friendlyError(e) });
                    }
                  }}
                  disabled={!btcDwalletPubkeyHex}
                  title="Derive tb1q… P2WPKH address from the compressed Secp256k1 pubkey (BIP141)"
                >
                  Derive ↻
                </Button>
              </div>
              <Button
                onClick={registerBtcVault}
                disabled={
                  !connected ||
                  running ||
                  !btcIkaDwallet ||
                  !btcDwalletPubkeyHex ||
                  !btcAddress
                }
                className="w-full text-xs"
              >
                register_btc_vault()
              </Button>
              <div className="text-[10px] text-muted-foreground space-y-1.5">
                <p>
                  Click <b>Generate dWallet ⚡</b> above to auto-fill all
                  three fields. The button runs Ika DKG with curve{" "}
                  <code>Secp256k1</code> when pre-alpha exposes it, and
                  otherwise falls back to a local Secp256k1 keypair (the
                  same pattern Ika's pre-alpha SDK uses for Curve25519). The
                  dWallet account address is derived deterministically from{" "}
                  <code>(curve, pubkey)</code> so it matches what the Ika
                  program would produce on-chain.
                </p>
                <p>
                  After generating, fund the tb1q… address from a Bitcoin
                  testnet faucet — the keeper service will pick up the
                  balance and post an attestation within ~15s, after which
                  you can borrow LGUSD against the tBTC.
                </p>
                <div className="flex flex-wrap gap-2">
                  {BTC_TESTNET_FAUCETS.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-orange-300 hover:underline"
                    >
                      faucet ↗
                    </a>
                  ))}
                </div>
              </div>
            </div>

            {/* Lookup + state */}
            <div className="rounded-lg border border-border bg-background/40 p-4 space-y-3">
              <div className="text-[10px] uppercase font-mono text-muted-foreground">
                2. Open an existing BTC vault
              </div>
              <input
                placeholder="BTC vault PDA (base58)"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[11px] font-mono"
                value={btcVaultInput}
                onChange={(e) => setBtcVaultInput(e.target.value)}
              />
              <Button
                variant="outline"
                onClick={() => void refreshBtcVault(btcVaultInput)}
                disabled={!btcVaultInput}
                className="w-full text-xs"
              >
                Load vault
              </Button>
              {btcVault && (
                <div className="space-y-2 text-[11px] font-mono">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">tb1 address</span>
                    <a
                      href={mempoolAddressUrl(btcVault.bitcoinAddress)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-orange-300 hover:underline truncate max-w-[240px]"
                    >
                      {btcVault.bitcoinAddress}
                    </a>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">attested</span>
                    <span>
                      {btcAttestation
                        ? `${formatBtc(btcAttestation.satoshis)} BTC @ ${btcAttestation.bitcoinBlockHeight}`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">proof status</span>
                    <span
                      className={
                        btcVault.proofStatus === 1
                          ? "text-green-300"
                          : "text-yellow-300"
                      }
                    >
                      {btcVault.proofStatus === 1
                        ? "VERIFIED"
                        : btcVault.proofStatus === 2
                          ? "EXPIRED"
                          : "PENDING"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">frozen</span>
                    <span className={btcVault.frozen ? "text-red-300" : ""}>
                      {String(btcVault.frozen)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Verify + borrow row */}
          {btcVault && (
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="rounded-lg border border-border bg-background/40 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase font-mono text-muted-foreground">
                    3. Custody proof
                  </div>
                  {btcVault.proofStatus === 1 ? (
                    <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded bg-green-500/10 text-green-300 border border-green-500/30">
                      auto-verified
                    </span>
                  ) : btcVault.proofStatus === 2 ? (
                    <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-300 border border-yellow-500/30">
                      expired
                    </span>
                  ) : (
                    <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-300 border border-yellow-500/30">
                      pending
                    </span>
                  )}
                </div>

                {btcVault.proofStatus === 1 ? (
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Custody was attested via Ika MessageApproval in the same
                    transaction that registered this vault. Proofs auto-expire
                    after 10 minutes — re-run the one-click flow below to
                    refresh.
                  </p>
                ) : (
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    The custody proof for this dWallet has not been verified
                    on-chain yet (or it expired). Click below to run the full
                    flow again, or paste a real Ika MessageApproval PDA
                    manually.
                  </p>
                )}

                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full text-xs"
                  disabled={!connected || running || !owner}
                  onClick={async () => {
                    if (!owner || !signTransaction || !btcVaultPda) return;
                    setRunning(true);
                    try {
                      const { ix: approveIx, messageApprovalPda } =
                        await buildDemoCreateMessageApprovalIx({
                          payer: owner,
                          dwalletId: btcVault.ikaDwallet.toBytes(),
                          isSigned: true,
                        });
                      const verifyIx = await buildVerifyBtcCustodyProofIx({
                        owner,
                        btcVaultPda,
                        messageApprovalPda,
                      });
                      const sig = await sendIx([approveIx, verifyIx], {
                        connection,
                        payer: owner,
                        signTransaction,
                      });
                      setBtcMessageApproval(messageApprovalPda.toBase58());
                      addLog({
                        status: "ok",
                        message:
                          "Custody proof refreshed — MessageApproval re-attested via demo helper and verified on-chain.",
                        tx: sig,
                        account: btcVaultPda.toBase58(),
                      });
                      await refreshBtcVault();
                    } catch (e) {
                      addLog({ status: "fail", message: friendlyError(e) });
                    } finally {
                      setRunning(false);
                    }
                  }}
                >
                  {btcVault.proofStatus === 1
                    ? "Refresh proof ↻"
                    : "Verify automatically ⚡"}
                </Button>

                <details className="text-[10px] text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">
                    Manual (advanced): paste a real Ika MessageApproval PDA
                  </summary>
                  <div className="space-y-2 mt-2">
                    <input
                      placeholder="Ika MessageApproval PDA (base58)"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-[11px] font-mono"
                      value={btcMessageApproval}
                      onChange={(e) => setBtcMessageApproval(e.target.value)}
                    />
                    <Button
                      onClick={verifyBtcVault}
                      disabled={!connected || running || !btcMessageApproval}
                      className="w-full text-[11px]"
                      variant="outline"
                      size="sm"
                    >
                      verify_btc_custody_proof()
                    </Button>
                    <p>
                      For when you have a real Ika-signed MessageApproval
                      (curve = Secp256k1, hash = EcdsaDoubleSha256 / BIP143)
                      produced through the Ika SDK directly. The on-chain
                      parser auto-detects the 287-byte real layout.
                    </p>
                  </div>
                </details>
              </div>

              <div className="rounded-lg border border-border bg-background/40 p-4 space-y-2">
                <div className="text-[10px] uppercase font-mono text-muted-foreground">
                  4. Borrow / repay LGUSD
                </div>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="block text-[9px] uppercase font-mono text-muted-foreground">
                      Amount (LGUSD)
                    </label>
                    <input
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-[11px] font-mono"
                      value={btcBorrowAmount}
                      onChange={(e) => setBtcBorrowAmount(e.target.value)}
                    />
                  </div>
                  <Button
                    onClick={borrowBtc}
                    disabled={
                      !connected ||
                      running ||
                      !pool ||
                      !btcVault ||
                      btcVault.proofStatus !== 1 ||
                      !btcAttestation ||
                      btcAttestation.satoshis === 0n ||
                      btcVault.frozen
                    }
                    className="text-xs"
                  >
                    Borrow
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => void repayBtc(false)}
                    disabled={
                      !btcPosition || btcPosition.principal === 0n || running
                    }
                    variant="outline"
                    className="flex-1 text-xs"
                  >
                    Repay
                  </Button>
                  <Button
                    onClick={() => void repayBtc(true)}
                    disabled={
                      !btcPosition || btcPosition.principal === 0n || running
                    }
                    variant="outline"
                    className="flex-1 text-xs border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
                  >
                    Repay All
                  </Button>
                </div>
                {btcPosition && btcPosition.principal > 0n && pool && (
                  <div className="text-[11px] font-mono text-muted-foreground">
                    open debt: {formatLgUsd(
                      currentDebt(btcPosition.principal, pool.borrowIndex),
                    )} LGUSD
                  </div>
                )}
                {(!btcAttestation || btcAttestation.satoshis === 0n) && (
                  <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-2 space-y-2">
                    <p className="text-[10px] text-yellow-300 leading-relaxed">
                      Attested balance is <b>0 sats</b>. Either fund the
                      tb1… address via a Bitcoin testnet faucet (the keeper
                      will pick it up automatically) — or, since your wallet
                      is the protocol admin/keeper authority on devnet, you
                      can inject a mock attestation directly for demo
                      purposes.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-[10px] h-7 border-yellow-500/40 text-yellow-200 hover:bg-yellow-500/10"
                      disabled={!connected || running || !owner || !btcVaultPda}
                      onClick={async () => {
                        if (!owner || !signTransaction || !btcVaultPda) return;
                        setRunning(true);
                        try {
                          // ~0.001 BTC = 100,000 sats. Plenty to borrow LGUSD against.
                          const satoshis = BigInt(100_000);
                          // Use the real Bitcoin testnet tip so the attestation
                          // mirrors what the keeper would have posted. Block hash
                          // = 32 zero bytes (the parser only checks length, not
                          // membership in any consensus chain).
                          let blockHeight: bigint;
                          try {
                            const res = await fetch(
                              "https://mempool.space/testnet/api/blocks/tip/height",
                            );
                            blockHeight = BigInt(
                              (await res.text()).trim() || "0",
                            );
                          } catch {
                            blockHeight = 0n;
                          }
                          const ix = await buildAttestBtcBalanceIx({
                            keeper: owner,
                            btcVaultPda,
                            satoshis,
                            bitcoinBlockHeight: blockHeight,
                            bitcoinBlockHash: new Uint8Array(32),
                          });
                          const sig = await sendIx(ix, {
                            connection,
                            payer: owner,
                            signTransaction,
                          });
                          addLog({
                            status: "ok",
                            message: `Mock attestation injected: 0.001 BTC @ block ${blockHeight}. You can now borrow LGUSD against this vault.`,
                            tx: sig,
                            account: btcVaultPda.toBase58(),
                          });
                          await refreshBtcVault();
                        } catch (e) {
                          addLog({
                            status: "fail",
                            message: friendlyError(e),
                          });
                        } finally {
                          setRunning(false);
                        }
                      }}
                      title="Devnet-only: protocol admin posts a synthetic 0.001 BTC attestation so demos don't depend on testnet faucet delivery."
                    >
                      Inject 0.001 BTC mock attestation (admin / devnet)
                    </Button>
                  </div>
                )}
                {btcVault.proofStatus !== 1 && (
                  <p className="text-[10px] text-yellow-300">
                    Custody proof is {btcVault.proofStatus === 2 ? "expired" : "pending"} —
                    click <b>Verify automatically ⚡</b> in step 3 to refresh.
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-6">
          <section className="rounded-xl border border-border bg-card p-6 space-y-5">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-400" />
              <h2 className="font-semibold text-sm">Borrow against verified collateral</h2>
            </div>

            {!connected ? (
              <p className="text-xs text-muted-foreground">Connect wallet to load your vaults.</p>
            ) : verifiedVaults.length === 0 ? (
              <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-4 text-xs text-yellow-200">
                No verified vault found. Run the <Link href="/demo" className="underline text-foreground">security demo</Link> first to register and verify custody proof.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {verifiedVaults.map((v) => {
                    const debt = vaultsWithOpenDebt.get(v.vaultPda.toBase58());
                    const hasDebt = debt !== undefined && debt > 0n;
                    return (
                      <button
                        key={v.vaultPda.toBase58()}
                        onClick={() => setSelectedVault(v)}
                        className={`w-full text-left rounded-lg border p-3 ${
                          selectedVault?.vaultPda.equals(v.vaultPda)
                            ? "border-primary bg-primary/5"
                            : "border-border bg-background/40"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <code className="text-xs">
                            {v.vaultPda.toBase58().slice(0, 10)}...{v.vaultPda.toBase58().slice(-6)}
                          </code>
                          <div className="flex items-center gap-1">
                            {hasDebt && (
                              <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px]">
                                OPEN DEBT
                              </Badge>
                            )}
                            <Badge className="bg-green-500/20 text-green-300 border-green-500/40 text-[10px]">
                              VERIFIED
                            </Badge>
                          </div>
                        </div>
                        <div className="mt-1 text-[10px] font-mono text-muted-foreground">
                          deposited {(Number(v.vault.depositedAmount) / 1e9).toFixed(4)} collateral units
                        </div>
                        {hasDebt && (
                          <div className="mt-1 text-[10px] font-mono text-amber-300/80">
                            outstanding: {formatLgUsd(debt!)} LGUSD — repay before opening a new borrow
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="grid sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
                  <div>
                    <label className="block text-[10px] uppercase font-mono text-muted-foreground mb-1">
                      Amount (LGUSD)
                    </label>
                    <input
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                  <Button
                    disabled={!pool || !selectedVault || running || selectedVaultHasDebt}
                    onClick={borrow}
                    className="gap-2 text-xs"
                    title={
                      selectedVaultHasDebt
                        ? "This vault already has an open borrow position. Repay it first."
                        : undefined
                    }
                  >
                    Borrow <ArrowRight className="w-3 h-3" />
                  </Button>
                  <Button
                    disabled={!position || position.principal === 0n || running}
                    onClick={() => repay(false)}
                    variant="outline"
                    className="text-xs"
                  >
                    Repay
                  </Button>
                  <Button
                    disabled={!position || position.principal === 0n || running}
                    onClick={() => repay(true)}
                    variant="outline"
                    className="text-xs border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
                    title="Pay the exact outstanding debt and close the position (refunds rent)"
                  >
                    Repay All
                  </Button>
                </div>
                {selectedVaultHasDebt && (
                  <p className="text-[10px] font-mono text-amber-300/90">
                    selected vault has an open position — Borrow is disabled. Use Repay All to close it, then Borrow becomes available again.
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h2 className="font-semibold text-sm">Current Borrow Position</h2>
            {!position ? (
              <p className="text-xs text-muted-foreground font-mono">
                No borrow position selected/created yet.
              </p>
            ) : (
              <div className="space-y-3">
                <Metric
                  label="current debt (incl. interest)"
                  value={`${formatLgUsd(pool ? currentDebt(position.principal, pool.borrowIndex) : position.principal)} LGUSD`}
                />
                <Metric label="scaled principal" value={`${formatLgUsd(position.principal)} (Aave-style)`} />
                {position.healthCiphertext.equals(PublicKey.default) ? (
                  <Metric label="health" value="public · plaintext" />
                ) : (
                  <div className="rounded-lg border border-purple-500/40 bg-purple-500/5 p-3 space-y-1.5">
                    <div className="text-[10px] uppercase text-purple-300 font-mono flex items-center gap-1.5">
                      <Shield className="w-3 h-3" />
                      health · encrypted · monitored
                    </div>
                    <div className="text-[11px] font-mono text-muted-foreground">
                      Debt + collateral + threshold sealed via Encrypt FHE.
                      MEV bots cannot front-run liquidations because the health
                      factor stays encrypted on-chain.
                    </div>
                    <a
                      href={explorerAccountUrl(position.healthCiphertext.toBase58())}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-[10px] text-purple-300 hover:underline font-mono"
                    >
                      ciphertext {position.healthCiphertext.toBase58().slice(0, 10)}...
                    </a>
                  </div>
                )}
                {positionPda && (
                  <a
                    href={explorerAccountUrl(positionPda)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-[10px] text-blue-400 hover:underline font-mono"
                  >
                    position {positionPda.slice(0, 10)}... on explorer
                  </a>
                )}
              </div>
            )}
          </section>
        </div>

        <section className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-orange-400" />
              <h2 className="font-semibold text-sm">Liquidation Console</h2>
              <Badge variant="outline" className="text-[10px] font-mono">
                {liquidatablePositions.length} eligible
              </Badge>
            </div>
            <p className="text-[10px] text-muted-foreground font-mono">
              health &lt; liquidation threshold · permissionless · liquidator
              repays debt + seizes collateral with bonus
            </p>
          </div>

          {liquidatablePositions.length === 0 ? (
            <p className="text-xs text-muted-foreground font-mono">
              No under-collateralised positions right now. Use{" "}
              <span className="text-red-300">Crash to $50k</span> on a vault you
              have outstanding debt on to make one liquidatable.
            </p>
          ) : (
            <div className="space-y-2">
              {liquidatablePositions.map((p) => {
                const vault = allVaults[p.position.vault.toBase58()];
                const isOwn = owner && p.position.owner.equals(owner);
                const debt = pool ? currentDebt(p.position.principal, pool.borrowIndex) : p.position.principal;
                return (
                  <div
                    key={p.positionPda.toBase58()}
                    className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 flex items-center justify-between gap-3 flex-wrap"
                  >
                    <div className="space-y-1">
                      <code className="text-xs">
                        position {p.positionPda.toBase58().slice(0, 10)}...
                      </code>
                      <div className="text-[10px] font-mono text-muted-foreground space-x-2">
                        <span>borrower {p.position.owner.toBase58().slice(0, 8)}...</span>
                        <span>debt {formatLgUsd(debt)} LGUSD</span>
                        <span>
                          collateral{" "}
                          {vault
                            ? (Number(vault.vault.depositedAmount) / 1e9).toFixed(4)
                            : "?"}{" "}
                          units
                        </span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => void liquidate(p)}
                      disabled={!connected || running || isOwn || !pool}
                      className="bg-orange-500 hover:bg-orange-500/90 text-background text-xs gap-1"
                    >
                      <Flame className="w-3 h-3" />
                      {isOwn ? "your own position" : "Liquidate"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-6 space-y-3">
          <span className="text-xs font-mono text-muted-foreground">// EVENT LOG</span>
          {log.length === 0 ? (
            <p className="text-xs text-muted-foreground font-mono">Waiting for lending action...</p>
          ) : (
            <div className="space-y-1.5">
              {log.map((entry, idx) => (
                <div key={idx} className="text-xs font-mono flex items-start gap-2">
                  <span
                    className={
                      entry.status === "ok"
                        ? "text-green-400"
                        : entry.status === "fail"
                          ? "text-red-400"
                          : "text-yellow-400"
                    }
                  >
                    {entry.status === "ok" ? "✓" : entry.status === "fail" ? "✗" : "!"}
                  </span>
                  <span className="text-muted-foreground flex-1">
                    {entry.message}
                    {entry.tx && (
                      <>
                        {" "}
                        <a href={explorerTxUrl(entry.tx)} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                          (tx)
                        </a>
                      </>
                    )}
                    {entry.account && (
                      <>
                        {" "}
                        <a href={explorerAccountUrl(entry.account)} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                          (account)
                        </a>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <p className="text-[10px] font-mono text-muted-foreground/60">
          token program: {TOKEN_PROGRAM_ID.toBase58()}
        </p>
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/40 p-3">
      <div className="text-[10px] uppercase text-muted-foreground font-mono mb-1">
        {label}
      </div>
      <div className="text-sm font-semibold font-mono">{value}</div>
    </div>
  );
}

function friendlyError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
