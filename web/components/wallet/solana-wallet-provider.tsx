"use client";

import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl, type ConnectionConfig } from "@solana/web3.js";

import "@solana/wallet-adapter-react-ui/styles.css";
import { retryingFetch } from "@/lib/rpc-fetch";

export function SolanaWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(
    () =>
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? clusterApiUrl(network),
    [network],
  );

  // Pass a retrying fetch into the Connection so transient RPC failures
  // (rate-limit 429s, network errors on the free public devnet endpoint)
  // self-heal instead of crashing the demo with a "Failed to fetch" toast.
  const config = useMemo<ConnectionConfig>(
    () => ({ commitment: "confirmed", fetch: retryingFetch }),
    [],
  );

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
