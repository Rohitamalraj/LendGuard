#!/bin/bash
# Install Solana in WSL

echo "Installing Solana CLI..."
sh -c "$(curl -sSfL https://release.anza.xyz/v3.1.14/install)"

# Add to PATH
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc

# Verify
solana --version
