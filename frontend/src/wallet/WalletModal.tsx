import { Wallet, Smartphone, X, ExternalLink, Loader2 } from "lucide-react";

export type WalletModalProps = {
  open: boolean;
  onClose: () => void;
  onEvm: () => void | Promise<void>;
  onTelegram: () => void | Promise<void>;
  onDemo?: () => void;
  onDisconnect?: () => void;
  busy?: string | null;
  showDemo?: boolean;
  connected?: boolean;
  networkName: string;
  faucetUrl?: string;
  inTelegram: boolean;
  evmAccount?: string;
  tonAccount?: string;
};

export function WalletModal({
  open, onClose, onEvm, onTelegram, onDemo, onDisconnect, busy, showDemo, connected,
  networkName, faucetUrl, inTelegram, evmAccount, tonAccount,
}: WalletModalProps) {
  if (!open) return null;
  return (
    <div className="palette-overlay wallet-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Connect wallet">
      <div className="wallet-modal" onClick={e => e.stopPropagation()}>
        <div className="wm-head">
          <h3>{connected ? "Wallet" : "Connect wallet"}</h3>
          <button type="button" className="icon-chip" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <p className="wm-sub">
          Network: <b>{networkName}</b>
          {inTelegram ? " · Telegram Mini App detected" : ""}
        </p>

        {connected && (
          <div className="wm-status">
            {evmAccount && <div><span>EVM</span><code>{evmAccount}</code></div>}
            {tonAccount && <div><span>TON</span><code>{tonAccount}</code></div>}
          </div>
        )}

        <button type="button" className="wm-opt primary" disabled={!!busy} onClick={() => void onTelegram()}>
          <Smartphone size={20} />
          <span>
            <b>Telegram / TON Wallet</b>
            <small>Wallet in Telegram, Tonkeeper, MyTonWallet via TON Connect</small>
          </span>
          {busy === "ton" && <Loader2 size={16} className="spin" />}
        </button>

        <button type="button" className="wm-opt" disabled={!!busy} onClick={() => void onEvm()}>
          <Wallet size={20} />
          <span>
            <b>EVM wallet (TAC)</b>
            <small>MetaMask / injected — required for vault trades</small>
          </span>
          {busy === "evm" && <Loader2 size={16} className="spin" />}
        </button>

        {showDemo && onDemo && (
          <button type="button" className="wm-opt ghost" disabled={!!busy} onClick={onDemo}>
            <span>
              <b>Demo wallet</b>
              <small>Simulate trades without a real wallet</small>
            </span>
          </button>
        )}

        {connected && onDisconnect && (
          <button type="button" className="btn-ghost wm-disc" onClick={onDisconnect}>Disconnect</button>
        )}

        {faucetUrl && (
          <a className="wm-faucet" href={faucetUrl} target="_blank" rel="noreferrer">
            Get testnet TAC <ExternalLink size={12} />
          </a>
        )}
        <p className="wm-note">
          TON Connect links your Telegram wallet. Vault trades on TAC EVM need an EVM session on {networkName}
          {faucetUrl ? " — grab faucet TAC if needed." : "."}
        </p>
      </div>
    </div>
  );
}
