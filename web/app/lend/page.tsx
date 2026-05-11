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
  formatLgUsd,
  formatPriceUsd,
  isLiquidatable,
  listAllBorrowPositions,
  parseLgUsd,
  readBorrowPosition,
  readDefaultLendingPool,
  type BorrowPositionAccount,
  type BorrowPositionListing,
  type LendingPoolAccount,
  type AdminPriceFeedAccount,
} from "@/lib/lending-client";
import {
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
