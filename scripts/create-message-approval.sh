#!/bin/bash

# Create mock MessageApproval account on devnet
# Usage: bash scripts/create-message-approval.sh

echo "📝 Creating mock MessageApproval account on devnet..."
echo ""

# Check Solana CLI
if ! command -v solana &> /dev/null; then
  echo "❌ Solana CLI not found. Install from: https://docs.solana.com/cli/install-solana-cli-tools"
  exit 1
fi

# Load key path from .env
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$( dirname "$SCRIPT_DIR" )"

# Try to get SOLANA_PRIVATE_KEY from .env files
KEY_STR=""
for ENV_FILE in "$SCRIPT_DIR/.env" "$ROOT_DIR/.env" "$ROOT_DIR/web/.env"; do
  if [ -f "$ENV_FILE" ]; then
    KEY_STR=$(grep "SOLANA_PRIVATE_KEY=" "$ENV_FILE" | cut -d'=' -f2 | tr -d ' ')
    if [ -n "$KEY_STR" ]; then
      echo "✓ Found SOLANA_PRIVATE_KEY in: $ENV_FILE"
      break
    fi
  fi
done

if [ -z "$KEY_STR" ]; then
  echo "❌ SOLANA_PRIVATE_KEY not found in .env files"
  exit 1
fi

# Write temp keypair file
TEMP_KEYPAIR=$(mktemp)
echo "[$KEY_STR]" > "$TEMP_KEYPAIR"

# Get the public key
PAYER=$(solana-keygen pubkey "$TEMP_KEYPAIR")
echo "✓ Payer: $PAYER"
echo ""

# Check balance
BALANCE=$(solana balance "$PAYER" --url devnet | awk '{print $1}')
echo "💰 Balance: $BALANCE SOL"

if (( $(echo "$BALANCE < 0.005" | bc -l) )); then
  echo "⚠️  Low balance. Need at least 0.005 SOL."
  echo "   Run: solana airdrop 2 --url devnet"
  rm "$TEMP_KEYPAIR"
  exit 1
fi

# Generate new keypair for MessageApproval
APPROVAL_KEYPAIR=$(mktemp)
solana-keygen new --no-bip39-passphrase --outfile "$APPROVAL_KEYPAIR" > /dev/null

# Get pubkey
APPROVAL_PUBKEY=$(solana-keygen pubkey "$APPROVAL_KEYPAIR")

echo ""
echo "📍 MessageApproval pubkey:"
echo "   $APPROVAL_PUBKEY"
echo ""

echo "✓ Create this account on chain (requires transaction)"
echo ""
echo "To use in demo:"
echo "  • Paste into Step 2 input on /demo page, or"
echo "  • Add to web/.env: NEXT_PUBLIC_DEMO_MESSAGE_APPROVAL=$APPROVAL_PUBKEY"
echo ""

# Cleanup
rm "$TEMP_KEYPAIR" "$APPROVAL_KEYPAIR"
