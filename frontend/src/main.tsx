import { createRoot } from "react-dom/client";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import App from "./App";
import "./index.css";
import "./pixel.css";

const manifestUrl =
  (import.meta.env.VITE_TONCONNECT_MANIFEST_URL as string) ||
  `${window.location.origin}/tonconnect-manifest.json`;

createRoot(document.getElementById("root")!).render(
  <TonConnectUIProvider
    manifestUrl={manifestUrl}
    actionsConfiguration={{
      twaReturnUrl: "https://t.me/",
    }}
  >
    <App />
  </TonConnectUIProvider>
);
