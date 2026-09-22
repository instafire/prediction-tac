import { createRoot } from "react-dom/client";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import "./index.css";
import "./pixel.css";

// Server-provided runtime config (contract / rpc / chain / admin flag). Fetched
// before the app boots so App.tsx can read it synchronously at module load.
// Served by serve_prod.py from deploy-config.json; falls back to demo/public
// mode when absent. App is dynamically imported AFTER the config is stashed.
async function boot() {
  try {
    const res = await fetch("/app-config.json", { cache: "no-store" });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg && typeof cfg === "object") {
        (window as unknown as { __APP_CONFIG__?: unknown }).__APP_CONFIG__ = cfg;
      }
    }
  } catch {
    /* no server config — public/demo defaults apply */
  }

  const { default: App } = await import("./App");
  const manifestUrl =
    (import.meta.env.VITE_TONCONNECT_MANIFEST_URL as string) ||
    `${window.location.origin}/tonconnect-manifest.json`;

  createRoot(document.getElementById("root")!).render(
    <TonConnectUIProvider
      manifestUrl={manifestUrl}
      actionsConfiguration={{ twaReturnUrl: "https://t.me/" }}
    >
      <App />
    </TonConnectUIProvider>
  );
}

void boot();
