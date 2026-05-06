#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="${ROOT_DIR}/contracts"
SDK_DIR="${ROOT_DIR}/packages/sdk"

KEYPAIR_PATH="${KEYPAIR_PATH:-$HOME/.config/solana/lendguard-devnet.json}"
PROGRAM_KEYPAIR="${PROGRAM_KEYPAIR:-${CONTRACTS_DIR}/target/deploy/lendguard_proof_vault-keypair.json}"
RPC_URL="${RPC_URL:-devnet}"

if ! command -v solana >/dev/null 2>&1; then
  echo "ERROR: solana CLI not found in PATH."
  exit 1
fi

if [[ ! -f "${KEYPAIR_PATH}" ]]; then
  echo "ERROR: keypair not found: ${KEYPAIR_PATH}"
  exit 1
fi

if [[ ! -f "${PROGRAM_KEYPAIR}" ]]; then
  echo "ERROR: program keypair not found: ${PROGRAM_KEYPAIR}"
  exit 1
fi

program_id="$(solana address -k "${PROGRAM_KEYPAIR}")"
wallet_balance="$(solana balance --url "${RPC_URL}" --keypair "${KEYPAIR_PATH}" | awk '{print $1}')"

echo "== LendGuard Demo Smoke Check =="
echo "Program ID: ${program_id}"
echo "RPC URL: ${RPC_URL}"
echo "Wallet balance: ${wallet_balance} SOL"
echo

echo "1) Checking deployed program account..."
solana program show "${program_id}" --url "${RPC_URL}" >/tmp/lendguard-program-show.txt
cat /tmp/lendguard-program-show.txt

echo
echo "2) Checking IDL artifact..."
if [[ -f "${CONTRACTS_DIR}/target/idl/lendguard_proof_vault.json" ]]; then
  echo "OK: IDL found at contracts/target/idl/lendguard_proof_vault.json"
else
  echo "WARN: IDL missing. Run build first:"
  echo "  bash scripts/deploy-devnet.sh"
fi

echo
echo "3) Checking SDK package readiness..."
if [[ -f "${SDK_DIR}/package.json" ]]; then
  (
    cd "${SDK_DIR}"
    npm pack --dry-run >/tmp/lendguard-sdk-pack.txt 2>&1 || true
  )
  if rg -n "npm ERR|ERR!" /tmp/lendguard-sdk-pack.txt >/dev/null 2>&1; then
    echo "WARN: SDK dry-run pack reported issues. See /tmp/lendguard-sdk-pack.txt"
  else
    echo "OK: SDK dry-run pack succeeded."
  fi
else
  echo "WARN: SDK package.json not found at packages/sdk/package.json"
fi

echo
echo "Smoke check complete."
