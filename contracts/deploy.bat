@echo off
REM LendGuard Deployment Script for Windows
REM Automates the entire deployment process

echo.
echo ========================================
echo  LendGuard Contract Deployment
echo ========================================
echo.

REM Check if in contracts directory
if not exist "src\lib.rs" (
    echo ERROR: Please run this script from the contracts directory
    echo cd contracts
    pause
    exit /b 1
)

REM Step 1: Generate keypair if not exists
if not exist "%USERPROFILE%\.config\solana\lendguard-devnet.json" (
    echo.
    echo [1/5] Generating devnet keypair...
    call node create-keypair.js
    if errorlevel 1 (
        echo ERROR: Keypair generation failed
        pause
        exit /b 1
    )
    echo.
    echo Next: Fund your wallet!
    echo Visit: https://faucet.solana.com
    echo Paste your public key from the output above
    echo.
    pause
)

REM Step 2: Build
echo.
echo [2/5] Building contract...
call anchor build
if errorlevel 1 (
    echo ERROR: Build failed
    pause
    exit /b 1
)
echo Build successful!

REM Step 3: Deploy
echo.
echo [3/5] Deploying to devnet...
call anchor deploy --provider.cluster devnet
if errorlevel 1 (
    echo ERROR: Deployment failed. Check:
    echo - Is your wallet funded?
    echo - Is internet connection working?
    pause
    exit /b 1
)

echo.
echo ========================================
echo  Deployment Successful!
echo ========================================
echo.
echo Next steps:
echo 1. Check deployment on Solana Explorer
echo 2. Verify program account exists
echo 3. Run test transactions
echo.

pause
