#!/bin/bash
set -e

echo "🚀 LendGuard Deployment Script for WSL"
echo "========================================"
echo ""

# Step 1: Check if Solana is installed
if ! command -v solana &> /dev/null; then
    echo "📦 Installing Solana CLI..."
    sh -c "$(curl -sSfL https://release.anza.xyz/v3.1.14/install)"
    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
    echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
    echo "✅ Solana CLI installed"
else
    echo "✅ Solana CLI already installed"
    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
fi

solana --version
echo ""

# Step 2: Check if wallet exists
WALLET_PATH="$HOME/.config/solana/lendguard-devnet.json"
if [ ! -f "$WALLET_PATH" ]; then
    echo "⚠️  Wallet not found at $WALLET_PATH"
    echo "   Checking if it exists in Windows..."
    
    # Try to find it in Windows path
    WIN_WALLET="/mnt/host/c/Users/Sugan/projects/LendGuard/contracts/lendguard-devnet.json"
    if [ -f "$WIN_WALLET" ]; then
        echo "   Found wallet in Windows, copying to WSL..."
        mkdir -p "$HOME/.config/solana"
        cp "$WIN_WALLET" "$WALLET_PATH"
        echo "✅ Wallet copied"
    else
        echo "❌ Wallet not found. Please place lendguard-devnet.json in:"
        echo "   $WIN_WALLET"
        exit 1
    fi
else
    echo "✅ Wallet found"
fi

# Step 3: Configure Solana
echo "🔧 Configuring Solana..."
solana config set --url devnet --keypair "$WALLET_PATH"
echo ""

# Step 4: Check balance
echo "💰 Checking wallet balance..."
BALANCE=$(solana balance)
echo "   Balance: $BALANCE"
echo ""

# Step 5: Check if program keypair exists
PROGRAM_KEYPAIR="contracts/target/deploy/lendguard_proof_vault-keypair.json"
if [ ! -f "$PROGRAM_KEYPAIR" ]; then
    echo "⚠️  Program keypair not found at $PROGRAM_KEYPAIR"
    echo "   Checking Windows path..."
    
    WIN_PROGRAM_KEYPAIR="/mnt/host/c/Users/Sugan/projects/LendGuard/contracts/target/deploy/lendguard_proof_vault-keypair.json"
    if [ -f "$WIN_PROGRAM_KEYPAIR" ]; then
        echo "   Found in Windows, using that path"
        PROGRAM_KEYPAIR="$WIN_PROGRAM_KEYPAIR"
    else
        echo "❌ Program keypair not found"
        echo "   Expected at: $WIN_PROGRAM_KEYPAIR"
        exit 1
    fi
else
    echo "✅ Program keypair found"
fi

PROGRAM_ID=$(solana-keygen pubkey "$PROGRAM_KEYPAIR")
echo "   Program ID: $PROGRAM_ID"
echo ""

# Step 6: Build with devnet feature
echo "🔨 Building contracts with devnet feature..."
cd contracts
cargo-build-sbf --features devnet

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo "✅ Build successful"
echo ""

# Step 7: Deploy
echo "🚀 Deploying to devnet..."
BALANCE_BEFORE=$(solana balance | awk '{print $1}')

solana program deploy \
  --program-id "$PROGRAM_KEYPAIR" \
  --url devnet \
  --keypair "$WALLET_PATH" \
  target/deploy/lendguard_proof_vault.so

if [ $? -ne 0 ]; then
    echo "❌ Deployment failed"
    exit 1
fi

echo ""
echo "✅ Deployment successful!"
echo ""

# Step 8: Check balance after
BALANCE_AFTER=$(solana balance | awk '{print $1}')
echo "💰 Wallet balance:"
echo "   Before: $BALANCE_BEFORE SOL"
echo "   After:  $BALANCE_AFTER SOL"
echo ""

# Step 9: Verify on-chain
echo "🔍 Verifying on-chain..."
solana program show "$PROGRAM_ID" --url devnet
echo ""

echo "✅ Deployment complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Restart your dev server: cd ../web && npm run dev"
echo "   2. Refresh http://localhost:3000/demo"
echo "   3. Try Step 2 (Verify Custody Proof)"
echo ""
echo "🔗 Explorer:"
echo "   https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo ""
