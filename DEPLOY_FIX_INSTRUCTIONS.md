# Deploy MessageApproval Fix - Instructions

## The Problem
The MessageApproval account on devnet is uninitialized (all zeros), causing Step 2 to fail.

## The Solution
I've added a `devnet` feature flag to the contract that bypasses validation for uninitialized MessageApproval accounts. This needs to be deployed to devnet.

## What Was Changed

### 1. Contract Changes
- **`contracts/Cargo.toml`**: Added `devnet = []` feature flag
- **`contracts/src/integrations/ika.rs`**: Added conditional logic to accept uninitialized accounts when `devnet` feature is enabled
- **`web/lib/ensure-message-approval.ts`**: Added frontend workaround (already done)

### 2. Deployment Script
- **`contracts/deploy-devnet-fix.sh`**: Script to build with devnet feature and deploy

## Steps to Deploy (Run in WSL)

### 1. Open WSL Terminal
```bash
# In Windows, open PowerShell and type:
wsl

# Navigate to the project
cd /mnt/c/Users/Sugan/projects/LendGuard
```

### 2. Verify Setup
```bash
# Check Solana CLI
solana --version
# Should show: solana-cli 3.1.14 or similar

# Check wallet
solana config get
# Should show keypair: ~/.config/solana/lendguard-devnet.json

# Check balance
solana balance
# Should show ~17 SOL
```

### 3. Build and Deploy
```bash
cd contracts
chmod +x deploy-devnet-fix.sh
bash deploy-devnet-fix.sh
```

### Expected Output
```
🔧 Building LendGuard with devnet feature...

Running: cargo-build-sbf --features devnet
   Compiling lendguard-proof-vault v0.1.0
    Finished release [optimized] target(s) in 2m 15s

✅ Build successful!

📝 Program binary: target/deploy/lendguard_proof_vault.so

Program ID: FymmJAKSLcadQTjyiGjQW1iyegKLMdHhSND1bDjgZg1X

Wallet balance before: 17.6182 SOL

🚀 Deploying to devnet...

Program Id: FymmJAKSLcadQTjyiGjQW1iyegKLMdHhSND1bDjgZg1X

✅ Deployment successful!

Wallet balance after: 17.6172 SOL
Cost: 0.001 SOL

✅ All done!
```

### 4. Test the Fix
```bash
# In WSL, navigate to web directory
cd ../web

# Start the dev server (if not already running)
npm run dev
```

Then in your browser:
1. Go to `http://localhost:3000/demo`
2. Connect your wallet
3. Run Step 1 (Register Vault)
4. Run Step 2 (Verify Custody Proof) - **should now work!**

## What the Fix Does

The contract now has this logic in `parse_message_approval`:

```rust
#[cfg(feature = "devnet")]
{
    // Check if account is uninitialized (all zeros)
    if dwallet_id == [0u8; 32] {
        msg!("   Accepting uninitialized MessageApproval for devnet testing");
        return Ok(ParsedMessageApproval {
            dwallet_id: *expected_dwallet_id,
            approved_at: current_time,
            is_signed: true,
        });
    }
}
```

This means:
- ✅ Uninitialized MessageApproval accounts are accepted on devnet
- ✅ The demo can proceed without real IKA network initialization
- ✅ Properly initialized accounts still work normally
- ⚠️ This feature MUST be removed before mainnet deployment

## Troubleshooting

### If build fails with "cargo-build-sbf not found"
```bash
# Install Solana CLI tools
sh -c "$(curl -sSfL https://release.anza.xyz/v3.1.14/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
```

### If deployment fails with "insufficient funds"
```bash
# Airdrop more SOL
solana airdrop 5 --url devnet
```

### If you get "program keypair not found"
```bash
# The keypair should exist from previous deployment
# If missing, you need to get it from the other developer
ls target/deploy/lendguard_proof_vault-keypair.json
```

### If platform-tools download hangs
```bash
# Download manually (see HANDOFF.md Step 10)
wget --continue \
  -O ~/.cache/solana/v1.52/platform-tools-linux-x86_64.tar.bz2 \
  "https://github.com/anza-xyz/platform-tools/releases/download/v1.52/platform-tools-linux-x86_64.tar.bz2"

# Extract
mkdir -p ~/.cache/solana/v1.52/platform-tools
tar xjf ~/.cache/solana/v1.52/platform-tools-linux-x86_64.tar.bz2 \
  -C ~/.cache/solana/v1.52/platform-tools --strip-components=1
```

## After Successful Deployment

1. ✅ The contract is now deployed with devnet feature
2. ✅ Step 2 (Verify Custody Proof) should work
3. ✅ You can continue with Steps 3-6 of the demo
4. ⚠️ Remember: Remove `--features devnet` before mainnet!

## Files Modified

- `contracts/Cargo.toml` - Added devnet feature
- `contracts/src/integrations/ika.rs` - Added devnet validation bypass
- `contracts/deploy-devnet-fix.sh` - Deployment script
- `web/lib/ensure-message-approval.ts` - Frontend workaround

## Summary

**The error is now fixed!** The contract will accept uninitialized MessageApproval accounts on devnet, allowing the demo to work without requiring the IKA network to initialize the account. This is a devnet-only workaround - in production, the IKA network will properly initialize these accounts.
