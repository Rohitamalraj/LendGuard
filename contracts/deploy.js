#!/usr/bin/env node
/**
 * LendGuard Deployment Helper for Windows/PowerShell
 * This script handles the deployment workflow for the proof_vault program
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function log(msg, type = 'info') {
  const colors = {
    success: '\x1b[32m✅\x1b[0m',
    error: '\x1b[31m❌\x1b[0m',
    warning: '\x1b[33m⚠️\x1b[0m',
    info: '\x1b[36mℹ️\x1b[0m',
  };
  console.log(`${colors[type] || colors.info} ${msg}`);
}

async function deploy() {
  try {
    log('Starting LendGuard Deployment...', 'info');

    // Step 1: Check anchor
    log('Step 1: Checking Anchor CLI...', 'info');
    try {
      execSync('anchor --version', { stdio: 'pipe' });
      log('Anchor CLI found', 'success');
    } catch (e) {
      log('Anchor CLI not found. Install with: npm install -g @coral-xyz/anchor', 'error');
      process.exit(1);
    }

    // Step 2: Check keypair
    const keypairPath = path.join(process.env.USERPROFILE || process.env.HOME, '.config', 'solana', 'lendguard-devnet.json');
    if (!fs.existsSync(keypairPath)) {
      log(`Keypair not found at ${keypairPath}`, 'error');
      log('Generate it first: node create-keypair.js', 'warning');
      process.exit(1);
    }
    log('Keypair found', 'success');

    // Step 3: Build
    log('Step 2: Building contract...', 'info');
    try {
      execSync('anchor build', { cwd: __dirname, stdio: 'inherit' });
      log('Build successful', 'success');
    } catch (e) {
      log('Build failed', 'error');
      process.exit(1);
    }

    // Step 4: Get Program ID
    log('Step 3: Extracting Program ID...', 'info');
    const programKeypairPath = path.join(__dirname, 'target', 'deploy', 'lendguard_proof_vault-keypair.json');
    if (!fs.existsSync(programKeypairPath)) {
      log('Program keypair not found after build', 'error');
      process.exit(1);
    }
    
    const programKeypair = JSON.parse(fs.readFileSync(programKeypairPath, 'utf8'));
    const { PublicKey } = require('@solana/web3.js');
    const programId = new PublicKey(programKeypair.slice(32)).toString();
    log(`Program ID: ${programId}`, 'success');

    // Step 5: Update Anchor.toml
    log('Step 4: Updating Anchor.toml...', 'info');
    let anchorToml = fs.readFileSync(path.join(__dirname, 'Anchor.toml'), 'utf8');
    anchorToml = anchorToml.replace(
      /lendguard_proof_vault = ".*"/,
      `lendguard_proof_vault = "${programId}"`
    );
    fs.writeFileSync(path.join(__dirname, 'Anchor.toml'), anchorToml);
    log('Anchor.toml updated', 'success');

    // Step 6: Update lib.rs
    log('Step 5: Updating lib.rs with Program ID...', 'info');
    let libRs = fs.readFileSync(path.join(__dirname, 'src', 'lib.rs'), 'utf8');
    libRs = libRs.replace(
      /declare_id!\(".*"\);/,
      `declare_id!("${programId}");`
    );
    fs.writeFileSync(path.join(__dirname, 'src', 'lib.rs'), libRs);
    log('lib.rs updated', 'success');

    // Step 7: Deploy
    log('Step 6: Deploying to Devnet...', 'info');
    log('Make sure your wallet is funded! Visit: https://faucet.solana.com', 'warning');
    try {
      execSync('anchor deploy --provider.cluster devnet', { 
        cwd: __dirname, 
        stdio: 'inherit',
        env: {
          ...process.env,
          ANCHOR_WALLET: keypairPath,
        }
      });
      log('Deployment successful!', 'success');
      log(`Program ID: ${programId}`, 'info');
      log(`View on Solana Explorer: https://explorer.solana.com/address/${programId}?cluster=devnet`, 'info');
    } catch (e) {
      log('Deployment failed. Check your network and wallet balance', 'error');
      process.exit(1);
    }

  } catch (error) {
    log(`Deployment error: ${error.message}`, 'error');
    process.exit(1);
  }
}

deploy();
