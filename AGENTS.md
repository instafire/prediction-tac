# TAC Prediction Pool

Peer-to-peer prediction market dApp for the TAC blockchain (EVM layer connected to TON/Telegram).

## Layout
- `src/` — Solidity contracts (Foundry). `PredictionPoolV3.sol` is current: vault model, disputes, refunds, on-chain user stats. 53 tests pass (`forge test`).
- `frontend/` — Vite + React 19 + TypeScript + ethers v6. Single-page app in `frontend/src/App.tsx`, styles in `frontend/src/App.css`.
- `script/DeployV3.s.sol` — deployment script.

## Frontend notes
- Env: `frontend/.env` → `VITE_CONTRACT_ADDRESS` (0x0 = demo mode with seeded sample markets), `VITE_TAC_RPC`.
- Demo mode: `buildDemoData()` in App.tsx seeds markets/history/leaders when no contract is set. Remove nothing — it powers the pre-deploy showcase.
- Features: search, sort, watchlist, share (`#mk-<id>` + Telegram share), XP/achievements, admin, activity feed, leaderboard, **bottom nav (TG)**, **odds calculator**, **settings** (haptics/sounds/reduce-motion/ending alerts), **onboarding**, **FAQ**, **claim all**, **CSV export**, **local action journal**, **offline banner**, skeletons, category SVG art.
- Modules: `frontend/src/graphics/` (CatArt, HeroChartArt, empties), `frontend/src/lib/{prefs,sounds,txJournal,tacChain}.ts`.
- Lint: `bun run lint` or `npm run lint` (oxlint; files listed explicitly in package.json).
- Build: `bun run build` / `npm run build`. Output in `frontend/dist`.

## Contract notes (V3)
- Vault deposit/withdraw, create, bet, sellPosition, resolve, dispute, cancel, refundExpired, claim, claimRefund.
- Owner trust model for resolution; fee cap 5%; reentrancy guards; solvencyCheck.
- **Shipped upgrades:** `claimMany`, `createMarketWithSource`, `createMultiMarket` (2–8 outcomes), `betOutcome` / `resolveOutcome` / `resolveMultiDispute`, `getMarketMeta`, `getMultiMarket`, `getMarketsPage`, `postComment` (event-log comments).
- Tests: `forge test` — PredictionPoolV3Test (35) + PredictionPoolV3FeaturesTest (6) + legacy suites.
- ABI: after `forge build`, export `out/PredictionPoolV3.sol/PredictionPoolV3.json` → `frontend/src/abi.json`.

## UI/UX notes (July 2026 redesign, round 2)
- Themes: 4 palettes defined in `src/App.css` under `html[data-theme=...]` — midnight (default), terminal, degen, ledger. Cycled via the Palette button in the nav; persisted in `localStorage("ptac-theme")`. `index.html` sets `data-theme="midnight"` as the initial value.
- Fonts: Space Grotesk (UI) + IBM Plex Mono (numbers) loaded in `index.html`; numeric elements use `--mono` with `tabular-nums`.
- CountUp: animates once on first non-zero value, then snaps (no re-glitching on refresh ticks).
- Scrollbars are fully hidden globally (`* { scrollbar-width: none }` + `::-webkit-scrollbar { display: none }`) — scrolling still works.
- New homepage sections: scrolling odds ticker (pauses on hover, click jumps to market), category browse chips with counts, "How it works" 4-step strip (`.how-step` with `data-n` numbers), pulse-dot in hero badge.
- Telegram Mini App: SDK script in `index.html`; `TG`/`IN_TELEGRAM` helpers in App.tsx wire ready/expand/haptics; `tg-mode` class on app root gets compact CSS.
- Demo mode seeds fake markets/activity/leaders via `buildDemoData()` when `VITE_CONTRACT_ADDRESS` is unset.

