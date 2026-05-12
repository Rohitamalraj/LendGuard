"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

export function ConnectWalletButton() {
  const { connected, publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="text-sm h-9 px-3 border-border"
        disabled
      >
        Select Wallet
      </Button>
    );
  }

  if (connected && publicKey) {
    const base = publicKey.toBase58();
    const short = `${base.slice(0, 4)}…${base.slice(-4)}`;
    return (
      <Button
        size="sm"
        variant="outline"
        className="text-sm h-9 px-3 border-border font-mono"
        onClick={() => disconnect()}
        title={base}
      >
        {short}
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="text-sm h-9 px-3 border-border"
      onClick={() => setVisible(true)}
      disabled={connecting}
    >
      {connecting ? "Connecting…" : "Select Wallet"}
    </Button>
  );
}
