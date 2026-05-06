# LendGuard Contract Deployment Guide

## ✅ What's Ready

Your devnet wallet keypair has been created:
- **Location**: `~/.config/solana/lendguard-devnet.json`
- **Public Key**: `D9qXT64hSqecCwsExggXx4N1S38U4QUGLU7pGxUP3vDd`

## 🚀 Deployment Steps

### Step 1: Fund Your Wallet (Required)
Visit the Solana Devnet Faucet:
```
https://faucet.solana.com
```

Paste your public key: `D9qXT64hSqecCwsExggXx4N1S38U4QUGLU7pGxUP3vDd`

Request 2-5 SOL for devnet testing.

### Step 2: Verify You Have Tools
Run these commands (they should work now):

```bash
# Check Anchor
anchor --version

# Check Rust
rustc --version
```

If either fails, you need to install them.

### Step 3: Build the Contract
```bash
cd contracts
anchor build
```

This creates:
- `/target/deploy/lendguard_proof_vault.so` (compiled program)
- `/target/deploy/lendguard_proof_vault-keypair.json` (program ID)

### Step 4: Deploy
```bash
# Option A: Use the deployment script (recommended)
node deploy.js

# Option B: Manual deployment
anchor deploy --provider.cluster devnet \
  --provider.wallet ~/.config/solana/lendguard-devnet.json
```

## 📋 What Happens During Deployment

1. **Build** - Compile Rust code to BPF
2. **Extract Program ID** - Generate unique program address
3. **Update Anchor.toml** - Register program ID
4. **Update lib.rs** - Set `declare_id!()` macro
5. **Deploy** - Upload to Solana Devnet
6. **Verify** - Check transaction on blockchain

## 🔍 Verify Deployment

After deployment succeeds, you'll see output like:
```
Program Id: 8qkV5XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

View your deployed program:
```
https://explorer.solana.com/address/8qkV5.../cluster=devnet
```

## ❌ Troubleshooting

### "Insufficient funds"
- Solution: Fund your wallet from faucet (Step 1)

### "Program already deployed with this ID"
- Solution: Use a fresh keypair:
  ```bash
  rm ~/.config/solana/lendguard-devnet.json
  node create-keypair.js
  ```

### "Cannot connect to devnet"
- Solution: Check your internet connection, or use a different RPC:
  ```bash
  export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
  ```

### "Build fails"
- Solution: Ensure dependencies are installed:
  ```bash
  cargo build --release
  ```

## ✨ Next Steps After Deployment

1. **Verify on Explorer**: Check transaction on Solana Explorer
2. **Test Instructions**: Create test transactions to verify functionality
3. **Integrate Ika dWallet CPI**: Update `verify_custody_proof.rs`
4. **Integrate Encrypt FHE CPI**: Update `trigger_risk_check.rs`
5. **Frontend Demo**: Connect to deployed program from web UI

## 📞 Support

If deployment fails:
1. Check network connection
2. Verify wallet has SOL
3. Review build logs for Rust errors
4. Check Solana Explorer for transaction status

---

**Ready?** Run: `node deploy.js`