## UI/UX notes (July 2026 redesign, round 3)
- Command palette: `CommandPalette` component in App.tsx. Open with ⌘K/Ctrl+K, `/`, or the nav search button (`.palette-btn`). Fuzzy search over views, actions (create market, theme cycle, refresh), and every market (jump + expand via `jumpToMarket`). Items built in `paletteItems` useMemo.
- Payout preview: `PayoutPreview` component shows live pari-mutuel estimates ("If you stake X TAC now → YES pays … / NO pays …") inside expanded cards, fee-adjusted from `protocolFee`. Visible even when wallet not connected.
- Hero is now a 2-column grid (`.hero-grid`): left = pitch + stats + quick-action buttons (`.hero-actions` jump to filtered lists), right = `.hero-side` panels (Spotlight = deepest open pool, mini-metrics for watchlist/ending/overdue/disputes, Latest pulse with jump-to-nearest-close).
- All new styles at hero section + end of App.css (`.palette-*`, `.payout-preview`/`.pp-*`); all use theme variables so 4 palettes adapt automatically.

## Hosting
- Live via Cloudflare Tunnel from this machine → `serve_prod.py` (serves static `dist/`, binds 127.0.0.1 only):
  - PUBLIC: https://tac.chaty.lol → 127.0.0.1:8791 (`run-public.cmd`, ADMIN=0).
  - ADMIN: https://tac-admin.chaty.lol → 127.0.0.1:8792 (`run-admin.cmd`, ADMIN=1, HTTP Basic Auth from `admin-auth.json`).
- `serve_prod.py` serves `/app-config.json` fresh from `deploy-config.json` each request, so runtime config (contract/rpc/chain) goes live on server restart with no rebuild.
- After frontend changes: `bun run build` (or `npm run build`), then restart the server(s). Static files are re-read per request so a rebuild alone updates HTML/assets; a **restart is only needed for CSP/Python changes** in `serve_prod.py`.
- Canonical/OG URLs in `index.html`, `public/sitemap.xml`, `public/robots.txt`, and `public/tonconnect-manifest.json` point at https://tac.chaty.lol.

## Round 4 — Security audit + UI polish (July 2026, delhi)
- Re-hosted on this machine (previous host was bunda). Foundry reinstalled at /root/.foundry/bin; all 59 tests pass.
- Wallet event listeners now use named handlers with cleanup (removeListener) to prevent duplicate handlers; chainChanged also clears the signer to avoid stale-network signing.
- CSS polish pass: ≥40px touch targets on all buttons/chips (Telegram-friendly), consistent :active press states, external-link ↗ indicator, backdrop-blur normalized across panels. All additive at end of App.css.
- Security review findings (contract): pull-payment + reentrancy guards + solvency invariant OK; owner-resolution is the main trust assumption (documented, not a bug). Fee capped 5%. No user-fund path for owner other than accumulatedFees.
- Frontend: no dangerouslySetInnerHTML/eval; user content rendered via JSX text nodes (XSS-safe); deep-link hash strictly regex-parsed; localStorage only stores prefs/gamification (no secrets, no keys). App never touches private keys — signing stays in the wallet.

## Round 4 — Separate landing page + Admin console redesign (July 2026)
- Views: new `home` view is the default — hero, spotlight/metrics panels, trending, "How it works", closing CTA. `markets` view is now a focused trading section with its own `.page-head`, category chips with counts, filters/search/sort, market grid, activity feed. Nav has explicit Home + Markets tabs; brand logo goes Home. Ticker/deep-links (`#mk-<id>`) jump to markets view.
- Duplicate category filter strip removed from markets controls (cat-browse chips with counts are the single category UI).
- Admin console: tabbed — Overview (protocol status, market health, connection info), Launch Setup (runtime config form + 6-step go-live checklist incl. forge deploy command, BotFather Telegram hookup), Operations (fees, pause, resolutions, disputes). DEMO MODE / LIVE CHAIN badge in header.
- Runtime config: `localStorage("ptac-config")` `{contract, rpc, chain}` overrides build-time env (validated: ethers.isAddress + https-only RPC). Save & reload switches demo → live instantly without rebuild; Reset returns to build defaults. Demo wallet is owner in demo mode so Admin is testable.
- CSS added at end of App.css: `.page-head`, `.landing-cta`, `.admin-head`, `.admin-env`, `.admin-tabs`, `.ad-conn`, `.lc-grid/.lc-err/.lc-actions`, `.launch-list`, `.launch-note`.
- Verified: build + lint clean, desktop/mobile screenshots, config save/reset round-trip, all admin tabs, demo trade flows intact.

