#!/usr/bin/env bash
# Patch the @ika.xyz/pre-alpha-solana-client SDK so Next.js Turbopack can
# resolve its imports. The published package uses ESM `.js` import paths
# pointing at `.ts` source files (TypeScript "bundler" convention), but
# Turbopack doesn't auto-resolve these for transpiled node_modules packages.
#
# This script strips the `.js` extension from a handful of imports inside
# `grpc-web.ts`. Run after `npm install`.

set -euo pipefail

SDK_DIR="${1:-node_modules/@ika.xyz/pre-alpha-solana-client/src}"

if [[ ! -f "${SDK_DIR}/grpc-web.ts" ]]; then
  echo "Ika SDK not found at ${SDK_DIR}; nothing to patch." >&2
  exit 0
fi

patch_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    sed -i "s|from './generated/grpc-web/ika_dwallet.client.js'|from './generated/grpc-web/ika_dwallet.client'|g" "$file"
    sed -i "s|from './generated/grpc/ika_dwallet.js'|from './generated/grpc/ika_dwallet'|g" "$file"
    sed -i "s|from './bcs-types.js'|from './bcs-types'|g" "$file"
    echo "Patched: $file"
  fi
}

patch_file "${SDK_DIR}/grpc-web.ts"
patch_file "${SDK_DIR}/grpc.ts"
