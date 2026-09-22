import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // The TAC/TON SDK (@tonappchain/sdk) is intentionally large and already
    // lazy-loaded via dynamic import(), so it never blocks first paint. Raise
    // the limit above that known chunk so the build stays warning-free while
    // still flagging anything unexpectedly large. Vendor code is deliberately
    // NOT split into separate chunks: ethers is on the first-paint critical
    // path, and a single combined bundle gzips smaller than several split ones.
    chunkSizeWarningLimit: 2600,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Avoid broken WS upgrades when host/port don't match the browser URL
    hmr: {
      protocol: 'ws',
      host: '127.0.0.1',
      port: 5173,
      clientPort: 5173,
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
})
