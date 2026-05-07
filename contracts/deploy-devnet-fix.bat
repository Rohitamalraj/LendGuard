@echo off
REM Deploy LendGuard with devnet feature flag to fix MessageApproval validation

echo 🔧 Building LendGuard with devnet feature...
echo.

REM Build with devnet feature
anchor build --features devnet

if %ERRORLEVEL% NEQ 0 (
    echo ❌ Build failed
    exit /b 1
)

echo.
echo ✅ Build successful!
echo.
echo 📝 Program binary: target\deploy\lendguard_proof_vault.so
echo.

REM Deploy to devnet
echo 🚀 Deploying to devnet...
echo.

anchor deploy --provider.cluster devnet

if %ERRORLEVEL% NEQ 0 (
    echo ❌ Deployment failed
    echo.
    echo 💡 Common issues:
    echo    1. Insufficient SOL balance - run: solana airdrop 5 --url devnet
    echo    2. Wrong keypair - check: solana config get
    echo    3. Network issues - try again
    exit /b 1
)

echo.
echo ✅ Deployment successful!
echo.

REM Get program ID from lib.rs
for /f "tokens=2 delims=(" %%a in ('findstr "declare_id!" src\lib.rs') do (
    for /f "tokens=1 delims=)" %%b in ("%%a") do (
        set PROGRAM_ID=%%b
    )
)

set PROGRAM_ID=%PROGRAM_ID:"=%

echo 📍 Program ID: %PROGRAM_ID%
echo.

echo 📝 Updating .env files...

REM Update web/.env
if exist "..\web\.env" (
    powershell -Command "(Get-Content '..\web\.env') -replace 'NEXT_PUBLIC_LENDGUARD_PROGRAM_ID=.*', 'NEXT_PUBLIC_LENDGUARD_PROGRAM_ID=%PROGRAM_ID%' | Set-Content '..\web\.env'"
    echo    ✓ Updated ..\web\.env
)

REM Update contracts/.env
if exist ".env" (
    powershell -Command "(Get-Content '.env') -replace 'LENDGUARD_PROGRAM_ID=.*', 'LENDGUARD_PROGRAM_ID=%PROGRAM_ID%' | Set-Content '.env'"
    echo    ✓ Updated .env
)

echo.
echo ✅ All done!
echo.
echo 📋 Next steps:
echo    1. Restart your dev server: npm run dev (in web\ directory)
echo    2. Refresh the demo page
echo    3. Try Step 2 (Verify Custody Proof) again
echo.
echo 🔗 View on Explorer:
echo    https://explorer.solana.com/address/%PROGRAM_ID%?cluster=devnet
echo.
