/** TAC chain constants + helpers shared by the dApp. */

export const TAC = {
  mainnet: {
    chainId: 239,
    chainIdHex: "0xEF",
    name: "TAC Mainnet",
    rpc: "https://rpc.tac.build",
    explorer: "https://explorer.tac.build",
  },
  testnet: {
    chainId: 2391,
    chainIdHex: "0x957",
    name: "TAC Testnet",
    rpc: "https://rpc.testnet.tac.build",
    explorer: "https://explorer.testnet.tac.build",
  },
  docs: "https://docs.tac.build/sdk/overview",
  native: { name: "TAC", symbol: "TAC", decimals: 18 },
} as const;

export function explorerTx(hash: string, testnet = false): string {
  const base = testnet ? TAC.testnet.explorer : TAC.mainnet.explorer;
  return `${base}/tx/${hash}`;
}

export function explorerAddress(addr: string, testnet = false): string {
  const base = testnet ? TAC.testnet.explorer : TAC.mainnet.explorer;
  return `${base}/address/${addr}`;
}

export function shortAddr(addr: string, n = 4): string {
  if (!addr || addr.length < 10) return addr || "";
  return `${addr.slice(0, 2 + n)}…${addr.slice(-n)}`;
}
