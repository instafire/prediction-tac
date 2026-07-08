# Local & TAC Testnet

## Wallets

| Button | What it does |
|--------|----------------|
| **Telegram / TON Wallet** | TON Connect (Wallet in Telegram, Tonkeeper, …) |
| **EVM wallet (TAC)** | MetaMask / injected — needed for vault txs on TAC EVM |
| **Demo** | Simulated wallet when no contract is deployed |

TON Connect uses `public/tonconnect-manifest.json`. Production hosts should serve that file over HTTPS.

## TAC Saint Petersburg Testnet (default)

| | |
|--|--|
| RPC | `https://spb.rpc.tac.build` |
| Chain ID | `2391` (`0x957`) |
| Explorer | https://spb.explorer.tac.build |
| Faucet | https://spb.faucet.tac.build |
| Frontend env | `VITE_CHAIN=testnet` |

Deploy contract to testnet (needs funded key):

```powershell
$env:Path = "$env:USERPROFILE\.foundry\bin;$env:Path"
cd "D:\Projects\Prediction Tac\tac-prediction-pool"
# put PRIVATE_KEY in .env
forge script script/DeployV3.s.sol:DeployV3 --rpc-url https://spb.rpc.tac.build --broadcast
```

Then set `VITE_CONTRACT_ADDRESS` in `frontend/.env` and rebuild.

## Local Anvil (optional)

| Service | URL / value |
|---------|-------------|
| **App** | http://127.0.0.1:5173/ |
| **Anvil RPC** | http://127.0.0.1:8545 |
| **Chain ID** | 31337 (`0x7A69`) |
| **Contract** | `0x5FbDB2315678afecb367f032d93F642f64180aa3` (after local deploy) |

## MetaMask setup

1. MetaMask → **Add network** (manual):
   - Network name: `Local Anvil`
   - RPC URL: `http://127.0.0.1:8545`
   - Chain ID: `31337`
   - Currency: `ETH`
2. Import account with private key (**local only**):
   ```
   0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
   ```
3. Open http://127.0.0.1:5173 → **Connect**
4. You should see **LIVE** data (not demo). Market #1 exists; vault ~450 ETH remaining.

## Restart later

```powershell
# Terminal 1 — chain
$env:Path = "$env:USERPROFILE\.foundry\bin;$env:Path"
anvil --host 127.0.0.1 --port 8545 --chain-id 31337

# Terminal 2 — redeploy (Anvil resets on restart)
cd "D:\Projects\Prediction Tac\tac-prediction-pool"
$env:PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
forge script script/DeployV3.s.sol:DeployV3 --rpc-url http://127.0.0.1:8545 --broadcast

# Terminal 3 — UI
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

Or: `powershell -File scripts/local-dev.ps1` (starts Anvil if needed, redeploys, runs Vite).

## TAC mainnet / testnet

Needs a real funded key in repo-root `.env`:

```
PRIVATE_KEY=0xYOUR_KEY
```

Then:

```powershell
forge script script/DeployV3.s.sol:DeployV3 --rpc-url https://rpc.tac.build --broadcast
```

Put the printed address into `frontend/.env` as `VITE_CONTRACT_ADDRESS` and set `VITE_CHAIN=mainnet` (or `testnet`).
