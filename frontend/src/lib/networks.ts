/** TAC / local network profiles */

export type ChainKey = "mainnet" | "testnet" | "local";

export interface NetworkProfile {
  key: ChainKey;
  name: string;
  chainIdHex: string;
  chainId: number;
  rpc: string;
  explorer: string;
  currency: { name: string; symbol: string; decimals: number };
  faucet?: string;
  tonNetwork: "mainnet" | "testnet";
}

export const NETWORKS: Record<ChainKey, NetworkProfile> = {
  mainnet: {
    key: "mainnet",
    name: "TAC Mainnet",
    chainIdHex: "0xEF",
    chainId: 239,
    rpc: "https://rpc.tac.build",
    explorer: "https://explorer.tac.build",
    currency: { name: "TAC", symbol: "TAC", decimals: 18 },
    tonNetwork: "mainnet",
  },
  testnet: {
    key: "testnet",
    name: "TAC Saint Petersburg Testnet",
    chainIdHex: "0x957",
    chainId: 2391,
    rpc: "https://spb.rpc.tac.build",
    explorer: "https://spb.explorer.tac.build",
    currency: { name: "TAC", symbol: "TAC", decimals: 18 },
    faucet: "https://spb.faucet.tac.build",
    tonNetwork: "testnet",
  },
  local: {
    key: "local",
    name: "Local Anvil",
    chainIdHex: "0x7A69",
    chainId: 31337,
    rpc: "http://127.0.0.1:8545",
    explorer: "",
    currency: { name: "ETH", symbol: "ETH", decimals: 18 },
    tonNetwork: "testnet",
  },
};

export function resolveChainKey(pref?: string | null): ChainKey {
  const p = (pref || "").toLowerCase();
  if (p === "local" || p === "testnet" || p === "mainnet") return p;
  return "testnet";
}

export function explorerTx(net: NetworkProfile, hash: string): string {
  if (!net.explorer) return hash;
  return `${net.explorer}/tx/${hash}`;
}

export function explorerAddress(net: NetworkProfile, addr: string): string {
  if (!net.explorer) return addr;
  return `${net.explorer}/address/${addr}`;
}
