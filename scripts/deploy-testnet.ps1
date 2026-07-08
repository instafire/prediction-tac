# Deploy PredictionPoolV3 to TAC Saint Petersburg Testnet
$ErrorActionPreference = "Stop"
$env:Path = "$env:USERPROFILE\.foundry\bin;$env:Path"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Test-Path ".env")) {
  Write-Host "Create .env with PRIVATE_KEY=0x... (funded on TAC SPB testnet)"
  Write-Host "Faucet: https://spb.faucet.tac.build"
  exit 1
}

Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  if ($_ -match '^([^=]+)=(.*)$') {
    [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), "Process")
  }
}

if (-not $env:PRIVATE_KEY) {
  Write-Host "PRIVATE_KEY missing in .env"
  exit 1
}

$RPC = if ($env:TAC_TESTNET_RPC) { $env:TAC_TESTNET_RPC } else { "https://spb.rpc.tac.build" }
Write-Host "Deploying to $RPC ..."
forge script script/DeployV3.s.sol:DeployV3 --rpc-url $RPC --broadcast -vv

Write-Host ""
Write-Host "Next: put the printed address into frontend/.env as VITE_CONTRACT_ADDRESS"
Write-Host "     VITE_CHAIN=testnet"
Write-Host "     VITE_TAC_RPC=https://spb.rpc.tac.build"
Write-Host "Then: cd frontend; npm run dev"
