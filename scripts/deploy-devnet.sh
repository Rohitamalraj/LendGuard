#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="${ROOT_DIR}/contracts"

KEYPAIR_PATH="${KEYPAIR_PATH:-$HOME/.config/solana/lendguard-devnet.json}"
PROGRAM_KEYPAIR="${PROGRAM_KEYPAIR:-${CONTRACTS_DIR}/target/deploy/lendguard_proof_vault-keypair.json}"
PROGRAM_SO="${PROGRAM_SO:-${CONTRACTS_DIR}/target/deploy/lendguard_proof_vault.so}"
RPC_URL="${RPC_URL:-devnet}"

if ! command -v solana >/dev/null 2>&1; then
  echo "ERROR: solana CLI not found in PATH."
  exit 1
fi

if ! command -v cargo-build-sbf >/dev/null 2>&1; then
  echo "ERROR: cargo-build-sbf not found in PATH."
  exit 1
fi

if [[ ! -f "${KEYPAIR_PATH}" ]]; then
  echo "ERROR: keypair not found: ${KEYPAIR_PATH}"
  exit 1
fi

if [[ ! -f "${PROGRAM_KEYPAIR}" ]]; then
  echo "ERROR: program keypair not found: ${PROGRAM_KEYPAIR}"
  echo "Tip: generate it once with:"
  echo "  solana-keygen new -o \"${PROGRAM_KEYPAIR}\""
  exit 1
fi

program_id="$(solana address -k "${PROGRAM_KEYPAIR}")"

echo "== LendGuard Devnet Deploy =="
echo "Program ID: ${program_id}"
echo "RPC URL: ${RPC_URL}"
echo "Wallet: ${KEYPAIR_PATH}"
echo

pre_balance="$(solana balance --url "${RPC_URL}" --keypair "${KEYPAIR_PATH}" | awk '{print $1}')"
echo "Pre-deploy wallet balance: ${pre_balance} SOL"

echo
echo "== Building SBF program =="
(
  cd "${CONTRACTS_DIR}"
  cargo-build-sbf
)

if [[ ! -f "${PROGRAM_SO}" ]]; then
  echo "ERROR: build completed but .so not found: ${PROGRAM_SO}"
  exit 1
fi

echo
echo "== Deploying to devnet =="
deploy_output="$(solana program deploy \
  --program-id "${PROGRAM_KEYPAIR}" \
  --url "${RPC_URL}" \
  --keypair "${KEYPAIR_PATH}" \
  "${PROGRAM_SO}")"
echo "${deploy_output}"

post_balance="$(solana balance --url "${RPC_URL}" --keypair "${KEYPAIR_PATH}" | awk '{print $1}')"
echo
echo "Post-deploy wallet balance: ${post_balance} SOL"

python3 - "${pre_balance}" "${post_balance}" <<'PY'
import sys
pre = float(sys.argv[1])
post = float(sys.argv[2])
spent = pre - post
print(f"Approx wallet spend: {spent:.8f} SOL")
PY

echo
echo "== Program on chain =="
solana program show "${program_id}" --url "${RPC_URL}"
