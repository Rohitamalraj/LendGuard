#!/bin/bash

# Deploy LendGuard with devnet feature flag to fix MessageApproval validation

echo "🔧 Building LendGuard with devnet feature..."
echo ""

# Build with devnet feature using cargo-build-sbf (not anchor build)
cd "$(dirname "$0")"  # Ensure we're in contracts directory

echo "Running: cargo-build-sbf --features devnet"
cargo-build-sbf --features devnet

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo ""
echo "✅ Build successful!"
echo ""
echo "📝 Program binary: target/deploy/lendguard_proof_vault.so"
echo ""

# Get current program ID from the keypair
PROGRAM_KEYPAIR="target/deploy/lendguard_proof_vault-keypair.json"
if [ ! -f "$PROGRAM_KEYPAIR" ]; then
    echo "❌ Program keypair not found at $PROGRAM_KEYPAIR"
    echo "   This file should exist from the previous deployment"
    exit 1
fi

PROGRAM_ID=$(solana-keygen pubkey "$PROGRAM_KEYPAIR")
echo "Program ID: $PROGRAM_ID"
echo ""

# Check wallet balance before deploy
WALLET_PATH="$HOME/.config/solana/lendguard-devnet.json"
if [ ! -f "$WALLET_PATH" ]; then
    echo "❌ Wallet not found at $WALLET_PATH"
    echo "   See HANDOFF.md Step 6 for wallet setup"
    exit 1
fi

BALANCE_BEFORE=$(solana balance --url devnet --keypair "$WALLET_PATH" | awk '{print $1}')
echo "Wallet balance before: $BALANCE_BEFORE SOL"
echo ""

# Deploy to devnet
echo "🚀 Deploying to devnet..."
echo ""

solana program deploy \
  --program-id "$PROGRAM_KEYPAIR" \
  --url devnet \
  --keypair "$WALLET_PATH" \
  target/deploy/lendguard_proof_vault.so

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Deployment failed"
    echo ""
    echo "💡 Common issues:"
    echo "   1. Insufficient SOL balance - run: solana airdrop 5 --url devnet --keypair $WALLET_PATH"
    echo "   2. Network issues - try again"
    echo "   3. Program buffer account issues - check logs above"
    exit 1
fi

echo ""
echo "✅ Deployment successful!"
echo ""

# Check balance after
BALANCE_AFTER=$(solana balance --url devnet --keypair "$WALLET_PATH" | awk '{print $1}')
echo "Wallet balance after: $BALANCE_AFTER SOL"
echo "Cost: $(echo "$BALANCE_BEFORE - $BALANCE_AFTER" | bc) SOL"
echo ""

# Verify on-chain
echo "🔍 Verifying on-chain..."
solana program show "$PROGRAM_ID" --url devnet
echo ""

# Update .env files
echo "📝 Updating .env files..."

# Update web/.env
if [ -f "../web/.env" ]; then
    sed -i.bak "s/NEXT_PUBLIC_LENDGUARD_PROGRAM_ID=.*/NEXT_PUBLIC_LENDGUARD_PROGRAM_ID=$PROGRAM_ID/" ../web/.env
    echo "   ✓ Updated ../web/.env"
fi

# Update contracts/.env
if [ -f ".env" ]; then
    sed -i.bak "s/LENDGUARD_PROGRAM_ID=.*/LENDGUARD_PROGRAM_ID=$PROGRAM_ID/" .env
    echo "   ✓ Updated .env"
fi

echo ""
echo "✅ All done!"
echo ""
echo "📋 Next steps:"
echo "   1. Restart your dev server: cd ../web && npm run dev"
echo "   2. Refresh the demo page at http://localhost:3000/demo"
echo "   3. Try Step 2 (Verify Custody Proof) again"
echo ""
echo "🔗 View on Explorer:"
echo "   https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo ""
echo "⚠️  IMPORTANT: This deployment includes the devnet feature flag"
echo "   which bypasses MessageApproval validation for uninitialized accounts."
echo "   Remove this feature before mainnet deployment!"
echo ""
