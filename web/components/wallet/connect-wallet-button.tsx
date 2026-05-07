"use client";

import dynamic from "next/dynamic";

export const ConnectWalletButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);
