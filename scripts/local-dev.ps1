# Start local Anvil + ensure contract is deployed + run frontend
$ErrorActionPreference = "Stop"
$env:Path = "$env:USERPROFILE\.foundry\bin;$env:Path"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$ANVIL_RPC = "http://127.0.0.1:8545"
$PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

function Test-Anvil {
  try {
    $body = '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
    $r = Invoke-WebRequest -Uri $ANVIL_RPC -Method POST -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 2
    return $r.StatusCode -eq 200
  } catch { return $false }
}

if (-not (Test-Anvil)) {
  Write-Host "Starting Anvil on 127.0.0.1:8545..."
  Start-Process -FilePath "anvil" -ArgumentList "--host","127.0.0.1","--port","8545","--chain-id","31337" -WindowStyle Minimized
  $tries = 0
  while (-not (Test-Anvil) -and $tries -lt 20) { Start-Sleep -Milliseconds 400; $tries++ }
  if (-not (Test-Anvil)) { throw "Anvil failed to start" }
}

Write-Host "Deploying PredictionPoolV3..."
$env:PRIVATE_KEY = $PK
$out = forge script script/DeployV3.s.sol:DeployV3 --rpc-url $ANVIL_RPC --broadcast 2>&1 | Out-String
Write-Host $out
if ($out -match "deployed at:\s*(0x[a-fA-F0-9]{40})") {
  $addr = $Matches[1]
} else {
  $addr = "0x5FbDB2315678afecb367f032d93F642f64180aa3"
}

@"
VITE_CONTRACT_ADDRESS=$addr
VITE_TAC_RPC=http://127.0.0.1:8545
VITE_CHAIN=local
"@ | Set-Content -Path "frontend\.env" -Encoding utf8

Write-Host "Contract: $addr"
Write-Host "Starting Vite on http://localhost:5173 ..."
Set-Location frontend
npm run dev -- --host 127.0.0.1 --port 5173
