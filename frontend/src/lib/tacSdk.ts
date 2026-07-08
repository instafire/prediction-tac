import { Network, TacSdk, SenderFactory } from "@tonappchain/sdk";
import type { TonConnectUI } from "@tonconnect/ui";
import type { ChainKey } from "./networks";

let sdk: TacSdk | null = null;
let sdkNetwork: Network | null = null;

export function chainToTacNetwork(chain: ChainKey): Network | null {
  if (chain === "mainnet") return Network.MAINNET;
  if (chain === "testnet") return Network.TESTNET;
  return null; // local anvil — no TAC hybrid SDK
}

export async function getTacSdk(chain: ChainKey): Promise<TacSdk | null> {
  const net = chainToTacNetwork(chain);
  if (!net) return null;
  if (sdk && sdkNetwork === net) return sdk;
  if (sdk) {
    try { sdk.closeConnections(); } catch { /* noop */ }
    sdk = null;
  }
  try {
    sdk = await TacSdk.create({ network: net });
    sdkNetwork = net;
    return sdk;
  } catch (e) {
    console.warn("TacSdk init failed", e);
    return null;
  }
}

export async function closeTacSdk() {
  if (sdk) {
    try { sdk.closeConnections(); } catch { /* noop */ }
    sdk = null;
    sdkNetwork = null;
  }
}

/** Resolve TAC EVM smart-account for a TON wallet + dApp contract (if factory supports it). */
export async function resolveTacSmartAccount(
  chain: ChainKey,
  tvmAddress: string,
  applicationAddress: string,
): Promise<string | null> {
  const s = await getTacSdk(chain);
  if (!s || !applicationAddress || applicationAddress === "0x0000000000000000000000000000000000000000") {
    return null;
  }
  try {
    const sa = await s.getSmartAccountAddressForTvmWallet(tvmAddress, applicationAddress);
    return sa || null;
  } catch (e) {
    console.warn("Smart account resolve failed", e);
    return null;
  }
}

export async function getTonSender(tonConnect: TonConnectUI) {
  return SenderFactory.getSender({ tonConnect });
}