## Round 3 — Buy/Sell + demo wallet (July 2026)
- Contract: added `sellPosition(marketId, amount)` + `PositionSold` event to `PredictionPoolV3.sol`. Exits at face value (not market odds), charges protocolFee on exit, decrements side pool, clears side when position fully sold. 6 new tests; 59 total pass (`forge test`, foundry at /root/.foundry/bin).
- ABI regenerated into `frontend/src/abi.json` (66 entries) via `forge build` + jq extract.
- Frontend trade panel: Buy/Sell tabs per expanded card (`tradeMode` state). Buy = former bet zone with PayoutPreview. Sell = amount input with 25/50/100% chips, empty = sell all, shows net-after-fee, `.b-sell` gold button.
- Demo wallet: in demo mode (contract 0x0) Connect button connects fake account `0xDE30...00AC` with 500 TAC vault + seeded stats; `tx()` simulates latency and appends "(demo — no real transaction)". Buy/sell/deposit/withdraw/create all mutate local state so flows are testable end-to-end without MetaMask. `demoSeeded` ref prevents the 30s refresh from wiping simulated trades.
- Demo positions seeded: market 9 (YES 120), market 8 (NO 40), market 2 (YES 100, resolved winner → claim flow testable).
- PositionSold events indexed into activity feed ("sell" type) + price history + leaderboard volume.

## Deploying the contract
1. Set `PRIVATE_KEY` in `.env` (repo root).
2. `forge script script/DeployV3.s.sol --rpc-url https://rpc.tac.build --broadcast`
3. Put the deployed address in `frontend/.env` `VITE_CONTRACT_ADDRESS`, rebuild.

TAC refs: https://docs.tac.build/sdk/overview · chain id 239 (0xEF), testnet 2391 (0x957) · explorer.tac.build

## Branding / SEO assets (July 2026)
- Logo: `frontend/public/logo.svg` (rounded-square, midnight bg, purple-to-green gradient trend line — same mark as nav). Also used as `favicon.svg`.
- Raster icons generated with rsvg-convert + ImageMagick: `favicon.ico` (16/32/48), `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`.
- Social share: `og.png` + `og.jpg` (1200×630) rendered from an SVG art board (headline "Call it. Stake it. Win the pool.", chart line, YES/NO chips). Rebuild by editing the SVG and re-running rsvg-convert.
- PWA: `site.webmanifest` (name, theme #0b0b14, icons). `robots.txt` + `sitemap.xml` also in `public/`.
- `index.html` has full meta: description, keywords, canonical, Open Graph (og:image absolute URL to the hosted service), Twitter summary_large_image card, theme-color, manifest link.
- Canonical/OG URLs point at https://tac.chaty.lol — update if domain changes.
- Brand copies in `Images/prediction-tac/` (logo.svg, og.png, icon-512.png) for the user.

## Round 5 — desktop card alignment + mobile/Telegram compact layout (July 2026)
- Desktop fix: cards in `.grid` are now equal-height flex columns (`.card { display:flex; flex-direction:column }`, `.card-head` and `.ch-main` flex, sparkline pushed down with `margin-top:auto`). `.prob` keeps its padding (`padding: 11px 16px 15px; margin-top: auto`) so the YES/NO bar sits flush at the card bottom — earlier regression had dropped the padding and the bar bled edge-to-edge.
- Mobile/Telegram (≤640px): `.cat-browse` and `.tabs` are single swipeable rows (nowrap + overflow-x auto + scroll-snap) instead of tall wraps; `.search-shelf` and `.ctrl-right` full-width; page-head tightened.
- Top nav ≤760px: compact block at end of App.css — brand/name smaller, nav-tabs one scrollable row, chips (lvl/streak/vault) hidden at the narrowest widths to keep a 2-row nav in Telegram.
- Buttons/touch/a11y block (min-heights 42px CTAs / 36px chips, `pointer: coarse` targets, active scale, focus-visible outlines) lives at the end of App.css after the ROUND 5 media block — was accidentally dropped in an edit once; keep it when editing near EOF.
- Verified via agent-browser at 1280×900, 390×844, and 390×780 with `.tg-mode` forced; card heights equalized (251.75px across a row), no console errors.
